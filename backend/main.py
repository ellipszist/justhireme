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

from fastapi import BackgroundTasks, FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


_UP   = time.monotonic()
_sched = AsyncIOScheduler()


class _CM:
    def __init__(self):
        self._ws: list[WebSocket] = []

    async def add(self, ws: WebSocket):
        self._ws.append(ws)

    def remove(self, ws: WebSocket):
        self._ws = [w for w in self._ws if w != ws]

    async def broadcast(self, msg: dict):
        dead = []
        for w in self._ws:
            try:
                await w.send_text(json.dumps(msg))
            except Exception:
                dead.append(w)
        for w in dead:
            self._ws.remove(w)


cm = _CM()

# ── Scan stop flag ─────────────────────────────────────────────────────────────
# Set by /api/v1/scan/stop; cleared at the start of every _run_scan call.
_scan_stop = asyncio.Event()


async def _ghost_tick():
    from db.client import get_setting, get_settings, get_discovered_leads, update_lead_score, get_profile, save_asset_package
    from agents.scout import run as _scout
    from agents.evaluator import score as _score
    from agents.generator import run_package as _gen

    if get_setting("ghost_mode") != "true":
        return

    cfg = get_settings()
    boards = [b.strip() for b in cfg.get("job_boards", "").split(",") if b.strip()]
    if not boards:
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
            jd = f"{lead.get('title','')} at {lead.get('company','')} — {lead.get('url','')}"
            result = await asyncio.to_thread(_score, jd, profile)
            await asyncio.to_thread(
                update_lead_score,
                lead["job_id"], result["score"], result["reason"], result.get("match_points", [])
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
    from db.client import mark_applied
    await cm.broadcast({"type": "agent", "event": "ghost_apply",
                        "msg": f"Ghost Mode: auto-applying to {len(generated)} leads"})
    for item in generated:
        try:
            ok = await asyncio.to_thread(_act, item, item.get("asset", ""))
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
    allow_origins=["*"],
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


@app.get("/api/v1/leads")
async def leads():
    from db.client import get_all_leads
    return get_all_leads()


@app.get("/api/v1/leads/{job_id}")
async def get_lead(job_id: str):
    from db.client import get_lead_by_id
    from fastapi import HTTPException
    lead = get_lead_by_id(job_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@app.delete("/api/v1/leads/{job_id}")
async def delete_lead_endpoint(job_id: str):
    from db.client import delete_lead
    delete_lead(job_id)
    return {"ok": True}


@app.put("/api/v1/leads/{job_id}/status")
async def update_status(job_id: str, body: dict):
    from db.client import update_lead_status
    from fastapi import HTTPException
    try:
        update_lead_status(job_id, body.get("status", ""))
        await cm.broadcast({"type": "LEAD_UPDATED", "data": {"job_id": job_id, "status": body.get("status")}})
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
async def save_template(body: dict):
    from db.client import save_settings
    save_settings({"resume_template": body.get("template", "")})
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
async def update_candidate_endpoint(body: dict):
    from db.client import update_candidate
    return update_candidate(body.get("n", ""), body.get("s", ""))


# ── Profile CRUD: Skills ──────────────────────────────────────────

@app.post("/api/v1/profile/skill")
async def add_skill_endpoint(body: dict):
    from db.client import add_skill
    return add_skill(body.get("n", ""), body.get("cat", "general"))


@app.put("/api/v1/profile/skill/{sid}")
async def update_skill_endpoint(sid: str, body: dict):
    from db.client import update_skill
    return update_skill(sid, body.get("n", ""), body.get("cat", "general"))


@app.delete("/api/v1/profile/skill/{sid}")
async def delete_skill_endpoint(sid: str):
    from db.client import delete_skill
    delete_skill(sid)
    return {"ok": True}


# ── Profile CRUD: Experience ──────────────────────────────────────

@app.post("/api/v1/profile/experience")
async def add_experience_endpoint(body: dict):
    from db.client import add_experience
    return add_experience(body.get("role", ""), body.get("co", ""), body.get("period", ""), body.get("d", ""))


@app.put("/api/v1/profile/experience/{eid}")
async def update_experience_endpoint(eid: str, body: dict):
    from db.client import update_experience
    return update_experience(eid, body.get("role", ""), body.get("co", ""), body.get("period", ""), body.get("d", ""))


@app.delete("/api/v1/profile/experience/{eid}")
async def delete_experience_endpoint(eid: str):
    from db.client import delete_experience
    delete_experience(eid)
    return {"ok": True}


# ── Profile CRUD: Projects ───────────────────────────────────────

@app.post("/api/v1/profile/project")
async def add_project_endpoint(body: dict):
    from db.client import add_project
    return add_project(body.get("title", ""), body.get("stack", ""), body.get("repo", ""), body.get("impact", ""))


@app.put("/api/v1/profile/project/{pid}")
async def update_project_endpoint(pid: str, body: dict):
    from db.client import update_project
    return update_project(pid, body.get("title", ""), body.get("stack", ""), body.get("repo", ""), body.get("impact", ""))


@app.delete("/api/v1/profile/project/{pid}")
async def delete_project_endpoint(pid: str):
    from db.client import delete_project
    delete_project(pid)
    return {"ok": True}


@app.post("/api/v1/scan")
async def scan(bt: BackgroundTasks):
    _scan_stop.clear()
    bt.add_task(_run_scan)
    return {"status": "scanning"}


@app.post("/api/v1/scan/stop")
async def stop_scan():
    _scan_stop.set()
    await cm.broadcast({"type": "agent", "event": "eval_done", "msg": "Scan stopped by user."})
    return {"status": "stopped"}


async def _run_scan():
    from db.client import get_settings, get_discovered_leads, update_lead_score, get_profile
    from agents.scout import run as _scout
    from agents.evaluator import score as _score
    from agents.query_gen import generate as _gen_queries

    cfg     = get_settings()
    profile = get_profile()
    raw_urls = [u.strip() for u in cfg.get("job_boards", "").split(",") if u.strip()]

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
    fixed = {"anthropic_key", "linkedin_cookie"}
    dynamic = {k for k in d if k.endswith("_api_key") or k.endswith("_key")}
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
async def save_cfg(body: dict):
    from db.client import get_settings, save_settings
    old = get_settings()
    _m = "••••••••••••••••••••"
    for k in _sensitive({**old, **body}):
        if body.get(k) == _m:
            body[k] = old.get(k, "")
    save_settings(body)
    ghost = body.get("ghost_mode") == "true"
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
        await cm.broadcast({"type": "agent", "event": "ingested",
                            "msg": f"Profile ingested: {p.n} — {len(p.skills)} skills"})
        return p.model_dump()
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if pdf_path and os.path.exists(pdf_path):
            os.unlink(pdf_path)


@app.post("/api/v1/fire/{job_id}")
async def fire(job_id: str, bt: BackgroundTasks):
    bt.add_task(_actuate, job_id)
    return {"status": "fired", "job_id": job_id}


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
    lead, asset = get_lead_for_fire(jid)
    await cm.broadcast({"type": "agent", "event": "actuating", "job_id": jid,
                        "msg": f"Opening browser for {lead.get('title','')} @ {lead.get('company','')}"})
    ok = await asyncio.to_thread(_act, lead, asset)
    if ok:
        mark_applied(jid)
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
