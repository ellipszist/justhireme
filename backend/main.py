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


async def _ghost_tick():
    from db.client import get_setting, get_settings
    if get_setting("ghost_mode") != "true":
        return
    cfg = get_settings()
    boards = [b.strip() for b in cfg.get("job_boards", "").split(",") if b.strip()]
    if not boards:
        return
    from agents.scout import run as _scout
    await cm.broadcast({"type": "agent", "event": "ghost_scout", "msg": "Ghost Mode: scout cycle starting"})
    leads = await asyncio.to_thread(
        _scout,
        urls=None,
        queries=boards,
        apify_token=cfg.get("apify_token") or None,
        apify_actor=cfg.get("apify_actor") or None,
    )
    await cm.broadcast({"type": "agent", "event": "ghost_scout",
                        "msg": f"Ghost scout complete — {len(leads)} new leads"})


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


@app.get("/api/v1/graph")
async def graph_stats():
    from db.client import conn
    out = {}
    for t in ["Candidate", "Skill", "Project", "Experience", "JobLead"]:
        r = conn.execute(f"MATCH (n:{t}) RETURN count(n)")
        out[t.lower()] = r.get_next()[0] if r.has_next() else 0
    return out


@app.post("/api/v1/scan")
async def scan(bt: BackgroundTasks):
    bt.add_task(_run_scan)
    return {"status": "scanning"}


async def _run_scan():
    from db.client import get_settings, get_discovered_leads
    from agents.scout import run as _scout
    from agents.evaluator import score as _score
    from db.client import update_lead_score

    cfg = get_settings()
    boards = [b.strip() for b in cfg.get("job_boards", "").split(",") if b.strip()]
    urls = [b for b in boards if b.startswith("http")]
    queries = [b for b in boards if not b.startswith("http")]

    await cm.broadcast({"type": "agent", "event": "scout_start", "msg": f"Scout scanning {len(urls)} URLs, {len(queries)} queries"})

    leads = await asyncio.to_thread(_scout, urls=urls or None, queries=queries or None,
                                     apify_token=cfg.get("apify_token") or None,
                                     apify_actor=cfg.get("apify_actor") or None)

    for l in leads:
        await cm.broadcast({"type": "LEAD_UPDATED", "data": l})
        await cm.broadcast({"type": "agent", "event": "scout_found", "msg": f"Found: {l.get('title','')} @ {l.get('company','')}"})

    await cm.broadcast({"type": "agent", "event": "scout_done", "msg": f"Scout done — {len(leads)} new leads"})

    discovered = await asyncio.to_thread(get_discovered_leads)
    await cm.broadcast({"type": "agent", "event": "eval_start", "msg": f"Evaluating {len(discovered)} leads via {cfg.get('llm_provider', 'ollama')}"})

    for lead in discovered:
        try:
            jd = f"{lead.get('title','')} at {lead.get('company','')} — {lead.get('url','')}"
            result = await asyncio.to_thread(_score, jd, lead.get("skills", []))
            await asyncio.to_thread(update_lead_score, lead["job_id"], result["score"], result["reason"])
            await cm.broadcast({"type": "LEAD_UPDATED", "data": {**lead, **result}})
            await cm.broadcast({"type": "agent", "event": "eval_scored",
                                "msg": f"Scored {lead.get('title','')} = {result['score']}/100"})
        except Exception as e:
            await cm.broadcast({"type": "agent", "event": "eval_error", "msg": f"Eval failed for {lead.get('title','')}: {e}"})

    await cm.broadcast({"type": "agent", "event": "eval_done", "msg": "Evaluation cycle complete"})

@app.get("/api/v1/settings")
async def get_cfg():
    from db.client import get_settings
    s = get_settings()
    _m = "••••••••••••••••••••"
    for k in ("anthropic_key", "groq_api_key", "nvidia_api_key", "linkedin_cookie"):
        if s.get(k):
            s[k] = _m
    return s


@app.post("/api/v1/settings")
async def save_cfg(body: dict):
    from db.client import get_settings, save_settings
    old = get_settings()
    _m = "••••••••••••••••••••"
    for k in ("anthropic_key", "groq_api_key", "nvidia_api_key", "linkedin_cookie"):
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
                "type": "heartbeat",
                "status": "alive",
                "beat": beat,
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
