from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from api.dependencies import get_repository
from api.rate_limit import RateLimiter, require_rate_limit
from core.types import HelpChatBody
from core.telemetry import log_error
from data.repository import Repository


router = APIRouter(prefix="/api/v1", tags=["misc"])
_help_limiter = RateLimiter(20, 60)


@router.get("/graph")
async def graph_stats(repo: Repository = Depends(get_repository)):
    return repo.graph.graph_counts()


@router.post("/help/chat")
async def help_chat(body: HelpChatBody):
    require_rate_limit(_help_limiter)
    from help.service import answer

    history = [item.model_dump() for item in body.history]
    return await asyncio.to_thread(answer, body.question, history)


@router.post("/errors")
async def record_frontend_error(payload: dict):
    log_error(str(payload.get("error") or "Frontend error"), {"frontend": payload})
    return {"ok": True}
