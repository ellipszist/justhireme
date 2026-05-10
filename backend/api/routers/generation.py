from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.dependencies import get_generation_service, get_repository
from api.rate_limit import RateLimiter, require_rate_limit
from data.repository import Repository
from generation.service import GenerationService


async def generate_one(
    job_id: str,
    manager,
    *,
    repo: Repository | None = None,
    service: GenerationService | None = None,
) -> dict:
    repo = repo or get_repository()
    service = service or get_generation_service()
    lead = repo.leads.get_lead_by_id(job_id)
    if not lead:
        await manager.broadcast({"type": "agent", "event": "gen_error", "msg": f"Lead {job_id} not found"})
        raise HTTPException(status_code=404, detail="Lead not found")

    template = repo.settings.get_setting("resume_template", "")
    await manager.broadcast({
        "type": "agent",
        "event": "gen_start",
        "msg": f"Generating for {lead.get('title','?')} @ {lead.get('company','?')}",
    })

    try:
        generation = await service.generate_with_contacts(lead, template=template)
        package = generation.package
        repo.leads.save_asset_package(
            job_id,
            package["resume"],
            package["cover_letter"],
            package.get("selected_projects", []),
            package.get("keyword_coverage", {}),
        )

        outreach_fields = {}
        if package.get("founder_message"):
            outreach_fields["outreach_reply"] = package["founder_message"]
        if package.get("linkedin_note"):
            outreach_fields["outreach_dm"] = package["linkedin_note"]
        if package.get("cold_email"):
            outreach_fields["outreach_email"] = package["cold_email"]
        if outreach_fields:
            repo.leads.update_outreach_fields(job_id, outreach_fields)

        enriched_lead = {
            **lead,
            "asset": package["resume"],
            "resume_asset": package["resume"],
            "cover_letter_asset": package["cover_letter"],
            "selected_projects": package.get("selected_projects", []),
            "keyword_coverage": package.get("keyword_coverage", {}),
            "outreach_reply": package.get("founder_message", lead.get("outreach_reply", "")),
            "outreach_dm": package.get("linkedin_note", lead.get("outreach_dm", "")),
            "outreach_email": package.get("cold_email", lead.get("outreach_email", "")),
            "status": "approved",
        }
        contact_lookup = generation.contact_lookup or {}
        repo.leads.save_contact_lookup(job_id, contact_lookup)
        enriched_lead["contact_lookup"] = contact_lookup
        enriched_meta = dict(enriched_lead.get("source_meta") or {})
        enriched_meta["contact_lookup"] = contact_lookup
        enriched_lead["source_meta"] = enriched_meta
        await manager.broadcast({"type": "LEAD_UPDATED", "data": enriched_lead})
        await manager.broadcast({
            "type": "agent",
            "event": "gen_done",
            "msg": f"Resume and cover letter ready: {lead.get('title','?')}",
        })
        return enriched_lead
    except Exception as exc:
        await manager.broadcast({
            "type": "agent",
            "event": "gen_error",
            "msg": f"Generation failed for {lead.get('title','?')}: {exc}",
        })
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc


def create_router(*, manager) -> APIRouter:
    router = APIRouter(prefix="/api/v1", tags=["generation"])
    generate_limiter = RateLimiter(5, 60)

    @router.post("/leads/{job_id}/generate")
    async def generate_for_lead(
        job_id: str,
        repo: Repository = Depends(get_repository),
        service: GenerationService = Depends(get_generation_service),
    ):
        require_rate_limit(generate_limiter)
        lead = await generate_one(job_id, manager, repo=repo, service=service)
        return {"status": "ready", "job_id": job_id, "lead": lead}

    @router.post("/leads/{job_id}/pipeline/run")
    async def run_pipeline(
        job_id: str,
        bt: BackgroundTasks,
        repo: Repository = Depends(get_repository),
    ):
        from graph import PipelineState, eval_graph

        lead = await asyncio.to_thread(repo.leads.get_lead_by_id, job_id)
        if not lead:
            raise HTTPException(status_code=404, detail="lead not found")
        profile = await asyncio.to_thread(repo.profile.get_profile)
        cfg = await asyncio.to_thread(repo.settings.get_settings)

        async def _run():
            state: PipelineState = {
                "job_id": job_id,
                "lead": lead,
                "profile": profile,
                "cfg": cfg,
                "score": 0,
                "reason": "",
                "match_points": [],
                "gaps": [],
                "asset_path": "",
                "cover_letter_path": "",
                "error": None,
            }
            result = await asyncio.to_thread(eval_graph.invoke, state)
            await manager.broadcast({
                "type": "agent",
                "kind": "agent",
                "src": "pipeline",
                "event": "pipeline_done",
                "msg": f"Pipeline done for {job_id}: score={result['score']}, error={result['error']}",
            })

        bt.add_task(_run)
        return {"status": "started", "job_id": job_id}

    return router
