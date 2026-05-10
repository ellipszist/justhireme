from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone

from api.dependencies import get_discovery_service, get_ranking_service, get_repository
from api.rate_limit import RateLimiter, require_rate_limit
from data.repository import Repository
from discovery.service import DiscoveryService
from discovery.targets import (
    free_sources_enabled,
    has_x_token,
    int_cfg,
    job_targets,
    profile_for_discovery,
    truthy,
)
from ranking.service import RankingService


SCAN_STOP = asyncio.Event()
REEVALUATE_STOP = asyncio.Event()
SCAN_TASK: asyncio.Task | None = None
REEVALUATE_TASK: asyncio.Task | None = None
_scan_lock = asyncio.Lock()
_reevaluate_lock = asyncio.Lock()
_scan_limiter = RateLimiter(3, 60)

REEVALUATION_STATUS_LOCKS = {"approved", "applied", "interviewing", "rejected", "accepted", "discarded"}


def should_preserve_job_status(status: str) -> bool:
    return status in REEVALUATION_STATUS_LOCKS


async def broadcast_x_source_errors(manager, errors: list[str]) -> None:
    if not errors:
        return
    for msg in errors[:3]:
        await manager.broadcast({"type": "agent", "event": "x_source_error", "msg": f"X source skipped: {msg}"})
    if len(errors) > 3:
        await manager.broadcast({"type": "agent", "event": "x_source_error", "msg": f"{len(errors) - 3} more X queries were skipped"})


async def run_x_signal_scan(manager, cfg: dict, kind_filter: str | None = None, profile: dict | None = None) -> list[dict]:
    if not has_x_token(cfg):
        return []

    kind_filter = "job"
    label = "job leads"
    await manager.broadcast({"type": "agent", "event": "x_scout_start", "msg": f"Scanning X for {label}..."})
    result = await get_discovery_service().scan_x(cfg, kind_filter=kind_filter, profile=profile)
    leads = result.leads
    usage = result.usage
    await manager.broadcast({"type": "agent", "event": "x_scout_done", "msg": f"X scout - {len(leads)} {label} found"})
    if usage.get("executed_queries"):
        await manager.broadcast({
            "type": "agent",
            "event": "x_scout_usage",
            "msg": f"X usage - {usage.get('executed_queries', 0)} requests, {usage.get('tweets_seen', 0)} posts checked, {usage.get('filtered', 0)} filtered",
        })
    if not leads:
        await broadcast_x_source_errors(manager, result.errors)
    hot_threshold = int_cfg(cfg, "x_hot_lead_threshold", 80, 1, 100)
    notify_hot = truthy(cfg.get("x_enable_notifications"))
    for lead in leads:
        await manager.broadcast({"type": "LEAD_UPDATED", "data": lead})
        if (lead.get("signal_score") or 0) >= hot_threshold:
            await manager.broadcast({"type": "HOT_X_LEAD", "data": lead})
            if notify_hot:
                await manager.broadcast({"type": "agent", "event": "x_hot_lead", "msg": f"Hot X lead: {lead.get('title','?')} @ {lead.get('company','?')}"})
    return leads


async def run_free_source_scan(manager, cfg: dict, kind_filter: str | None = None, profile: dict | None = None) -> list[dict]:
    if not free_sources_enabled(cfg):
        return []

    kind_filter = "job"
    label = "job leads"
    await manager.broadcast({"type": "agent", "event": "free_scout_start", "msg": f"Scanning free sources for {label}..."})
    result = await get_discovery_service().scan_free_sources(cfg, kind_filter=kind_filter, profile=profile)
    leads = result.leads
    usage = result.usage
    await manager.broadcast({
        "type": "agent",
        "event": "free_scout_done",
        "msg": f"Free scout - {len(leads)} {label} found ({usage.get('executed', 0)} sources checked)",
    })
    if not leads:
        for msg in result.errors[:4]:
            await manager.broadcast({"type": "agent", "event": "free_source_error", "msg": f"Free source skipped: {msg}"})
    for lead in leads:
        await manager.broadcast({"type": "LEAD_UPDATED", "data": lead})
    return leads


async def run_scan(
    manager,
    *,
    repo: Repository | None = None,
    discovery_service: DiscoveryService | None = None,
    ranking_service: RankingService | None = None,
) -> None:
    repo = repo or get_repository()
    discovery_service = discovery_service or get_discovery_service()
    ranking_service = ranking_service or get_ranking_service()
    cfg = repo.settings.get_settings()
    profile = profile_for_discovery(repo.profile.get_profile(), cfg)
    market_focus = cfg.get("job_market_focus", "global")
    raw_urls = job_targets(cfg.get("job_boards", ""), market_focus)
    await run_x_signal_scan(manager, cfg, "job", profile)
    await run_free_source_scan(manager, cfg, "job", profile)

    await manager.broadcast({"type": "agent", "event": "query_gen_start", "msg": "Generating profile-tailored search queries..."})
    try:
        urls = await discovery_service.plan_board_targets(profile, raw_urls, market_focus)
        await manager.broadcast({"type": "agent", "event": "query_gen_done", "msg": f"Search plan ready - {len(urls)} targets"})
        for url in urls:
            await manager.broadcast({"type": "agent", "event": "query_gen_target", "msg": url})
    except Exception as exc:
        urls = raw_urls
        await manager.broadcast({"type": "agent", "event": "query_gen_error", "msg": f"Query generation failed ({exc}), using raw URLs"})

    await manager.broadcast({"type": "agent", "event": "scout_start", "msg": f"Launching scan for {len(urls)} targets..."})
    scout_result = await discovery_service.scan_job_boards(urls, cfg)
    leads = scout_result.leads
    await manager.broadcast({"type": "agent", "event": "scout_done", "msg": f"Scout finished - {len(leads)} new leads found"})

    if SCAN_STOP.is_set():
        await manager.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped after scouting."})
        return

    discovered = await asyncio.to_thread(repo.leads.get_discovered_leads)
    await manager.broadcast({"type": "agent", "event": "eval_start", "msg": f"Evaluating {len(discovered)} leads via {cfg.get('llm_provider', 'ollama')}"})

    for lead in discovered:
        if SCAN_STOP.is_set():
            await manager.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped during evaluation."})
            return
        try:
            result = await ranking_service.evaluate_lead(lead, profile)
            await asyncio.to_thread(
                repo.leads.update_lead_score,
                lead["job_id"], result["score"], result["reason"],
                result.get("match_points", []), result.get("gaps", []),
            )
            await manager.broadcast({"type": "LEAD_UPDATED", "data": {**lead, **result}})
            await manager.broadcast({"type": "agent", "event": "eval_scored", "msg": f"Scored {lead.get('title','')} = {result['score']}/100"})
        except Exception as exc:
            await manager.broadcast({"type": "agent", "event": "eval_error", "msg": f"Eval failed for {lead.get('title','')}: {exc}"})

    await manager.broadcast({"type": "agent", "event": "eval_done", "msg": "Evaluation cycle complete"})
    await asyncio.to_thread(repo.settings.save_settings, {"last_scan_finished_at": datetime.now(timezone.utc).isoformat()})


async def run_scan_task(
    manager,
    logger,
    *,
    repo: Repository | None = None,
    discovery_service: DiscoveryService | None = None,
    ranking_service: RankingService | None = None,
) -> None:
    global SCAN_TASK
    try:
        await run_scan(
            manager,
            repo=repo,
            discovery_service=discovery_service,
            ranking_service=ranking_service,
        )
    except Exception as exc:
        logger.error("scan failed: %s", exc)
        await manager.broadcast({"type": "agent", "event": "eval_done", "msg": f"Scan failed: {exc}"})
    finally:
        SCAN_TASK = None


async def run_reevaluate_jobs(
    manager,
    *,
    repo: Repository | None = None,
    ranking_service: RankingService | None = None,
) -> None:
    repo = repo or get_repository()
    ranking_service = ranking_service or get_ranking_service()
    cfg = await asyncio.to_thread(repo.settings.get_settings)
    profile = await asyncio.to_thread(repo.profile.get_profile)
    jobs = await asyncio.to_thread(repo.leads.get_job_leads_for_evaluation)
    total = len(jobs)
    scored = 0
    failed = 0

    await manager.broadcast({
        "type": "agent",
        "event": "reeval_start",
        "msg": f"Re-evaluating {total} job leads via {cfg.get('llm_provider', 'ollama')}",
    })

    for index, lead in enumerate(jobs, start=1):
        if REEVALUATE_STOP.is_set():
            await manager.broadcast({
                "type": "agent",
                "event": "reeval_done",
                "msg": f"Re-evaluation stopped after {scored}/{total} jobs.",
            })
            return

        try:
            result = await ranking_service.evaluate_lead(lead, profile)
            preserve_status = should_preserve_job_status(lead.get("status", ""))
            await asyncio.to_thread(
                repo.leads.update_lead_score,
                lead["job_id"], result["score"], result["reason"],
                result.get("match_points", []), result.get("gaps", []),
                preserve_status,
            )
            saved = await asyncio.to_thread(repo.leads.get_lead_by_id, lead["job_id"])
            await manager.broadcast({"type": "LEAD_UPDATED", "data": saved or {**lead, **result}})
            scored += 1
            await manager.broadcast({
                "type": "agent",
                "event": "reeval_scored",
                "msg": f"[{index}/{total}] Re-scored {lead.get('title','')} = {result['score']}/100",
            })
        except Exception as exc:
            failed += 1
            await manager.broadcast({
                "type": "agent",
                "event": "reeval_error",
                "msg": f"Re-eval failed for {lead.get('title','')}: {exc}",
            })

    summary = f"Re-evaluation complete - {scored}/{total} jobs scored"
    if failed:
        summary += f", {failed} failed"
    await manager.broadcast({"type": "agent", "event": "reeval_done", "msg": summary})


async def run_reevaluate_jobs_task(
    manager,
    logger,
    *,
    repo: Repository | None = None,
    ranking_service: RankingService | None = None,
) -> None:
    global REEVALUATE_TASK
    try:
        await run_reevaluate_jobs(manager, repo=repo, ranking_service=ranking_service)
    except Exception as exc:
        logger.error("reevaluate failed: %s", exc)
        await manager.broadcast({"type": "agent", "event": "reeval_done", "msg": f"Re-evaluation failed: {exc}"})
    finally:
        REEVALUATE_TASK = None


def create_router(
    *,
    manager,
    logger,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1", tags=["discovery"])

    @router.post("/scan")
    async def scan(
        repo: Repository = Depends(get_repository),
        discovery_service: DiscoveryService = Depends(get_discovery_service),
        ranking_service: RankingService = Depends(get_ranking_service),
    ):
        global SCAN_TASK
        require_rate_limit(_scan_limiter)
        async with _scan_lock:
            if SCAN_TASK and not SCAN_TASK.done():
                raise HTTPException(status_code=409, detail="Scan already running")
            if REEVALUATE_TASK and not REEVALUATE_TASK.done():
                raise HTTPException(status_code=409, detail="Re-evaluation already running")
            SCAN_STOP.clear()
            SCAN_TASK = asyncio.create_task(
                run_scan_task(
                    manager,
                    logger,
                    repo=repo,
                    discovery_service=discovery_service,
                    ranking_service=ranking_service,
                )
            )
        return {"status": "scanning"}

    @router.post("/scan/stop")
    async def stop_scan():
        async with _scan_lock:
            if not SCAN_TASK or SCAN_TASK.done():
                return {"status": "idle"}
            SCAN_STOP.set()
            await manager.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped by user."})
        return {"status": "stopping"}

    @router.post("/leads/reevaluate")
    async def reevaluate_jobs(
        repo: Repository = Depends(get_repository),
        ranking_service: RankingService = Depends(get_ranking_service),
    ):
        global REEVALUATE_TASK
        async with _reevaluate_lock:
            if REEVALUATE_TASK and not REEVALUATE_TASK.done():
                raise HTTPException(status_code=409, detail="Re-evaluation already running")
            if SCAN_TASK and not SCAN_TASK.done():
                raise HTTPException(status_code=409, detail="Scan already running")
            REEVALUATE_STOP.clear()
            REEVALUATE_TASK = asyncio.create_task(run_reevaluate_jobs_task(manager, logger, repo=repo, ranking_service=ranking_service))
        return {"status": "reevaluating"}

    @router.post("/leads/reevaluate/stop")
    async def stop_reevaluate_jobs():
        async with _reevaluate_lock:
            if not REEVALUATE_TASK or REEVALUATE_TASK.done():
                return {"status": "idle"}
            REEVALUATE_STOP.set()
            await manager.broadcast({"type": "agent", "event": "reeval_done", "msg": "Re-evaluation stopped by user."})
        return {"status": "stopping"}

    @router.post("/leads/cleanup")
    async def cleanup_leads(
        dry_run: bool = False,
        limit: int = 1000,
        repo: Repository = Depends(get_repository),
    ):
        await manager.broadcast({
            "type": "agent",
            "event": "cleanup_start",
            "msg": f"Scanning up to {limit} leads for bad data...",
        })
        result = await asyncio.to_thread(repo.leads.cleanup_bad_leads, limit, dry_run)

        if not dry_run:
            for item in result.get("items", [])[:100]:
                lead = await asyncio.to_thread(repo.leads.get_lead_by_id, item["job_id"])
                if lead:
                    await manager.broadcast({"type": "LEAD_UPDATED", "data": lead})

        action = "would discard" if dry_run else "discarded"
        await manager.broadcast({
            "type": "agent",
            "event": "cleanup_done",
            "msg": f"Cleanup scanned {result['scanned']} leads and {action} {result['candidates']} bad rows.",
        })
        return result

    @router.post("/free-sources/scan")
    async def free_sources_scan(repo: Repository = Depends(get_repository)):
        cfg = repo.settings.get_settings()
        profile = profile_for_discovery(await asyncio.to_thread(repo.profile.get_profile), cfg)
        leads = await run_free_source_scan(manager, cfg, "job", profile)
        return {"status": "done", "leads": len(leads)}

    return router
