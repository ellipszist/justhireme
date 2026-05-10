from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect


def agent_event_action(msg: dict) -> str:
    event = str(msg.get("event") or "agent").strip() or "agent"
    detail = str(msg.get("msg") or "").strip()
    return f"{event}: {detail}" if detail else event


class ConnectionManager:
    def __init__(self):
        self._ws: list[WebSocket] = []

    async def add(self, ws: WebSocket):
        self._ws.append(ws)

    def remove(self, ws: WebSocket):
        self._ws = [w for w in self._ws if w != ws]

    async def broadcast(self, msg: dict):
        if msg.get("type") == "agent":
            try:
                from api.dependencies import get_repository

                repo = get_repository()
                await asyncio.to_thread(repo.events.record_event, msg.get("job_id") or "__system__", agent_event_action(msg))
            except Exception:
                pass

        dead = []
        text = json.dumps(msg)

        async def _send(ws: WebSocket) -> None:
            try:
                await asyncio.wait_for(ws.send_text(text), timeout=2.0)
            except Exception:
                dead.append(ws)

        await asyncio.gather(*(_send(ws) for ws in list(self._ws)))
        for ws in dead:
            self.remove(ws)


async def websocket_loop(
    ws: WebSocket,
    *,
    manager: ConnectionManager,
    started_at: float,
    logger,
) -> None:
    await ws.accept()
    await manager.add(ws)
    beat = 0
    try:
        while True:
            beat += 1
            await ws.send_text(json.dumps({
                "type": "heartbeat",
                "status": "alive",
                "beat": beat,
                "uptime_seconds": round(time.monotonic() - started_at, 2),
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
        logger.warning("ws: %s", exc)
    finally:
        manager.remove(ws)


def register_websocket(
    app: FastAPI,
    *,
    token_guard,
    manager: ConnectionManager,
    started_at: float,
    logger,
) -> None:
    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        if not await token_guard(ws):
            return
        await websocket_loop(ws, manager=manager, started_at=started_at, logger=logger)
