# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Vasudev Siddh and vasu-devs

import socket
import sys
import time

from fastapi import WebSocket
from api.app import create_app
from api.auth import create_api_token, require_ws_token
from api.scheduler import create_ghost_tick, create_lifespan, create_scheduler
from api.websocket import ConnectionManager, agent_event_action as _agent_event_action
from core.logging import get_logger

_log = get_logger(__name__)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


_UP   = time.monotonic()
_sched = create_scheduler()
_API_TOKEN: str = create_api_token()


async def _require_ws_token(ws: WebSocket) -> bool:
    return await require_ws_token(ws, lambda: _API_TOKEN)


cm = ConnectionManager()


_ghost_tick = create_ghost_tick(cm)
lifespan = create_lifespan(_sched, _ghost_tick, _log)


app = create_app(
    lifespan=lifespan,
    token_getter=lambda: _API_TOKEN,
    started_at=_UP,
    scheduler=_sched,
    ghost_tick=_ghost_tick,
    connection_manager=cm,
    logger=_log,
    websocket_token_guard=_require_ws_token,
)


if __name__ == "__main__":
    import uvicorn
    port = _free_port()
    sys.stdout.write(f"JHM_TOKEN={_API_TOKEN}\n")
    sys.stdout.write(f"PORT:{port}\n")
    sys.stdout.flush()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
