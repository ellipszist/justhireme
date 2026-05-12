from __future__ import annotations

from data.repository import create_repository


def save_lead_compat(
    jid: str,
    title: str,
    company: str,
    url: str,
    platform: str,
    description: str = "",
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
) -> None:
    lead = {
        "job_id": jid,
        "title": title,
        "company": company,
        "url": url,
        "platform": platform,
        "description": description,
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
    if base_signal_score is not None:
        lead["base_signal_score"] = int(base_signal_score)
    if learning_delta is not None:
        lead["learning_delta"] = int(learning_delta)
    if learning_reason:
        lead["learning_reason"] = learning_reason

    create_repository().leads.save_lead(lead)
