from typing import List, Optional, TypedDict
from langgraph.graph import END, StateGraph
from langgraph.checkpoint.memory import MemorySaver


class St(TypedDict):
    raw:     str
    pdf:     Optional[str]
    profile: Optional[dict]
    err:     Optional[str]


def ingest(s: St) -> St:
    from agents.ingestor import run
    try:
        p = run(s.get("raw", ""), s.get("pdf"))
        return {**s, "profile": p.model_dump(), "err": None}
    except Exception as e:
        return {**s, "profile": None, "err": str(e)}


_g = StateGraph(St)
_g.add_node("ingest", ingest)
_g.set_entry_point("ingest")
_g.add_edge("ingest", END)
graph = _g.compile()


class ScoutSt(TypedDict):
    urls:        Optional[List[str]]
    queries:     Optional[List[str]]
    apify_token: Optional[str]
    apify_actor: Optional[str]
    leads:       Optional[List[dict]]
    err:         Optional[str]


def scout(s: ScoutSt) -> ScoutSt:
    from agents.scout import run
    try:
        leads = run(
            urls=s.get("urls"),
            queries=s.get("queries"),
            apify_token=s.get("apify_token"),
            apify_actor=s.get("apify_actor"),
        )
        return {**s, "leads": leads, "err": None}
    except Exception as e:
        return {**s, "leads": [], "err": str(e)}


_sg = StateGraph(ScoutSt)
_sg.add_node("scout", scout)
_sg.set_entry_point("scout")
_sg.add_edge("scout", END)
scout_graph = _sg.compile()


class EvalSt(TypedDict):
    leads:    Optional[List[dict]]
    scored:   Optional[List[dict]]
    approved: Optional[List[dict]]
    err:      Optional[str]


def evaluator(s: EvalSt) -> EvalSt:
    from agents.evaluator import score as _score
    from db.client import get_discovered_leads, update_lead_score
    from db.client import get_profile as _get_profile
    leads   = s.get("leads") or get_discovered_leads()
    scored  = []
    approved = []
    profile = _get_profile()
    try:
        for lead in leads:
            jd     = f"{lead.get('title','')} at {lead.get('company','')} — {lead.get('url','')}"
            result = _score(jd, profile)
            result["job_id"] = lead["job_id"]
            update_lead_score(
                lead["job_id"],
                result["score"],
                result["reason"],
                result.get("match_points", [])
            )
            scored.append(result)
            if result["score"] >= 85:
                approved.append({**lead, **result})
        return {**s, "scored": scored, "approved": approved, "err": None}
    except Exception as e:
        return {**s, "scored": scored, "approved": approved, "err": str(e)}


def _route(s: EvalSt) -> str:
    return "approved" if s.get("approved") else END


class GenSt(TypedDict):
    approved: Optional[List[dict]]
    assets:   Optional[List[dict]]
    err:      Optional[str]


def generator(s: GenSt) -> GenSt:
    from agents.generator import run_package as _gen
    from db.client import save_asset_package
    assets = []
    try:
        for lead in (s.get("approved") or []):
            package = _gen(lead)
            save_asset_package(
                lead["job_id"],
                package["resume"],
                package["cover_letter"],
                package.get("selected_projects", []),
            )
            assets.append({
                "job_id": lead["job_id"],
                "path": package["resume"],
                "resume": package["resume"],
                "cover_letter": package["cover_letter"],
                "selected_projects": package.get("selected_projects", []),
            })
        return {**s, "assets": assets, "err": None}
    except Exception as e:
        return {**s, "assets": assets, "err": str(e)}


_eg = StateGraph(EvalSt)
_eg.add_node("evaluator", evaluator)
_eg.add_node("approved", lambda s: s)
_eg.set_entry_point("evaluator")
_eg.add_conditional_edges("evaluator", _route, {"approved": "approved", END: END})
_eg.add_edge("approved", END)
eval_graph = _eg.compile()


_gg = StateGraph(GenSt)
_gg.add_node("generator", generator)
_gg.set_entry_point("generator")
_gg.add_edge("generator", END)
gen_graph = _gg.compile()


class PipeSt(TypedDict):
    approved: Optional[List[dict]]
    assets:   Optional[List[dict]]
    applied:  Optional[List[str]]
    err:      Optional[str]


def _gen_pipe(s: PipeSt) -> PipeSt:
    from agents.generator import run_package as _gen
    from db.client import save_asset_package
    assets = []
    try:
        for lead in (s.get("approved") or []):
            package = _gen(lead)
            save_asset_package(
                lead["job_id"],
                package["resume"],
                package["cover_letter"],
                package.get("selected_projects", []),
            )
            assets.append({
                "job_id": lead["job_id"],
                "path": package["resume"],
                "resume": package["resume"],
                "cover_letter": package["cover_letter"],
                "selected_projects": package.get("selected_projects", []),
                "lead": lead,
            })
        return {**s, "assets": assets, "err": None}
    except Exception as e:
        return {**s, "assets": assets, "err": str(e)}


def _act_pipe(s: PipeSt) -> PipeSt:
    from agents.actuator import run as _act
    from db.client import mark_applied
    applied = []
    try:
        for item in (s.get("assets") or []):
            ok = _act(item.get("lead", {}), item["path"])
            if ok:
                mark_applied(item["job_id"])
                applied.append(item["job_id"])
        return {**s, "applied": applied, "err": None}
    except Exception as e:
        return {**s, "applied": applied, "err": str(e)}


_mem = MemorySaver()
_pg  = StateGraph(PipeSt)
_pg.add_node("generator", _gen_pipe)
_pg.add_node("actuator",  _act_pipe)
_pg.set_entry_point("generator")
_pg.add_edge("generator", "actuator")
_pg.add_edge("actuator",  END)
pipeline_graph = _pg.compile(checkpointer=_mem, interrupt_before=["actuator"])
