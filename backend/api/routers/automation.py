from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import Field

from api.dependencies import get_automation_service, get_repository
from automation.service import AutomationService
from core.types import StrictBody
from data.repository import Repository


class FormReadBody(StrictBody):
    url: str = Field(default="", max_length=2000)


def asset_ready(path: str) -> bool:
    return bool(path) and os.path.isfile(path)


def fire_blocker(lead: dict, asset: str) -> tuple[int, str]:
    if not lead:
        return 404, "Lead not found"
    if lead.get("status") == "applied":
        return 409, "Lead is already marked applied"
    if not lead.get("url"):
        return 409, "Lead has no application URL"
    if not asset_ready(asset):
        return 409, "Generate a resume before firing this application"
    cover = lead.get("cover_letter_asset") or lead.get("cover_letter_path") or ""
    if not asset_ready(cover):
        return 409, "Generate a cover letter before firing this application"
    return 0, ""


async def actuate_job(job_id: str, manager, repo: Repository | None = None, service: AutomationService | None = None) -> None:
    repo = repo or get_repository()
    service = service or get_automation_service()
    try:
        lead, asset = await service.get_lead_for_fire(job_id)
        _status, detail = fire_blocker(lead, asset)
        if detail:
            await manager.broadcast({
                "type": "agent",
                "event": "failed",
                "job_id": job_id,
                "msg": f"Submission blocked for {job_id}: {detail}",
            })
            return

        await manager.broadcast({
            "type": "agent",
            "event": "actuating",
            "job_id": job_id,
            "msg": f"Opening browser for {lead.get('title','')} @ {lead.get('company','')}",
        })
        ok = await service.submit_application(lead, asset)
    except Exception as exc:
        await manager.broadcast({
            "type": "agent",
            "event": "failed",
            "job_id": job_id,
            "msg": f"Submission failed for {job_id}: {exc}",
        })
        return

    if ok:
        await service.mark_applied(job_id)
        await manager.broadcast({
            "type": "agent",
            "event": "applied",
            "job_id": job_id,
            "msg": f"Application submitted for {job_id}",
        })
    else:
        await manager.broadcast({
            "type": "agent",
            "event": "failed",
            "job_id": job_id,
            "msg": f"Submission failed for {job_id}",
        })


def create_router(manager) -> APIRouter:
    router = APIRouter(prefix="/api/v1", tags=["automation"])

    @router.post("/fire/{job_id}")
    async def fire(
        job_id: str,
        bt: BackgroundTasks,
        repo: Repository = Depends(get_repository),
        service: AutomationService = Depends(get_automation_service),
    ):
        lead, asset = await service.get_lead_for_fire(job_id)
        status, detail = fire_blocker(lead, asset)
        if detail:
            raise HTTPException(status_code=status, detail=detail)
        bt.add_task(actuate_job, job_id, manager, repo, service)
        return {"status": "firing", "job_id": job_id}

    @router.post("/leads/{job_id}/form/read")
    async def read_lead_form(
        job_id: str,
        body: FormReadBody,
        repo: Repository = Depends(get_repository),
        service: AutomationService = Depends(get_automation_service),
    ):
        lead = repo.leads.get_lead_by_id(job_id)
        if not lead:
            raise HTTPException(404, "lead not found")

        url = (body.url or lead.get("url") or "").strip()
        if not url:
            raise HTTPException(400, "no url available for this lead")

        profile = repo.profile.get_profile()
        candidate = profile.get("candidate") or {}
        cfg = repo.settings.get_settings()
        identity = {
            "name": cfg.get("full_name", "") or candidate.get("n", ""),
            "email": cfg.get("email", ""),
            "phone": cfg.get("phone", ""),
            "linkedin_url": cfg.get("linkedin_url", ""),
            "github": cfg.get("github_url", ""),
            "website": cfg.get("website_url", ""),
            "city": cfg.get("city", ""),
            "current_company": cfg.get("current_company", ""),
        }

        cover_letter = lead.get("cover_letter_asset", "")
        if cover_letter and os.path.isfile(cover_letter):
            try:
                md_path = cover_letter.replace(".pdf", ".md")
                if os.path.isfile(md_path):
                    with open(md_path, encoding="utf-8") as file:
                        cover_letter = file.read()
                else:
                    cover_letter = ""
            except Exception:
                cover_letter = ""

        return await service.read_form(url, identity, cover_letter=cover_letter)

    @router.get("/identity")
    async def get_identity(repo: Repository = Depends(get_repository)):
        cfg = repo.settings.get_settings()
        return {
            "full_name": cfg.get("full_name", ""),
            "email": cfg.get("email", ""),
            "phone": cfg.get("phone", ""),
            "linkedin_url": cfg.get("linkedin_url", ""),
            "github_url": cfg.get("github_url", ""),
            "website_url": cfg.get("website_url", ""),
            "city": cfg.get("city", ""),
            "current_company": cfg.get("current_company", ""),
        }

    @router.post("/selectors/refresh")
    async def refresh_selectors(service: AutomationService = Depends(get_automation_service)):
        data = await service.refresh_selectors()
        return {"version": data.get("version"), "platforms": list(data.get("platforms", {}).keys())}

    @router.post("/leads/{job_id}/apply/preview")
    async def preview_apply(job_id: str, service: AutomationService = Depends(get_automation_service)):
        lead, asset = await service.get_lead_for_fire(job_id)
        status_code, detail = fire_blocker(lead, asset)
        if detail:
            raise HTTPException(status_code=status_code, detail=detail)
        return await service.preview_application(lead, asset)

    return router
