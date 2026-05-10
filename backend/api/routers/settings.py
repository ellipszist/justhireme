from __future__ import annotations

import asyncio
import os
import time

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import APIRouter, Depends

from api.dependencies import get_repository
from api.scheduler import ensure_ghost_job
from core.types import SettingsBody, TemplateBody
from data.repository import Repository


MASK = "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"


def sensitive_keys(settings: dict) -> set:
    fixed = {"anthropic_key", "linkedin_cookie", "x_bearer_token", "custom_connector_headers"}
    dynamic = {key for key in settings if key.endswith("_api_key") or key.endswith("_key") or key.endswith("_token")}
    return fixed | dynamic


async def probe_provider_key(provider: str, key: str) -> dict:
    import httpx
    from llm import _OPENAI_COMPAT_BASE_URLS

    started = time.perf_counter()
    try:
        timeout = httpx.Timeout(5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider == "anthropic":
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-haiku-4-5-20251001",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
                status = "ok" if response.status_code in {200, 400} else "invalid_key" if response.status_code == 401 else "unreachable"
            elif provider == "openai":
                response = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                status = "ok" if response.status_code == 200 else "invalid_key" if response.status_code == 401 else "unreachable"
            elif provider == "groq":
                response = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                status = "ok" if response.status_code == 200 else "invalid_key" if response.status_code == 401 else "unreachable"
            elif provider == "gemini":
                response = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/openai/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                status = "ok" if response.status_code == 200 else "invalid_key" if response.status_code in {401, 403} else "unreachable"
            elif provider in _OPENAI_COMPAT_BASE_URLS:
                response = await client.get(
                    f"{_OPENAI_COMPAT_BASE_URLS[provider].rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                status = "ok" if response.status_code == 200 else "invalid_key" if response.status_code in {401, 403} else "unreachable"
            else:
                status = "unchecked"
    except Exception:
        status = "unreachable"
    return {"status": status, "latency_ms": round((time.perf_counter() - started) * 1000)}


def create_router(scheduler: AsyncIOScheduler, ghost_tick) -> APIRouter:
    router = APIRouter(prefix="/api/v1", tags=["settings"])

    @router.get("/template")
    async def get_template(repo: Repository = Depends(get_repository)):
        return {"template": repo.settings.get_setting("resume_template", "")}

    @router.post("/template")
    async def save_template(body: TemplateBody, repo: Repository = Depends(get_repository)):
        repo.settings.save_settings({"resume_template": body.template})
        return {"ok": True}

    @router.get("/settings")
    async def get_cfg(repo: Repository = Depends(get_repository)):
        settings = repo.settings.get_settings()
        for key in sensitive_keys(settings):
            if settings.get(key):
                settings[key] = MASK
        return settings

    @router.get("/settings/validate")
    async def validate_settings(repo: Repository = Depends(get_repository)):
        from llm import _ENV_NAMES, _KEY_NAMES, _OPENAI_COMPAT_BASE_URLS

        cfg = repo.settings.get_settings()
        probed = {"anthropic", "gemini", "openai", "groq", *_OPENAI_COMPAT_BASE_URLS}
        providers = [
            "anthropic",
            "gemini",
            "openai",
            "groq",
            *[provider for provider in _KEY_NAMES if provider not in {"anthropic", "gemini", "openai", "groq"}],
        ]

        async def one(provider: str):
            key_name = _KEY_NAMES.get(provider, "")
            key = str(
                cfg.get(key_name)
                or os.environ.get(_ENV_NAMES.get(provider, ""), "")
                or (os.environ.get("GOOGLE_API_KEY", "") if provider == "gemini" else "")
                or ""
            ).strip()
            if not key:
                return provider, {"status": "not_configured", "latency_ms": 0}
            if provider not in probed:
                return provider, {"status": "unchecked", "latency_ms": 0}
            return provider, await probe_provider_key(provider, key)

        pairs = await asyncio.gather(*(one(provider) for provider in providers))
        return {provider: result for provider, result in pairs}

    @router.post("/settings")
    async def save_cfg(body: SettingsBody, repo: Repository = Depends(get_repository)):
        payload = {key: "" if value is None else str(value) for key, value in body.model_dump().items()}
        old = repo.settings.get_settings()
        for key in sensitive_keys({**old, **payload}):
            if payload.get(key) == MASK:
                payload[key] = old.get(key, "")
        repo.settings.save_settings(payload)
        if payload.get("ghost_mode") == "true":
            ensure_ghost_job(scheduler, ghost_tick)
        return {"ok": True}

    return router
