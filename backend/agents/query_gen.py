"""
query_gen.py — Generates profile-tailored job search queries.

Called at the start of every scan.  For each job-board domain the user has
configured, it produces ONE focused Google site: query that targets the
candidate's actual tech stack rather than generic keywords.
"""

import re
from pydantic import BaseModel
from typing import List
from logger import get_logger

_log = get_logger(__name__)


class _Plan(BaseModel):
    queries: List[str]


def _extract_domains(urls: list[str]) -> tuple[list[str], list[str]]:
    """
    Split the configured URL list into:
      - site_domains : bare domain strings extracted from 'site:...' entries
      - passthrough  : all other URLs (RSS, API, direct) that stay unchanged
    """
    site_domains: list[str] = []
    passthrough:  list[str] = []

    for url in urls:
        if url.strip().lower().startswith("site:"):
            # site:boards.greenhouse.io "AI" OR ...  →  boards.greenhouse.io
            raw = url.strip()[5:]          # strip 'site:'
            domain = raw.split()[0].strip().strip('"')
            if domain:
                site_domains.append(domain)
        else:
            passthrough.append(url)

    return site_domains, passthrough


def _detect_experience_level(profile: dict) -> str:
    """
    Infer the candidate's seniority level from their profile.
    Returns one of: "fresher", "junior", "mid", "senior"
    """
    try:
        from agents.scoring_engine import infer_experience_level

        return infer_experience_level(profile)
    except Exception:
        return "junior" if profile.get("projects") else "fresher"


def _seniority_hint(level: str) -> str:
    hints = {
        "fresher": '"intern" OR "new grad" OR "entry level" OR "junior"',
        "junior": '"junior" OR "entry level" OR "software engineer" OR "developer"',
        "mid": '"software engineer" OR "backend engineer" OR "frontend engineer" OR "full stack"',
        "senior": '"senior" OR "staff" OR "lead" OR "software engineer"',
    }
    return hints.get(level, '"software engineer" OR "developer"')


def _market_focus(value) -> str:
    focus = str(value or "global").strip().lower()
    return "india" if focus in {"india", "in", "indian", "indian_startups"} else "global"


def _india_clause(query: str) -> str:
    lower = query.lower()
    if any(term in lower for term in ("india", "indian", "bangalore", "bengaluru", "mumbai", "delhi", "pune", "hyderabad")):
        return query
    return f'{query} (India OR Indian OR Bengaluru OR Bangalore OR Mumbai OR Pune OR Hyderabad OR Delhi OR "Indian startup")'


def generate(profile: dict, urls: list[str], market_focus: str = "global") -> list[str]:
    """
    Main entry point.  Returns a new URL list where every 'site:' entry has
    been replaced with a profile-tailored query, while RSS/API/direct URLs
    are kept as-is.
    """
    from llm import call_llm

    focus = _market_focus(market_focus)
    site_domains, passthrough = _extract_domains(urls)

    if not site_domains:
        return urls  # nothing to enrich

    # ── Build a compact profile summary for the prompt ──────────────────────
    target_role      = (profile.get("s") or "Software Engineer").strip()
    skills           = [s["n"] for s in profile.get("skills", []) if s.get("n")]
    experience_level = _detect_experience_level(profile)

    seniority_hint = _seniority_hint(experience_level)

    # Collect unique stack tokens from projects
    stack_tokens: list[str] = []
    for proj in profile.get("projects", []):
        raw = proj.get("stack", [])
        items = raw if isinstance(raw, list) else [x.strip() for x in str(raw).split(",") if x.strip()]
        stack_tokens.extend(items[:4])
    stack_tokens = list(dict.fromkeys(stack_tokens))[:20]  # dedupe, cap at 20

    # Most recent role titles
    recent_roles = [e.get("role", "") for e in profile.get("exp", []) if e.get("role")][:3]

    # ── Prompt ──────────────────────────────────────────────────────────────
    system = """You are a senior technical recruiter and Boolean search expert.
Your job is to write highly targeted Google site: search queries that will surface
the most relevant job postings for a specific candidate.

Rules:
- Output exactly ONE query per domain — no more.
- Each query must start with   site:<domain>
- Use 2–4 specific technical terms the candidate actually knows.
- Prefer role-specific terms over generic ones ("LangChain Engineer" beats "Software Engineer").
- Use the detected candidate seniority as a preference, not a hard global filter.
- Do not exclude other levels unless the profile is clearly unsuitable for that level.
- Use OR between alternatives: site:jobs.lever.co "FastAPI" ("junior" OR "entry level")
- Never add quotation marks around the whole query, only around individual terms.
- Return only the list of queries — no extra commentary."""

    if focus == "india":
        system += """
- This scan is INDIA ONLY. Add India/Indian startup location intent to every query.
- Prefer India-friendly terms such as India, Indian, Bengaluru, Bangalore, Mumbai, Pune, Hyderabad, Delhi, and "Indian startup".
- Do not produce broad global remote queries for this mode."""

    user = f"""CANDIDATE PROFILE
Target role / summary : {target_role}
Detected seniority    : {experience_level.upper()} - preferred seniority query terms: {seniority_hint}
Market focus          : {"INDIA ONLY - Indian startups and India-based roles" if focus == "india" else "Global"}
Top skills            : {', '.join(skills[:15])}
Project tech stack    : {', '.join(stack_tokens)}
Recent role titles    : {', '.join(recent_roles) if recent_roles else 'none (fresher/student)'}

JOB BOARD DOMAINS (one query each):
{chr(10).join(f'- {d}' for d in site_domains)}

Generate the queries now."""

    try:
        result = call_llm(system, user, _Plan, step="query_gen")
        smart = [q.strip() for q in result.queries if q.strip()]
    except Exception as exc:
        _log.warning("LLM failed (%s), falling back to default queries", exc)
        # Fallback: build simple queries from top skills
        top = " OR ".join(f'"{s}"' for s in skills[:3]) if skills else f'"{target_role}"'
        smart = [f"site:{d} ({top}) ({seniority_hint})" for d in site_domains]

    if focus == "india":
        smart = [_india_clause(q) for q in smart]

    _log.info("Generated %s queries for %s domains", len(smart), len(site_domains))
    for q in smart:
        _log.debug("  → %s", q)

    return passthrough + smart
