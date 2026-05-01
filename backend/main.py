import asyncio
import json
import os
import shutil
import socket
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from pydantic import BaseModel, ConfigDict, Field, model_validator


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


_UP   = time.monotonic()
_sched = AsyncIOScheduler()
_LOCAL_ORIGIN_RE = r"^(tauri://localhost|https?://(localhost|127\.0\.0\.1|tauri\.localhost|\[::1\])(?::\d+)?)$"


LeadStatus = Literal[
    "discovered", "evaluating", "tailoring", "approved", "applied",
    "interviewing", "rejected", "accepted", "discarded",
    "matched", "bidding", "proposal_sent", "awarded", "completed",
]


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StatusBody(StrictBody):
    status: LeadStatus


class FeedbackBody(StrictBody):
    feedback: Literal[
        "good", "trash", "too_generic", "not_ai",
        "already_contacted", "relevant", "not_relevant", "duplicate",
        "low_quality", "incorrect_category",
    ]
    note: str = Field(default="", max_length=1000)


class FollowupBody(StrictBody):
    days: int = Field(default=5, ge=1, le=60)


class ManualLeadBody(StrictBody):
    text: str = Field(default="", max_length=20000)
    url: str = Field(default="", max_length=2000)
    kind: Literal["job"] = "job"


class TemplateBody(StrictBody):
    template: str = Field(default="", max_length=20000)


class CandidateBody(StrictBody):
    n: str = Field(default="", max_length=160)
    s: str = Field(default="", max_length=4000)


class SkillBody(StrictBody):
    id: str | None = Field(default=None, max_length=160)
    n: str = Field(default="", max_length=160)
    cat: str = Field(default="general", max_length=80)


class ExperienceBody(StrictBody):
    id: str | None = Field(default=None, max_length=160)
    role: str = Field(default="", max_length=180)
    co: str = Field(default="", max_length=180)
    period: str = Field(default="", max_length=120)
    d: str = Field(default="", max_length=8000)


class ProjectBody(StrictBody):
    id: str | None = Field(default=None, max_length=160)
    title: str = Field(default="", max_length=220)
    stack: str = Field(default="", max_length=2000)
    repo: str = Field(default="", max_length=1000)
    impact: str = Field(default="", max_length=8000)


class SettingsBody(BaseModel):
    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _validate_extra_settings(self):
        for key, value in (self.model_extra or {}).items():
            if len(key) > 120 or any(not (ch.isalnum() or ch in "_.-") for ch in key):
                raise ValueError(f"Invalid settings key: {key}")
            if value is not None and not isinstance(value, (str, bool, int, float)):
                raise ValueError(f"Invalid value for settings key: {key}")
        return self


def _agent_event_action(msg: dict) -> str:
    event = str(msg.get("event") or "agent").strip() or "agent"
    detail = str(msg.get("msg") or "").strip()
    return f"{event}: {detail}" if detail else event


class _CM:
    def __init__(self):
        self._ws: list[WebSocket] = []

    async def add(self, ws: WebSocket):
        self._ws.append(ws)

    def remove(self, ws: WebSocket):
        self._ws = [w for w in self._ws if w != ws]

    async def broadcast(self, msg: dict):
        if msg.get("type") == "agent":
            try:
                from db.client import record_event
                await asyncio.to_thread(record_event, msg.get("job_id") or "__system__", _agent_event_action(msg))
            except Exception:
                pass
        dead = []
        for w in self._ws:
            try:
                await w.send_text(json.dumps(msg))
            except Exception:
                dead.append(w)
        for w in dead:
            self._ws.remove(w)


cm = _CM()

DEFAULT_JOB_TARGETS = [
    "hn-hiring",
    "https://remoteok.com/api",
    "https://remotive.com/api/remote-jobs?search=python",
    "https://remotive.com/api/remote-jobs?search=react",
    "https://remotive.com/api/remote-jobs?search=ai",
    "https://jobicy.com/feed/newjobs",
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "site:boards.greenhouse.io",
    "site:jobs.lever.co",
    "site:jobs.ashbyhq.com",
    "site:apply.workable.com",
    "site:wellfound.com/jobs",
]

_BLOCKED_JOB_TARGET_MARKERS = (
    "freelance", "upwork", "freelancer.com", "fiverr", "contra.com",
    "peopleperhour", "guru.com", "truelancer", "codementor", "toptal",
)


def _split_configured_targets(raw: str) -> list[str]:
    targets: list[str] = []
    for line in str(raw or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for part in line.split(","):
            target = part.strip()
            if target and not target.startswith("#"):
                targets.append(target)
    return targets


def _dedupe_targets(targets: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for target in targets:
        key = target.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(target.strip())
    return out


def _job_targets(raw: str) -> list[str]:
    """Return configured job discovery targets, excluding freelance marketplaces."""
    targets = _split_configured_targets(raw)
    if not targets:
        return list(DEFAULT_JOB_TARGETS)

    filtered: list[str] = []
    for target in targets:
        lower = target.lower()
        if any(marker in lower for marker in _BLOCKED_JOB_TARGET_MARKERS):
            continue
        filtered.append(target)

    return _dedupe_targets(filtered) or list(DEFAULT_JOB_TARGETS)


def _has_x_token(cfg: dict) -> bool:
    return bool(cfg.get("x_bearer_token") or os.environ.get("X_BEARER_TOKEN") or os.environ.get("TWITTER_BEARER_TOKEN"))


def _int_cfg(cfg: dict, key: str, default: int, min_value: int, max_value: int) -> int:
    try:
        value = int(str(cfg.get(key, "") or "").strip())
    except Exception:
        value = default
    return max(min_value, min(value, max_value))


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _free_sources_enabled(cfg: dict) -> bool:
    return _truthy(cfg.get("free_sources_enabled", "false"))


async def _broadcast_x_source_errors(errors: list[str]):
    if not errors:
        return
    for msg in errors[:3]:
        await cm.broadcast({"type": "agent", "event": "x_source_error", "msg": f"X source skipped: {msg}"})
    if len(errors) > 3:
        await cm.broadcast({"type": "agent", "event": "x_source_error", "msg": f"{len(errors) - 3} more X queries were skipped"})


async def _run_x_signal_scan(cfg: dict, kind_filter: str) -> list[dict]:
    if not _has_x_token(cfg):
        return []

    from agents import x_scout

    kind_filter = "job"
    label = "job leads"
    await cm.broadcast({"type": "agent", "event": "x_scout_start", "msg": f"Scanning X for {label}..."})
    leads = await asyncio.to_thread(
        x_scout.run,
        bearer_token=cfg.get("x_bearer_token") or None,
        raw_queries=cfg.get("x_search_queries", ""),
        raw_watchlist=cfg.get("x_watchlist", ""),
        kind_filter=kind_filter,
        max_requests=_int_cfg(cfg, "x_max_requests_per_scan", 5, 1, 50),
        max_results=_int_cfg(cfg, "x_max_results_per_query", 50, 10, 100),
        min_signal_score=_int_cfg(cfg, "x_min_signal_score", 55, 0, 100),
    )
    await cm.broadcast({"type": "agent", "event": "x_scout_done", "msg": f"X scout - {len(leads)} {label} found"})
    usage = getattr(x_scout, "LAST_USAGE", {}) or {}
    if usage.get("executed_queries"):
        await cm.broadcast({
            "type": "agent",
            "event": "x_usage",
            "msg": f"X usage - {usage.get('executed_queries', 0)} requests, {usage.get('tweets_seen', 0)} posts checked, {usage.get('filtered', 0)} filtered",
        })
    if not leads:
        await _broadcast_x_source_errors(getattr(x_scout, "LAST_ERRORS", []))
    hot_threshold = _int_cfg(cfg, "x_hot_lead_threshold", 80, 1, 100)
    notify_hot = _truthy(cfg.get("x_enable_notifications"))
    for lead in leads:
        await cm.broadcast({"type": "LEAD_UPDATED", "data": lead})
        if (lead.get("signal_score") or 0) >= hot_threshold:
            await cm.broadcast({"type": "agent", "event": "x_hot_lead", "msg": f"Hot X lead: {lead.get('title', '')[:90]}"})
            if notify_hot:
                await cm.broadcast({"type": "HOT_X_LEAD", "data": lead})
    return leads

# ── Scan stop flag ─────────────────────────────────────────────────────────────
# Set by /api/v1/scan/stop; cleared when a new scan is accepted.
async def _run_free_source_scan(cfg: dict, kind_filter: str | None = None) -> list[dict]:
    if not _free_sources_enabled(cfg):
        return []

    from agents import free_scout

    kind_filter = "job"
    label = "job leads"
    await cm.broadcast({"type": "agent", "event": "free_scout_start", "msg": f"Scanning free sources for {label}..."})
    leads = await asyncio.to_thread(
        free_scout.run,
        raw_targets=cfg.get("free_source_targets", ""),
        raw_watchlist=cfg.get("company_watchlist", ""),
        kind_filter=kind_filter,
        max_requests=_int_cfg(cfg, "free_source_max_requests", 20, 1, 80),
        min_signal_score=_int_cfg(cfg, "free_source_min_signal_score", 45, 0, 100),
    )
    usage = getattr(free_scout, "LAST_USAGE", {}) or {}
    await cm.broadcast({
        "type": "agent",
        "event": "free_scout_done",
        "msg": f"Free scout - {len(leads)} {label} found ({usage.get('executed', 0)} sources checked)",
    })
    if not leads:
        for msg in (getattr(free_scout, "LAST_ERRORS", []) or [])[:4]:
            await cm.broadcast({"type": "agent", "event": "free_source_error", "msg": f"Free source skipped: {msg}"})
    for lead in leads:
        await cm.broadcast({"type": "LEAD_UPDATED", "data": lead})
    return leads


_scan_stop = asyncio.Event()
_scan_task: asyncio.Task | None = None
_reevaluate_stop = asyncio.Event()
_reevaluate_task: asyncio.Task | None = None

_REEVALUATION_STATUS_LOCKS = {"approved", "applied", "interviewing", "rejected", "accepted", "discarded"}


def _should_preserve_job_status(status: str) -> bool:
    return status in _REEVALUATION_STATUS_LOCKS


def _job_eval_document(lead: dict) -> str:
    desc = (lead.get("description") or "").strip()
    return (
        f"Job Title: {lead.get('title','')}\n"
        f"Company: {lead.get('company','')}\n"
        f"URL: {lead.get('url','')}\n"
        + (f"Description: {desc}" if desc else "")
    )


async def _ghost_tick():
    from db.client import get_setting, get_settings, get_discovered_leads, update_lead_score, get_profile, save_asset_package
    from agents.scout import run as _scout
    from agents.evaluator import score as _score
    from agents.generator import run_package as _gen

    cfg = get_settings()
    if get_setting("ghost_mode") != "true":
        return

    boards = _job_targets(cfg.get("job_boards", ""))
    has_x = _has_x_token(cfg)
    has_free = _free_sources_enabled(cfg)
    profile = None
    if has_x:
        profile = await asyncio.to_thread(get_profile)
        await _run_x_signal_scan(cfg, "job")
    if has_free:
        await _run_free_source_scan(cfg, "job")
    if not boards and not has_x and not has_free:
        await cm.broadcast({"type": "agent", "event": "ghost_warn", "msg": "Ghost Mode: no job boards configured — skipping"})
        return

    # ── Step 1: Scout ──────────────────────────────────────────────
    await cm.broadcast({"type": "agent", "event": "ghost_scout", "msg": "Ghost Mode: scout cycle starting"})
    try:
        leads = await asyncio.to_thread(
            _scout,
            urls=boards,
            apify_token=cfg.get("apify_token") or None,
            apify_actor=cfg.get("apify_actor") or None,
        )
        await cm.broadcast({"type": "agent", "event": "ghost_scout",
                            "msg": f"Ghost scout complete — {len(leads)} new leads found"})
    except Exception as exc:
        await cm.broadcast({"type": "agent", "event": "ghost_error", "msg": f"Scout failed: {exc}"})
        return

    # ── Step 2: Evaluate ───────────────────────────────────────────
    profile = await asyncio.to_thread(get_profile)
    discovered = await asyncio.to_thread(get_discovered_leads)
    await cm.broadcast({"type": "agent", "event": "ghost_eval",
                        "msg": f"Ghost Mode: evaluating {len(discovered)} leads"})

    approved = []
    for lead in discovered:
        try:
            jd = _job_eval_document(lead)
            result = await asyncio.to_thread(_score, jd, profile)
            await asyncio.to_thread(
                update_lead_score,
                lead["job_id"], result["score"], result["reason"],
                result.get("match_points", []), result.get("gaps", []),
            )
            await cm.broadcast({"type": "LEAD_UPDATED", "data": {**lead, **result}})
            if result["score"] >= 85:
                approved.append({**lead, **result})
                await cm.broadcast({"type": "agent", "event": "ghost_approved",
                                    "msg": f"Approved: {lead.get('title','')} @ {lead.get('company','')} [{result['score']}/100]"})
        except Exception as exc:
            await cm.broadcast({"type": "agent", "event": "ghost_error",
                                "msg": f"Eval failed for {lead.get('title','?')}: {exc}"})

    await cm.broadcast({"type": "agent", "event": "ghost_eval",
                        "msg": f"Evaluation done — {len(approved)}/{len(discovered)} approved"})

    if not approved:
        await cm.broadcast({"type": "agent", "event": "ghost_done", "msg": "Ghost Mode: no approved leads this cycle"})
        return

    # ── Step 3: Generate (always) ──────────────────────────────────
    await cm.broadcast({"type": "agent", "event": "ghost_gen",
                        "msg": f"Ghost Mode: generating assets for {len(approved)} leads"})
    generated = []
    for lead in approved:
        try:
            package = await asyncio.to_thread(_gen, lead)
            await asyncio.to_thread(
                save_asset_package,
                lead["job_id"],
                package["resume"],
                package["cover_letter"],
                package.get("selected_projects", []),
            )
            generated.append({
                **lead,
                "asset": package["resume"],
                "resume_asset": package["resume"],
                "cover_letter_asset": package["cover_letter"],
                "selected_projects": package.get("selected_projects", []),
            })
            await cm.broadcast({"type": "agent", "event": "ghost_gen",
                                "msg": f"Generated resume and cover letter for {lead.get('title','?')}"})
        except Exception as exc:
            await cm.broadcast({"type": "agent", "event": "ghost_error",
                                "msg": f"Generation failed for {lead.get('title','?')}: {exc}"})

    # ── Step 4: Actuate only if auto_apply is enabled ──────────────
    if get_setting("auto_apply", "false") != "true":
        await cm.broadcast({"type": "agent", "event": "ghost_done",
                            "msg": f"Ghost cycle complete — {len(generated)} leads ready. Auto-apply is OFF — waiting for manual approval in Sniper view."})
        return

    from agents.actuator import run as _act
    from db.client import get_lead_for_fire, mark_applied
    await cm.broadcast({"type": "agent", "event": "ghost_apply",
                        "msg": f"Ghost Mode: auto-applying to {len(generated)} leads"})
    for item in generated:
        try:
            lead, asset = await asyncio.to_thread(get_lead_for_fire, item["job_id"])
            _status, detail = _fire_blocker(lead, asset)
            if detail:
                await cm.broadcast({"type": "agent", "event": "ghost_error",
                                    "msg": f"Submission blocked: {item.get('title','?')} - {detail}"})
                continue

            ok = await asyncio.to_thread(_act, lead, asset)
            if ok:
                await asyncio.to_thread(mark_applied, item["job_id"])
                await cm.broadcast({"type": "agent", "event": "ghost_applied",
                                    "msg": f"Applied: {item.get('title','?')} @ {item.get('company','?')}"})
            else:
                await cm.broadcast({"type": "agent", "event": "ghost_error",
                                    "msg": f"Submission failed: {item.get('title','?')}"})
        except Exception as exc:
            await cm.broadcast({"type": "agent", "event": "ghost_error",
                                "msg": f"Actuator error for {item.get('title','?')}: {exc}"})

    await cm.broadcast({"type": "agent", "event": "ghost_done", "msg": "Ghost cycle complete."})


@asynccontextmanager
async def lifespan(app: FastAPI):
    _sched.add_job(_ghost_tick, "interval", hours=6, id="ghost")
    _sched.start()
    print("[sidecar] FastAPI live.", file=sys.stderr)
    yield
    _sched.shutdown(wait=False)
    print("[sidecar] FastAPI shutdown.", file=sys.stderr)


app = FastAPI(title="JustHireMe", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=_LOCAL_ORIGIN_RE,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "alive",
        "uptime_seconds": round(time.monotonic() - _UP, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _annotate_job_lead(lead: dict) -> dict:
    from agents.scout import classify_job_seniority

    meta = dict(lead.get("source_meta") or {})
    level = str(meta.get("seniority_level") or lead.get("seniority_level") or "").strip().lower()
    if level not in {"fresher", "junior", "mid", "senior", "unknown"}:
        level = classify_job_seniority(lead)
    meta["seniority_level"] = level
    meta["is_beginner"] = level in {"fresher", "junior"}
    return {**lead, "source_meta": meta, "seniority_level": level}


@app.get("/api/v1/leads")
async def leads(beginner_only: bool = False, seniority: str | None = None):
    from db.client import get_all_leads

    jobs = [_annotate_job_lead(lead) for lead in get_all_leads() if (lead.get("kind") or "job") == "job"]
    requested = str(seniority or "").strip().lower()
    if beginner_only or requested == "beginner":
        return [lead for lead in jobs if lead.get("seniority_level") in {"fresher", "junior"}]
    if requested in {"fresher", "junior", "mid", "senior", "unknown"}:
        return [lead for lead in jobs if lead.get("seniority_level") == requested]
    return jobs


@app.get("/api/v1/leads/{job_id}")
async def get_lead(job_id: str):
    from db.client import get_lead_by_id
    from fastapi import HTTPException
    lead = get_lead_by_id(job_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _annotate_job_lead(lead) if (lead.get("kind") or "job") == "job" else lead


@app.delete("/api/v1/leads/{job_id}")
async def delete_lead_endpoint(job_id: str):
    from db.client import delete_lead
    delete_lead(job_id)
    return {"ok": True}


@app.put("/api/v1/leads/{job_id}/status")
async def update_status(job_id: str, body: StatusBody):
    from db.client import update_lead_status
    try:
        update_lead_status(job_id, body.status)
        await cm.broadcast({"type": "LEAD_UPDATED", "data": {"job_id": job_id, "status": body.status}})
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/v1/leads/{job_id}/feedback")
async def update_feedback(job_id: str, body: FeedbackBody):
    from db.client import save_lead_feedback
    try:
        lead = save_lead_feedback(job_id, body.feedback, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    await cm.broadcast({"type": "LEAD_UPDATED", "data": lead})
    return lead


@app.put("/api/v1/leads/{job_id}/followup")
async def update_followup(job_id: str, body: FollowupBody):
    from db.client import update_lead_followup
    lead = update_lead_followup(job_id, body.days)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    await cm.broadcast({"type": "LEAD_UPDATED", "data": lead})
    return lead


@app.post("/api/v1/leads/manual")
async def create_manual_lead(body: ManualLeadBody):
    if not body.text.strip() and not body.url.strip():
        raise HTTPException(status_code=400, detail="Paste lead text or a URL")
    from agents.lead_intel import manual_lead_from_text
    from db.client import get_lead_by_id, rank_lead_by_feedback, save_lead

    lead = rank_lead_by_feedback(manual_lead_from_text(body.text, body.url, "job"))
    if lead.get("kind") != "job":
        raise HTTPException(status_code=422, detail="Only job leads are accepted right now")
    lead = _annotate_job_lead(lead)
    save_lead(
        lead["job_id"],
        lead["title"],
        lead["company"],
        lead["url"],
        lead["platform"],
        lead["description"],
        kind=lead["kind"],
        budget=lead["budget"],
        signal_score=lead["signal_score"],
        signal_reason=lead["signal_reason"],
        signal_tags=lead["signal_tags"],
        outreach_reply=lead["outreach_reply"],
        outreach_dm=lead["outreach_dm"],
        outreach_email=lead.get("outreach_email", ""),
        proposal_draft=lead.get("proposal_draft", ""),
        fit_bullets=lead.get("fit_bullets", []),
        followup_sequence=lead.get("followup_sequence", []),
        proof_snippet=lead.get("proof_snippet", ""),
        tech_stack=lead.get("tech_stack", []),
        location=lead.get("location", ""),
        urgency=lead.get("urgency", ""),
        base_signal_score=lead.get("base_signal_score"),
        learning_delta=lead.get("learning_delta"),
        learning_reason=lead.get("learning_reason", ""),
        source_meta=lead["source_meta"],
    )
    saved = get_lead_by_id(lead["job_id"]) or lead
    await cm.broadcast({"type": "LEAD_UPDATED", "data": saved})
    return saved


@app.get("/api/v1/followups/due")
async def due_followups(limit: int = 25):
    from db.client import get_due_followups
    return get_due_followups(limit)


@app.post("/api/v1/leads/{job_id}/generate")
async def generate_for_lead(job_id: str, bt: BackgroundTasks):
    bt.add_task(_generate_one, job_id)
    return {"status": "generating", "job_id": job_id}


@app.get("/api/v1/leads/{job_id}/pdf")
async def get_lead_pdf(job_id: str, kind: str = "resume"):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    from db.client import get_lead_by_id
    lead = get_lead_by_id(job_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if kind in {"cover", "cover_letter", "cover-letter"}:
        path = lead.get("cover_letter_asset") or ""
        filename = f"{job_id}_cover_letter.pdf"
        missing = "Cover letter not generated yet"
    else:
        path = lead.get("resume_asset") or lead.get("asset") or ""
        filename = f"{job_id}_resume.pdf"
        missing = "Resume not generated yet"
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail=missing)
    return FileResponse(path, media_type="application/pdf", filename=filename)


@app.get("/api/v1/template")
async def get_template():
    from db.client import get_setting
    return {"template": get_setting("resume_template", "")}


@app.post("/api/v1/template")
async def save_template(body: TemplateBody):
    from db.client import save_settings
    save_settings({"resume_template": body.template})
    return {"ok": True}


@app.get("/api/v1/events")
async def get_events_endpoint(limit: int = 100, job_id: str | None = None):
    from db.client import get_events
    return get_events(limit=limit, job_id=job_id)


@app.get("/api/v1/graph")
async def graph_stats():
    from db.client import conn
    out = {}
    for t in ["Candidate", "Skill", "Project", "Experience", "JobLead"]:
        r = conn.execute(f"MATCH (n:{t}) RETURN count(n)")
        out[t.lower()] = r.get_next()[0] if r.has_next() else 0
    return out


@app.get("/api/v1/profile")
async def get_profile_endpoint():
    from db.client import get_profile as _gp
    return _gp()


@app.put("/api/v1/profile/candidate")
async def update_candidate_endpoint(body: CandidateBody):
    from db.client import update_candidate
    if not body.n.strip() and not body.s.strip():
        raise HTTPException(status_code=422, detail="Name or summary is required")
    return update_candidate(body.n, body.s)


# ── Profile CRUD: Skills ──────────────────────────────────────────

@app.post("/api/v1/profile/skill")
async def add_skill_endpoint(body: SkillBody):
    from db.client import add_skill
    if not body.n.strip():
        raise HTTPException(status_code=422, detail="Skill name is required")
    return add_skill(body.n, body.cat)


@app.put("/api/v1/profile/skill/{sid}")
async def update_skill_endpoint(sid: str, body: SkillBody):
    from db.client import update_skill
    if not body.n.strip():
        raise HTTPException(status_code=422, detail="Skill name is required")
    return update_skill(sid, body.n, body.cat)


@app.delete("/api/v1/profile/skill/{sid}")
async def delete_skill_endpoint(sid: str):
    from db.client import delete_skill
    delete_skill(sid)
    return {"ok": True}


# ── Profile CRUD: Experience ──────────────────────────────────────

@app.post("/api/v1/profile/experience")
async def add_experience_endpoint(body: ExperienceBody):
    from db.client import add_experience
    if not body.role.strip() and not body.co.strip():
        raise HTTPException(status_code=422, detail="Role or company is required")
    return add_experience(body.role, body.co, body.period, body.d)


@app.put("/api/v1/profile/experience/{eid}")
async def update_experience_endpoint(eid: str, body: ExperienceBody):
    from db.client import update_experience
    if not body.role.strip() and not body.co.strip():
        raise HTTPException(status_code=422, detail="Role or company is required")
    return update_experience(eid, body.role, body.co, body.period, body.d)


@app.delete("/api/v1/profile/experience/{eid}")
async def delete_experience_endpoint(eid: str):
    from db.client import delete_experience
    delete_experience(eid)
    return {"ok": True}


# ── Profile CRUD: Projects ───────────────────────────────────────

@app.post("/api/v1/profile/project")
async def add_project_endpoint(body: ProjectBody):
    from db.client import add_project
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Project title is required")
    return add_project(body.title, body.stack, body.repo, body.impact)


@app.put("/api/v1/profile/project/{pid}")
async def update_project_endpoint(pid: str, body: ProjectBody):
    from db.client import update_project
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Project title is required")
    return update_project(pid, body.title, body.stack, body.repo, body.impact)


@app.delete("/api/v1/profile/project/{pid}")
async def delete_project_endpoint(pid: str):
    from db.client import delete_project
    delete_project(pid)
    return {"ok": True}


@app.post("/api/v1/scan")
async def scan():
    global _scan_task
    if _scan_task and not _scan_task.done():
        raise HTTPException(status_code=409, detail="Scan already running")
    if _reevaluate_task and not _reevaluate_task.done():
        raise HTTPException(status_code=409, detail="Re-evaluation already running")
    _scan_stop.clear()
    _scan_task = asyncio.create_task(_run_scan_task())
    return {"status": "scanning"}


@app.post("/api/v1/scan/stop")
async def stop_scan():
    if not _scan_task or _scan_task.done():
        return {"status": "idle"}
    _scan_stop.set()
    await cm.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped by user."})
    return {"status": "stopping"}


@app.post("/api/v1/leads/reevaluate")
async def reevaluate_jobs():
    global _reevaluate_task
    if _reevaluate_task and not _reevaluate_task.done():
        raise HTTPException(status_code=409, detail="Re-evaluation already running")
    if _scan_task and not _scan_task.done():
        raise HTTPException(status_code=409, detail="Scan already running")
    _reevaluate_stop.clear()
    _reevaluate_task = asyncio.create_task(_run_reevaluate_jobs_task())
    return {"status": "reevaluating"}


@app.post("/api/v1/leads/reevaluate/stop")
async def stop_reevaluate_jobs():
    if not _reevaluate_task or _reevaluate_task.done():
        return {"status": "idle"}
    _reevaluate_stop.set()
    await cm.broadcast({"type": "agent", "event": "reeval_done", "msg": "Re-evaluation stopped by user."})
    return {"status": "stopping"}


@app.post("/api/v1/leads/cleanup")
async def cleanup_leads(dry_run: bool = False, limit: int = 1000):
    from db.client import cleanup_bad_leads, get_lead_by_id

    await cm.broadcast({
        "type": "agent",
        "event": "cleanup_start",
        "msg": f"Scanning up to {limit} leads for bad data...",
    })
    result = await asyncio.to_thread(cleanup_bad_leads, limit, dry_run)

    if not dry_run:
        for item in result.get("items", [])[:100]:
            lead = await asyncio.to_thread(get_lead_by_id, item["job_id"])
            if lead:
                await cm.broadcast({"type": "LEAD_UPDATED", "data": lead})

    action = "would discard" if dry_run else "discarded"
    await cm.broadcast({
        "type": "agent",
        "event": "cleanup_done",
        "msg": f"Cleanup scanned {result['scanned']} leads and {action} {result['candidates']} bad rows.",
    })
    return result


@app.post("/api/v1/free-sources/scan")
async def free_sources_scan():
    from db.client import get_settings
    cfg = get_settings()
    leads = await _run_free_source_scan(cfg, "job")
    return {"status": "done", "leads": len(leads)}


async def _run_scan_task():
    global _scan_task
    try:
        await _run_scan()
    except Exception as exc:
        print(f"[scan] failed: {exc}", file=sys.stderr)
        await cm.broadcast({"type": "agent", "event": "eval_done", "msg": f"Scan failed: {exc}"})
    finally:
        _scan_task = None


async def _run_reevaluate_jobs_task():
    global _reevaluate_task
    try:
        await _run_reevaluate_jobs()
    except Exception as exc:
        print(f"[reevaluate] failed: {exc}", file=sys.stderr)
        await cm.broadcast({"type": "agent", "event": "reeval_done", "msg": f"Re-evaluation failed: {exc}"})
    finally:
        _reevaluate_task = None


async def _run_reevaluate_jobs():
    from db.client import get_settings, get_job_leads_for_evaluation, get_lead_by_id, update_lead_score, get_profile
    from agents.evaluator import score as _score

    cfg = await asyncio.to_thread(get_settings)
    profile = await asyncio.to_thread(get_profile)
    jobs = await asyncio.to_thread(get_job_leads_for_evaluation)
    total = len(jobs)
    scored = 0
    failed = 0

    await cm.broadcast({
        "type": "agent",
        "event": "reeval_start",
        "msg": f"Re-evaluating {total} job leads via {cfg.get('llm_provider', 'ollama')}",
    })

    for index, lead in enumerate(jobs, start=1):
        if _reevaluate_stop.is_set():
            await cm.broadcast({
                "type": "agent",
                "event": "reeval_done",
                "msg": f"Re-evaluation stopped after {scored}/{total} jobs.",
            })
            return

        try:
            result = await asyncio.to_thread(_score, _job_eval_document(lead), profile)
            preserve_status = _should_preserve_job_status(lead.get("status", ""))
            await asyncio.to_thread(
                update_lead_score,
                lead["job_id"], result["score"], result["reason"],
                result.get("match_points", []), result.get("gaps", []),
                preserve_status,
            )
            saved = await asyncio.to_thread(get_lead_by_id, lead["job_id"])
            await cm.broadcast({"type": "LEAD_UPDATED", "data": saved or {**lead, **result}})
            scored += 1
            await cm.broadcast({
                "type": "agent",
                "event": "reeval_scored",
                "msg": f"[{index}/{total}] Re-scored {lead.get('title','')} = {result['score']}/100",
            })
        except Exception as e:
            failed += 1
            await cm.broadcast({
                "type": "agent",
                "event": "reeval_error",
                "msg": f"Re-eval failed for {lead.get('title','')}: {e}",
            })

    summary = f"Re-evaluation complete - {scored}/{total} jobs scored"
    if failed:
        summary += f", {failed} failed"
    await cm.broadcast({"type": "agent", "event": "reeval_done", "msg": summary})


async def _run_scan():
    from db.client import get_settings, get_discovered_leads, update_lead_score, get_profile
    from agents.scout import run as _scout
    from agents.evaluator import score as _score
    from agents.query_gen import generate as _gen_queries

    cfg     = get_settings()
    profile = get_profile()
    raw_urls = _job_targets(cfg.get("job_boards", ""))
    await _run_x_signal_scan(cfg, "job")
    await _run_free_source_scan(cfg, "job")

    # ── Replace static site: keywords with profile-tailored queries ──────
    await cm.broadcast({"type": "agent", "event": "query_gen_start",
                        "msg": "Generating profile-tailored search queries…"})
    try:
        urls = await asyncio.to_thread(_gen_queries, profile, raw_urls)
        await cm.broadcast({"type": "agent", "event": "query_gen_done",
                            "msg": f"Search plan ready — {len(urls)} targets"})
        for u in urls:
            await cm.broadcast({"type": "agent", "event": "query_gen_target", "msg": u})
    except Exception as exc:
        urls = raw_urls
        await cm.broadcast({"type": "agent", "event": "query_gen_error",
                            "msg": f"Query generation failed ({exc}), using raw URLs"})

    await cm.broadcast({"type": "agent", "event": "scout_start", "msg": f"Launching scan for {len(urls)} targets…"})

    leads = await asyncio.to_thread(
        _scout,
        urls=urls,
        apify_token=cfg.get("apify_token") or None,
        apify_actor=cfg.get("apify_actor") or None,
    )
    await cm.broadcast({"type": "agent", "event": "scout_done", "msg": f"Scout finished — {len(leads)} new leads found"})

    if _scan_stop.is_set():
        await cm.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped after scouting."})
        return

    discovered = await asyncio.to_thread(get_discovered_leads)
    await cm.broadcast({"type": "agent", "event": "eval_start", "msg": f"Evaluating {len(discovered)} leads via {cfg.get('llm_provider', 'ollama')}"})

    for lead in discovered:
        if _scan_stop.is_set():
            await cm.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped during evaluation."})
            return
        try:
            desc = (lead.get("description") or "").strip()
            jd = (
                f"Job Title: {lead.get('title','')}\n"
                f"Company: {lead.get('company','')}\n"
                f"URL: {lead.get('url','')}\n"
                + (f"Description: {desc}" if desc else "")
            )
            result = await asyncio.to_thread(_score, jd, profile)
            await asyncio.to_thread(
                update_lead_score,
                lead["job_id"], result["score"], result["reason"],
                result.get("match_points", []), result.get("gaps", []),
            )
            await cm.broadcast({"type": "LEAD_UPDATED", "data": {**lead, **result}})
            await cm.broadcast({"type": "agent", "event": "eval_scored", "msg": f"Scored {lead.get('title','')} = {result['score']}/100"})
        except Exception as e:
            await cm.broadcast({"type": "agent", "event": "eval_error", "msg": f"Eval failed for {lead.get('title','')}: {e}"})

    await cm.broadcast({"type": "agent", "event": "eval_done", "msg": "Evaluation cycle complete"})


def _sensitive(d: dict) -> set:
    """Keys that should be masked on reads and preserved on writes."""
    fixed = {"anthropic_key", "linkedin_cookie", "x_bearer_token"}
    dynamic = {k for k in d if k.endswith("_api_key") or k.endswith("_key") or k.endswith("_token")}
    return fixed | dynamic


@app.get("/api/v1/settings")
async def get_cfg():
    from db.client import get_settings
    s = get_settings()
    _m = "••••••••••••••••••••"
    for k in _sensitive(s):
        if s.get(k):
            s[k] = _m
    return s


@app.post("/api/v1/settings")
async def save_cfg(body: SettingsBody):
    from db.client import get_settings, save_settings
    payload = {k: "" if v is None else str(v) for k, v in body.model_dump().items()}
    old = get_settings()
    _m = "••••••••••••••••••••"
    for k in _sensitive({**old, **payload}):
        if payload.get(k) == _m:
            payload[k] = old.get(k, "")
    save_settings(payload)
    ghost = payload.get("ghost_mode") == "true"
    if ghost and not _sched.get_job("ghost"):
        _sched.add_job(_ghost_tick, "interval", hours=6, id="ghost")
    return {"ok": True}


@app.post("/api/v1/ingest")
async def ingest(
    raw: str = Form(""),
    file: UploadFile | None = File(None),
):
    from agents.ingestor import ingest as _ingest
    pdf_path = None
    if file and file.filename:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        shutil.copyfileobj(file.file, tmp)
        tmp.close()
        pdf_path = tmp.name
    try:
        p = await asyncio.to_thread(_ingest, raw, pdf_path)
        try:
            from db.client import refresh_profile_snapshot
            await asyncio.to_thread(refresh_profile_snapshot)
        except Exception:
            pass
        await cm.broadcast({"type": "agent", "event": "ingested",
                            "msg": f"Profile ingested: {p.n} — {len(p.skills)} skills"})
        return p.model_dump()
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if pdf_path and os.path.exists(pdf_path):
            os.unlink(pdf_path)


def _asset_ready(path: str) -> bool:
    return bool(path) and os.path.isfile(path)


def _fire_blocker(lead: dict, asset: str) -> tuple[int, str]:
    if not lead:
        return 404, "Lead not found"
    if lead.get("status") == "applied":
        return 409, "Lead is already marked applied"
    if not lead.get("url"):
        return 409, "Lead has no application URL"
    if not _asset_ready(asset):
        return 409, "Generate a resume before firing this application"
    cover = lead.get("cover_letter_asset") or lead.get("cover_letter_path") or ""
    if not _asset_ready(cover):
        return 409, "Generate a cover letter before firing this application"
    return 0, ""


@app.post("/api/v1/fire/{job_id}")
async def fire(job_id: str, bt: BackgroundTasks):
    from db.client import get_lead_for_fire
    lead, asset = await asyncio.to_thread(get_lead_for_fire, job_id)
    status, detail = _fire_blocker(lead, asset)
    if detail:
        raise HTTPException(status_code=status, detail=detail)
    bt.add_task(_actuate, job_id)
    return {"status": "firing", "job_id": job_id}


async def _generate_one(jid: str):
    from agents.generator import run_package as _gen
    from db.client import get_lead_by_id, save_asset_package, get_setting
    lead = get_lead_by_id(jid)
    if not lead:
        await cm.broadcast({"type": "agent", "event": "gen_error", "msg": f"Lead {jid} not found"})
        return
    template = get_setting("resume_template", "")
    await cm.broadcast({"type": "agent", "event": "gen_start",
                        "msg": f"Generating for {lead.get('title','?')} @ {lead.get('company','?')}"})
    try:
        package = await asyncio.to_thread(_gen, lead, template)
        save_asset_package(
            jid,
            package["resume"],
            package["cover_letter"],
            package.get("selected_projects", []),
        )
        await cm.broadcast({"type": "LEAD_UPDATED", "data": {
            **lead,
            "asset": package["resume"],
            "resume_asset": package["resume"],
            "cover_letter_asset": package["cover_letter"],
            "selected_projects": package.get("selected_projects", []),
            "status": "approved",
        }})
        await cm.broadcast({"type": "agent", "event": "gen_done", "msg": f"Resume and cover letter ready: {lead.get('title','?')}"})
    except Exception as exc:
        await cm.broadcast({"type": "agent", "event": "gen_error",
                            "msg": f"Generation failed for {lead.get('title','?')}: {exc}"})


async def _actuate(jid: str):
    from agents.actuator import run as _act
    from db.client import get_lead_for_fire, mark_applied
    try:
        lead, asset = await asyncio.to_thread(get_lead_for_fire, jid)
        _status, detail = _fire_blocker(lead, asset)
        if detail:
            await cm.broadcast({"type": "agent", "event": "failed", "job_id": jid,
                                "msg": f"Submission blocked for {jid}: {detail}"})
            return

        await cm.broadcast({"type": "agent", "event": "actuating", "job_id": jid,
                            "msg": f"Opening browser for {lead.get('title','')} @ {lead.get('company','')}"})
        ok = await asyncio.to_thread(_act, lead, asset)
    except Exception as exc:
        await cm.broadcast({"type": "agent", "event": "failed", "job_id": jid,
                            "msg": f"Submission failed for {jid}: {exc}"})
        return

    if ok:
        await asyncio.to_thread(mark_applied, jid)
        await cm.broadcast({"type": "agent", "event": "applied", "job_id": jid,
                            "msg": f"Application submitted for {jid}"})
    else:
        await cm.broadcast({"type": "agent", "event": "failed", "job_id": jid,
                            "msg": f"Submission failed for {jid}"})


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    await cm.add(ws)
    beat = 0
    try:
        while True:
            beat += 1
            await ws.send_text(json.dumps({
                "type": "heartbeat", "status": "alive", "beat": beat,
                "uptime_seconds": round(time.monotonic() - _UP, 2),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=2.0)
                if msg == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[ws] {exc}", file=sys.stderr)
    finally:
        cm.remove(ws)


if __name__ == "__main__":
    import uvicorn
    port = _free_port()
    print(f"PORT:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
