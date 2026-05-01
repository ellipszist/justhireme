"""Semantic similarity between a JD and the candidate's embedded profile.

The profile already stores per-skill and per-project embeddings in LanceDB
(see ``agents.ingestor._vectors``). This module embeds the incoming JD with the
same SentenceTransformer (``all-MiniLM-L6-v2``) and runs cosine search over
those tables. Searches are scoped to the candidate profile passed into the
evaluator, so stale vector rows cannot win just because they are close to the JD.
The result is exposed as a 0-100 ``Semantic fit`` signal that the deterministic
scoring engine blends with its keyword-based criteria.

Everything here is wrapped to fail soft - if the embedding model isn't
available, or LanceDB is the in-memory ``_NullVectorStore`` (used in tests),
``semantic_fit`` returns ``None`` and callers fall back to keyword scoring.
"""
from __future__ import annotations

import hashlib
from typing import Optional


def _h(value: str) -> str:
    return hashlib.md5(value.encode()).hexdigest()[:12]


def _embed_jd(text: str) -> Optional[list[float]]:
    """Embed a JD string into a 384-dim vector. Returns None on any failure."""
    if not (text or "").strip():
        return None
    try:
        from agents.ingestor import _emb  # lazy: keeps tests from loading the model
    except Exception:
        return None
    try:
        vecs = _emb([text])
    except Exception:
        return None
    if not vecs:
        return None
    try:
        first = vecs[0]
    except (IndexError, TypeError):
        return None
    if first is None:
        return None
    try:
        return [float(x) for x in first]
    except Exception:
        return None


def _vec_store():
    try:
        from db.client import vec
        return vec
    except Exception:
        return None


def _available_tables(store) -> set[str]:
    if store is None:
        return set()
    try:
        return set(store.list_tables() or [])
    except Exception:
        return set()


def _profile_scope(candidate_data: dict | None) -> dict[str, set[str]] | None:
    """Return LanceDB row ids belonging to the current profile.

    Passing ``None`` means "unscoped legacy search". Passing a profile with no
    usable ids means "do not use semantic search"; this prevents stale vectors
    from a previous profile from influencing an otherwise empty/current profile.
    """
    if candidate_data is None:
        return None

    skill_ids: set[str] = set()
    for skill in candidate_data.get("skills", []) or []:
        sid = str(skill.get("id") or "").strip()
        name = str(skill.get("n") or "").strip()
        if sid:
            skill_ids.add(sid)
        elif name:
            skill_ids.add(_h(name))

    project_ids: set[str] = set()
    for project in candidate_data.get("projects", []) or []:
        pid = str(project.get("id") or "").strip()
        title = str(project.get("title") or "").strip()
        if pid:
            project_ids.add(pid)
        elif title:
            project_ids.add(_h(title))

    return {"skills": skill_ids, "projects": project_ids}


def _ids_where_clause(ids: set[str]) -> str:
    quoted = ["'" + str(item).replace("'", "''") + "'" for item in sorted(ids)]
    return "id IN (" + ", ".join(quoted) + ")"


def _filter_rows(rows: list[dict], allowed_ids: set[str] | None, limit: int) -> list[dict]:
    if allowed_ids is None:
        return rows[:limit]
    if not allowed_ids:
        return []
    return [row for row in rows if str(row.get("id") or "") in allowed_ids][:limit]


def _table_search(
    table_name: str,
    query: list[float],
    limit: int,
    *,
    allowed_ids: set[str] | None = None,
    store=None,
    available_tables: set[str] | None = None,
) -> list[dict]:
    if allowed_ids is not None and not allowed_ids:
        return []
    store = store if store is not None else _vec_store()
    if store is None:
        return []
    tables = available_tables if available_tables is not None else _available_tables(store)
    if table_name not in tables:
        return []
    try:
        table = store.open_table(table_name)
    except Exception:
        return []
    try:
        # LanceDB returns rows ordered by similarity. Prefer cosine when supported.
        try:
            search = table.search(query).metric("cosine")
        except Exception:
            search = table.search(query)
        server_filtered = False
        if allowed_ids:
            try:
                search = search.where(_ids_where_clause(allowed_ids), prefilter=True)
                server_filtered = True
            except Exception:
                server_filtered = False
        if server_filtered or allowed_ids is None:
            request_limit = limit
        else:
            request_limit = max(limit, min(200, len(allowed_ids) + limit * 8))
        results = search.limit(request_limit).to_list()
    except Exception:
        return []
    return _filter_rows(list(results or []), allowed_ids, limit)


def _row_label(row: dict, fallback: str) -> str:
    for key in ("title", "n", "id"):
        v = row.get(key)
        if v:
            return str(v)
    return fallback


def _row_similarity(row: dict) -> float:
    """Convert LanceDB output (cosine distance or score) to similarity in [0,1]."""
    distance = row.get("_distance")
    if distance is None:
        sim = row.get("_score")
        try:
            return max(0.0, min(1.0, float(sim))) if sim is not None else 0.0
        except (TypeError, ValueError):
            return 0.0
    try:
        d = float(distance)
    except (TypeError, ValueError):
        return 0.0
    # Cosine distance is in [0,2]; similarity = 1 - d, clamped.
    sim = 1.0 - d
    if sim < 0:
        sim = 0.0
    if sim > 1:
        sim = 1.0
    return sim


def semantic_fit(
    jd_text: str,
    *,
    candidate_data: dict | None = None,
    top_skills: int = 6,
    top_projects: int = 3,
) -> Optional[dict]:
    """Compute a 0-100 semantic-fit score for a JD against the stored profile.

    Returns ``None`` when embeddings or vector storage are unavailable so the
    caller can transparently fall back to keyword scoring.
    """
    store = _vec_store()
    tables = _available_tables(store)
    if "skills" not in tables and "projects" not in tables:
        return None

    scope = _profile_scope(candidate_data)
    if scope is not None and not scope["skills"] and not scope["projects"]:
        return None

    query = _embed_jd(jd_text)
    if query is None:
        return None

    skill_rows = _table_search(
        "skills",
        query,
        top_skills,
        allowed_ids=None if scope is None else scope["skills"],
        store=store,
        available_tables=tables,
    )
    project_rows = _table_search(
        "projects",
        query,
        top_projects,
        allowed_ids=None if scope is None else scope["projects"],
        store=store,
        available_tables=tables,
    )
    if not skill_rows and not project_rows:
        return None

    skill_matches = [(_row_label(r, "skill"), _row_similarity(r)) for r in skill_rows]
    project_matches = [(_row_label(r, "project"), _row_similarity(r)) for r in project_rows]

    skill_sims = [s for _, s in skill_matches]
    project_sims = [s for _, s in project_matches]

    def _avg(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    skill_avg = _avg(skill_sims)
    project_avg = _avg(project_sims)
    skill_max = max(skill_sims) if skill_sims else 0.0
    project_max = max(project_sims) if project_sims else 0.0

    # Projects encode much richer context than a single skill name, so weight
    # them more heavily when both signals exist.
    if skill_sims and project_sims:
        avg_signal = 0.40 * skill_avg + 0.60 * project_avg
        peak_signal = 0.40 * skill_max + 0.60 * project_max
    elif project_sims:
        avg_signal, peak_signal = project_avg, project_max
    else:
        avg_signal, peak_signal = skill_avg, skill_max

    # Blend mean (coverage) and max (best-match peak) so a single very strong
    # project lifts the score, but breadth still matters.
    combined = 0.60 * avg_signal + 0.40 * peak_signal

    # Sentence-transformers cosine sims for short tech text typically live in
    # roughly [0.15, 0.70]. Stretch that band into a usable 0-100 spread so the
    # criterion isn't permanently compressed in the 20-70 range.
    stretched = (combined - 0.15) / 0.55
    score = max(0, min(100, int(round(stretched * 100))))

    return {
        "score": score,
        "skill_matches": skill_matches[:top_skills],
        "project_matches": project_matches[:top_projects],
        "raw": {
            "skill_avg": round(skill_avg, 3),
            "project_avg": round(project_avg, 3),
            "skill_max": round(skill_max, 3),
            "project_max": round(project_max, 3),
            "combined": round(combined, 3),
        },
    }
