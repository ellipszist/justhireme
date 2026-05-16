from __future__ import annotations

import os
import warnings
from datetime import UTC, datetime, timedelta

warnings.warn(
    "db.client is deprecated. Import from data.sqlite.leads, data.graph.profile, "
    "data.vector.embeddings, or data.repository instead.",
    DeprecationWarning,
    stacklevel=2,
)

from automation.service import get_lead_for_fire_sync
from data import feedback
from data.graph import connection as graph_connection
from data.graph import profile as graph_profile
from data.repository import create_repository
from data.sqlite import events as sqlite_events
from data.sqlite import leads as sqlite_leads
from data.sqlite import settings as sqlite_settings
from data.sqlite.connection import DEFAULT_DB_PATH, init_sql
from data.vector import connection as vector_connection
from core.logging import get_logger

_log = get_logger(__name__)

_b = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "JustHireMe")
_g = os.path.join(_b, "graph")
_v = os.path.join(_b, "vector")
sql = DEFAULT_DB_PATH
conn = graph_connection.conn
db = graph_connection.db
vec = vector_connection.vec
_NullVectorStore = vector_connection.NullVectorStore
_LEAD_SELECT_COLUMNS = sqlite_leads.LEAD_SELECT_COLUMNS
_json_list = sqlite_leads.json_list
_json_dict = sqlite_leads.json_dict
_json_dumps_list = sqlite_leads.json_dumps_list
_lead_row_dict = sqlite_leads.lead_row_dict
_stack_list = graph_profile.stack_list
_h = graph_profile.hash_id


def _utc_timestamp(offset: timedelta | None = None) -> str:
    value = datetime.now(UTC)
    if offset is not None:
        value += offset
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ensure_dir(path: str) -> str:
    try:
        os.makedirs(path, exist_ok=True)
        return path
    except Exception as exc:
        alt = f"{path}_store"
        try:
            os.makedirs(alt, exist_ok=True)
            _log.warning("storage path unavailable (%s: %s); using %s", path, exc, alt)
            return alt
        except Exception as alt_exc:
            _log.error("storage path unavailable (%s: %s; fallback: %s)", path, exc, alt_exc)
            return path


_b = _ensure_dir(_b)
_v = _ensure_dir(_v)


def graph_available() -> bool:
    return graph_connection.graph_available()


def graph_error() -> str:
    return graph_connection.graph_error()


def graph_counts() -> dict:
    return graph_connection.graph_counts()


def _init_sql():
    try:
        init_sql(sql)
    except Exception as exc:
        _log.warning("db.client compatibility init skipped: %s", exc)


_init_sql()


def record_event(job_id: str | None, action: str):
    sqlite_events.record_event(job_id, action, sql)


def url_exists(jid: str) -> bool:
    return sqlite_leads.url_exists(jid, sql)


def save_lead(
    jid: str,
    t: str,
    co: str,
    u: str,
    plat: str,
    desc: str = "",
    kind: str = "job",
    budget: str = "",
    signal_score: int = 0,
    signal_reason: str = "",
    signal_tags: list | None = None,
    outreach_reply: str = "",
    outreach_dm: str = "",
    outreach_email: str = "",
    proposal_draft: str = "",
    fit_bullets: list | str | None = None,
    followup_sequence: list | str | None = None,
    proof_snippet: str = "",
    tech_stack: list | str | None = None,
    location: str = "",
    urgency: str = "",
    base_signal_score: int | None = None,
    learning_delta: int | None = None,
    learning_reason: str = "",
    source_meta: dict | None = None,
):
    lead = {
        "job_id": jid,
        "title": t,
        "company": co,
        "url": u,
        "platform": plat,
        "description": desc,
        "kind": kind or "job",
        "budget": budget or "",
        "signal_score": int(signal_score or 0),
        "signal_reason": signal_reason or "",
        "signal_tags": signal_tags or [],
        "outreach_reply": outreach_reply or "",
        "outreach_dm": outreach_dm or "",
        "outreach_email": outreach_email or "",
        "proposal_draft": proposal_draft or "",
        "fit_bullets": fit_bullets or [],
        "followup_sequence": followup_sequence or [],
        "proof_snippet": proof_snippet or "",
        "tech_stack": tech_stack or [],
        "location": location or "",
        "urgency": urgency or "",
        "source_meta": source_meta or {},
    }
    if base_signal_score is None and learning_delta is None and not learning_reason:
        lead = feedback.rank_lead_by_feedback(lead, sql)
    else:
        lead["base_signal_score"] = int(base_signal_score if base_signal_score is not None else signal_score or 0)
        lead["learning_delta"] = int(learning_delta or 0)
        lead["learning_reason"] = learning_reason or ""
    sqlite_leads.save_lead(lead, sql)


def update_lead_score(jid: str, s: int, r: str, match_points: list | None = None, gaps: list | None = None, preserve_status: bool = False):
    sqlite_leads.update_lead_score(jid, s, r, match_points, gaps, preserve_status, sql)


def save_asset_path(jid: str, path: str):
    sqlite_leads.save_asset_path(jid, path, sql)


def save_asset_package(jid: str, resume_path: str, cover_letter_path: str = "", selected_projects: list | None = None, keyword_coverage: dict | None = None):
    sqlite_leads.save_asset_package(jid, resume_path, cover_letter_path, selected_projects, keyword_coverage, sql)


def save_contact_lookup(jid: str, contact_lookup: dict | None):
    sqlite_leads.save_contact_lookup(jid, contact_lookup, sql)


def mark_applied(jid: str):
    sqlite_leads.mark_applied(jid, sql)


def get_all_leads() -> list:
    return sqlite_leads.get_all_leads(sql)


def get_all_freelance_leads() -> list:
    return sqlite_leads.get_all_freelance_leads(sql)


def get_job_leads_for_evaluation() -> list:
    return sqlite_leads.get_job_leads_for_evaluation(sql)


def _cleanup_text(lead: dict) -> str:
    return sqlite_leads.cleanup_text(lead)


def _looks_like_cleanup_hn_job(text: str) -> bool:
    return sqlite_leads.looks_like_cleanup_hn_job(text)


def lead_cleanup_reasons(lead: dict) -> list[str]:
    return sqlite_leads.lead_cleanup_reasons(lead)


def cleanup_bad_leads(limit: int = 1000, dry_run: bool = False) -> dict:
    return sqlite_leads.cleanup_bad_leads(limit, dry_run, sql)


def get_feedback_training_examples(limit: int = 300) -> list[dict]:
    return feedback.get_feedback_training_examples(limit, sql)


def rank_lead_by_feedback(lead: dict) -> dict:
    out = dict(lead)
    try:
        from ranking.feedback_ranker import apply_feedback_learning

        examples = feedback.get_feedback_training_examples(300, sql)
        return apply_feedback_learning(out, examples)
    except Exception:
        return feedback.rank_lead_by_feedback(out, sql)


def recompute_learning_scores(limit: int = 500) -> int:
    try:
        from ranking.feedback_ranker import apply_feedback_learning
    except Exception:
        return 0

    examples = feedback.get_feedback_training_examples(300, sql)
    if not examples:
        return 0

    updated = 0
    for lead in sqlite_leads.get_leads_for_learning(limit, sql):
        base = int(lead.get("base_signal_score") or lead.get("signal_score") or 0)
        lead["signal_score"] = base
        lead["signal_reason"] = feedback._without_learning_suffix(lead.get("signal_reason", ""))
        ranked = apply_feedback_learning(lead, examples)
        sqlite_leads.update_learning_score(lead["job_id"], ranked, base, sql)
        updated += 1
    return updated


def get_lead_for_fire(jid: str) -> tuple:
    return get_lead_for_fire_sync(jid, create_repository())


def save_settings(d: dict):
    sqlite_settings.save_settings(d, sql)


def get_settings() -> dict:
    return sqlite_settings.get_settings(sql)


def get_setting(k: str, default: str = "") -> str:
    return sqlite_settings.get_setting(k, default, sql)


def get_lead_by_id(jid: str) -> dict:
    return sqlite_leads.get_lead_by_id(jid, sql)


def delete_lead(jid: str):
    sqlite_leads.delete_lead(jid, sql)


def update_lead_status(jid: str, status: str):
    sqlite_leads.update_lead_status(jid, status, sql)


def save_lead_feedback(jid: str, feedback_label: str, note: str = "") -> dict:
    now = _utc_timestamp() if feedback_label == "already_contacted" else ""
    due = _utc_timestamp(timedelta(days=5)) if feedback_label == "already_contacted" else ""
    lead = sqlite_leads.save_lead_feedback(jid, feedback_label, note, now, due, sql)
    recompute_learning_scores()
    return lead


def update_lead_followup(jid: str, days: int = 5) -> dict:
    days = max(1, min(int(days or 5), 60))
    return sqlite_leads.update_lead_followup(jid, _utc_timestamp(), _utc_timestamp(timedelta(days=days)), sql)


def get_due_followups(limit: int = 25) -> list:
    return sqlite_leads.get_due_followups(limit, _utc_timestamp(), sql)


def get_events(limit: int = 100, job_id: str | None = None) -> list:
    return sqlite_events.get_events(limit, job_id, sql)


def get_discovered_leads() -> list:
    return sqlite_leads.get_discovered_leads(sql)


def get_discovered_freelance_leads() -> list:
    return sqlite_leads.get_discovered_freelance_leads(sql)


def _load_profile_snapshot() -> dict:
    return graph_profile.load_profile_snapshot(sql)


def _save_profile_snapshot(profile: dict):
    graph_profile.save_profile_snapshot(profile, sql)


def _read_profile_from_graph() -> dict:
    return graph_profile.read_profile_from_graph()


def get_profile() -> dict:
    snapshot = _load_profile_snapshot()
    try:
        profile = graph_profile.normal_profile(_read_profile_from_graph())
    except Exception as exc:
        if snapshot:
            return snapshot
        _log.error("profile read failed: %s", exc)
        return graph_profile.empty_profile()

    if graph_profile.profile_has_data(profile):
        _save_profile_snapshot(profile)
        return profile
    return snapshot or profile


def refresh_profile_snapshot():
    graph_profile.refresh_profile_snapshot(sql)


def add_skill(n: str, cat: str) -> dict:
    return graph_profile.add_skill(n, cat, sql)


def update_skill(sid: str, n: str, cat: str) -> dict:
    return graph_profile.update_skill(sid, n, cat, sql)


def delete_skill(sid: str):
    graph_profile.delete_skill(sid, sql)


def add_experience(role: str, co: str, period: str, d: str) -> dict:
    return graph_profile.add_experience(role, co, period, d, sql)


def update_experience(eid: str, role: str, co: str, period: str, d: str) -> dict:
    return graph_profile.update_experience(eid, role, co, period, d, sql)


def delete_experience(eid: str):
    graph_profile.delete_experience(eid, sql)


def add_project(title: str, stack: str, repo: str, impact: str) -> dict:
    return graph_profile.add_project(title, stack, repo, impact, sql)


def update_project(pid: str, title: str, stack: str, repo: str, impact: str) -> dict:
    return graph_profile.update_project(pid, title, stack, repo, impact, sql)


def delete_project(pid: str):
    graph_profile.delete_project(pid, sql)


def add_education(title: str) -> dict:
    return graph_profile.add_education(title, sql)


def add_certification(title: str) -> dict:
    return graph_profile.add_certification(title, sql)


def add_achievement(title: str) -> dict:
    return graph_profile.add_achievement(title, sql)


def delete_education(entry: str):
    graph_profile.delete_education(entry, sql)


def delete_certification(entry: str):
    graph_profile.delete_certification(entry, sql)


def delete_achievement(entry: str):
    graph_profile.delete_achievement(entry, sql)


def update_candidate(name: str, summary: str) -> dict:
    return graph_profile.update_candidate(name, summary, sql)


def _delete_vec_rows(table_name: str, ids: list[str]):
    graph_profile.delete_vec_rows(table_name, ids)


def _add_skill_vec(sid: str, n: str, cat: str):
    graph_profile.add_skill_vec(sid, n, cat)


def _add_project_vec(pid: str, title: str, stack: str, impact: str):
    graph_profile.add_project_vec(pid, title, stack, impact)
