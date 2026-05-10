from __future__ import annotations

from fastapi import APIRouter, HTTPException

from core.types import CandidateBody, ExperienceBody, ProjectBody, SkillBody


router = APIRouter(prefix="/api/v1", tags=["profile"])


def _profile_service():
    from profile.service import ProfileService

    return ProfileService()


@router.get("/profile")
async def get_profile_endpoint():
    return _profile_service().get_profile()


@router.put("/profile/candidate")
async def update_candidate_endpoint(body: CandidateBody):
    if not body.n.strip() and not body.s.strip():
        raise HTTPException(status_code=422, detail="Name or summary is required")
    return _profile_service().update_candidate(body.n, body.s)


@router.post("/profile/skill")
async def add_skill_endpoint(body: SkillBody):
    if not body.n.strip():
        raise HTTPException(status_code=422, detail="Skill name is required")
    return _profile_service().add_skill(body.n, body.cat)


@router.put("/profile/skill/{sid}")
async def update_skill_endpoint(sid: str, body: SkillBody):
    if not body.n.strip():
        raise HTTPException(status_code=422, detail="Skill name is required")
    return _profile_service().update_skill(sid, body.n, body.cat)


@router.delete("/profile/skill/{sid}")
async def delete_skill_endpoint(sid: str):
    _profile_service().delete_skill(sid)
    return {"ok": True}


@router.post("/profile/experience")
async def add_experience_endpoint(body: ExperienceBody):
    if not body.role.strip() and not body.co.strip():
        raise HTTPException(status_code=422, detail="Role or company is required")
    return _profile_service().add_experience(body.role, body.co, body.period, body.d)


@router.put("/profile/experience/{eid}")
async def update_experience_endpoint(eid: str, body: ExperienceBody):
    if not body.role.strip() and not body.co.strip():
        raise HTTPException(status_code=422, detail="Role or company is required")
    return _profile_service().update_experience(eid, body.role, body.co, body.period, body.d)


@router.delete("/profile/experience/{eid}")
async def delete_experience_endpoint(eid: str):
    _profile_service().delete_experience(eid)
    return {"ok": True}


@router.post("/profile/project")
async def add_project_endpoint(body: ProjectBody):
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Project title is required")
    return _profile_service().add_project(body.title, body.stack, body.repo, body.impact)


@router.put("/profile/project/{pid}")
async def update_project_endpoint(pid: str, body: ProjectBody):
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Project title is required")
    return _profile_service().update_project(pid, body.title, body.stack, body.repo, body.impact)


@router.delete("/profile/project/{pid}")
async def delete_project_endpoint(pid: str):
    _profile_service().delete_project(pid)
    return {"ok": True}
