from __future__ import annotations

import hashlib
import json

from core.logging import get_logger
from data.graph.connection import execute_query
from data.sqlite.settings import get_setting, save_settings
from data.vector.connection import vec

_log = get_logger(__name__)

PROFILE_SNAPSHOT_KEY = "profile_snapshot_json"


def hash_id(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:12]


def stack_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def profile_has_data(profile: dict | None) -> bool:
    if not isinstance(profile, dict):
        return False
    return bool(
        str(profile.get("n") or "").strip()
        or str(profile.get("s") or "").strip()
        or profile.get("skills")
        or profile.get("projects")
        or profile.get("exp")
        or profile.get("certifications")
        or profile.get("education")
        or profile.get("achievements")
    )


def empty_profile() -> dict:
    return {
        "n": "",
        "s": "",
        "skills": [],
        "projects": [],
        "exp": [],
        "certifications": [],
        "education": [],
        "achievements": [],
    }


def normal_profile(profile: dict | None) -> dict:
    profile = profile if isinstance(profile, dict) else {}
    return {
        "n": str(profile.get("n") or ""),
        "s": str(profile.get("s") or ""),
        "skills": list(profile.get("skills") or []),
        "projects": list(profile.get("projects") or []),
        "exp": list(profile.get("exp") or []),
        "certifications": list(profile.get("certifications") or profile.get("certs") or []),
        "education": list(profile.get("education") or []),
        "achievements": list(profile.get("achievements") or profile.get("awards") or []),
    }


def load_profile_snapshot(db_path: str | None = None) -> dict:
    try:
        raw = get_setting(PROFILE_SNAPSHOT_KEY, "", db_path) if db_path else get_setting(PROFILE_SNAPSHOT_KEY)
        if not raw:
            return {}
        profile = normal_profile(json.loads(raw or "{}"))
        return profile if profile_has_data(profile) else {}
    except Exception:
        return {}


def save_profile_snapshot(profile: dict, db_path: str | None = None) -> None:
    profile = normal_profile(profile)
    if not profile_has_data(profile):
        return
    try:
        payload = {PROFILE_SNAPSHOT_KEY: json.dumps(profile, ensure_ascii=False)}
        if db_path:
            save_settings(payload, db_path)
        else:
            save_settings(payload)
    except Exception:
        pass


def read_profile_from_graph() -> dict:
    result = execute_query("MATCH (n:Candidate) RETURN n.id, n.n, n.s")
    if result is None:
        return empty_profile()
    candidates = []
    while result.has_next():
        candidates.append(result.get_next())
    if candidates:
        candidates.sort(
            key=lambda row: (
                0 if str(row[1] or "").strip().lower() in {"", "unknown", "candidate"} else 1,
                len(str(row[1] or "")) + len(str(row[2] or "")),
            ),
            reverse=True,
        )
        candidate = candidates[0]
    else:
        candidate = ["", "", ""]

    result = execute_query("MATCH (n:Skill) RETURN n.id, n.n, n.cat")
    skills = []
    while result.has_next():
        row = result.get_next()
        skills.append({"id": row[0], "n": row[1], "cat": row[2]})

    result = execute_query("MATCH (n:Project) RETURN n.id, n.title, n.stack, n.repo, n.impact")
    projects = []
    while result.has_next():
        row = result.get_next()
        projects.append({"id": row[0], "title": row[1], "stack": stack_list(row[2]), "repo": row[3], "impact": row[4]})

    result = execute_query("MATCH (n:Experience) RETURN n.id, n.role, n.co, n.period, n.d")
    experience = []
    while result.has_next():
        row = result.get_next()
        experience.append({"id": row[0], "role": row[1], "co": row[2], "period": row[3], "d": row[4]})

    def read_text_nodes(label: str) -> list[str]:
        try:
            rows = execute_query(f"MATCH (n:{label}) RETURN n.title")
        except Exception:
            return []
        items: list[str] = []
        while rows.has_next():
            row = rows.get_next()
            text = str(row[0] or "").strip()
            if text:
                items.append(text)
        return items

    return {
        "n": candidate[1],
        "s": candidate[2],
        "skills": skills,
        "projects": projects,
        "exp": experience,
        "certifications": read_text_nodes("Certification"),
        "education": read_text_nodes("Education"),
        "achievements": read_text_nodes("Achievement"),
    }


def get_profile(db_path: str | None = None) -> dict:
    snapshot = load_profile_snapshot(db_path)
    try:
        profile = normal_profile(read_profile_from_graph())
    except Exception as exc:
        if snapshot:
            return snapshot
        _log.error("profile read failed: %s", exc)
        return empty_profile()

    if profile_has_data(profile):
        save_profile_snapshot(profile, db_path)
        return profile
    return snapshot or profile


def refresh_profile_snapshot(db_path: str | None = None) -> None:
    try:
        save_profile_snapshot(read_profile_from_graph(), db_path)
    except Exception:
        pass


def _candidate_id() -> str | None:
    try:
        result = execute_query("MATCH (c:Candidate) RETURN c.id LIMIT 1")
        return result.get_next()[0] if result.has_next() else None
    except Exception:
        return None


def _link_to_candidate(label: str, node_id: str, rel: str) -> None:
    candidate_id = _candidate_id()
    if not candidate_id:
        return
    try:
        execute_query(
            f"MATCH (a:Candidate {{id: $s}}), (b:{label} {{id: $d}}) MERGE (a)-[:{rel}]->(b)",
            {"s": candidate_id, "d": node_id},
        )
    except Exception:
        pass


def delete_vec_rows(table_name: str, ids: list[str]) -> None:
    ids = [str(item or "").strip() for item in ids if str(item or "").strip()]
    if not ids:
        return
    try:
        if table_name not in vec.list_tables():
            return
        quoted = ["'" + item.replace("'", "''") + "'" for item in ids]
        vec.open_table(table_name).delete("id IN (" + ", ".join(quoted) + ")")
    except Exception:
        pass


def add_skill_vec(skill_id: str, name: str, category: str) -> None:
    try:
        from data.vector.embeddings import embed_texts

        vectors = embed_texts([name])
        if not vectors:
            return
        rows = [{"id": skill_id, "n": name, "cat": category, "vector": vectors[0]}]
        if "skills" in vec.list_tables():
            delete_vec_rows("skills", [skill_id])
            vec.open_table("skills").add(rows)
        else:
            vec.create_table("skills", data=rows)
    except Exception:
        pass


def add_project_vec(project_id: str, title: str, stack: str, impact: str) -> None:
    try:
        from data.vector.embeddings import embed_texts

        text = f"{title} {stack} {impact}"
        vectors = embed_texts([text])
        if not vectors:
            return
        rows = [{"id": project_id, "title": title, "stack": stack, "impact": impact, "vector": vectors[0]}]
        if "projects" in vec.list_tables():
            delete_vec_rows("projects", [project_id])
            vec.open_table("projects").add(rows)
        else:
            vec.create_table("projects", data=rows)
    except Exception:
        pass


def add_skill(name: str, category: str, db_path: str | None = None) -> dict:
    name = str(name or "").strip()
    category = str(category or "general").strip() or "general"
    skill_id = hash_id(name)
    try:
        execute_query("CREATE (:Skill {id: $id, n: $n, cat: $cat})", {"id": skill_id, "n": name, "cat": category})
    except Exception:
        execute_query(
            "MATCH (s:Skill) WHERE s.id = $id SET s.n = $n, s.cat = $cat",
            {"id": skill_id, "n": name, "cat": category},
        )
    try:
        add_skill_vec(skill_id, name, category)
    except Exception:
        pass
    refresh_profile_snapshot(db_path)
    return {"id": skill_id, "n": name, "cat": category}


def update_skill(skill_id: str, name: str, category: str, db_path: str | None = None) -> dict:
    name = str(name or "").strip()
    category = str(category or "general").strip() or "general"
    execute_query(
        "MATCH (s:Skill) WHERE s.id = $id SET s.n = $n, s.cat = $cat",
        {"id": skill_id, "n": name, "cat": category},
    )
    try:
        add_skill_vec(skill_id, name, category)
    except Exception:
        pass
    refresh_profile_snapshot(db_path)
    return {"id": skill_id, "n": name, "cat": category}


def delete_skill(skill_id: str, db_path: str | None = None) -> None:
    delete_vec_rows("skills", [skill_id])
    execute_query("MATCH (s:Skill) WHERE s.id = $id DETACH DELETE s", {"id": skill_id})
    refresh_profile_snapshot(db_path)


def add_experience(role: str, company: str, period: str, description: str, db_path: str | None = None) -> dict:
    role = str(role or "").strip()
    company = str(company or "").strip()
    period = str(period or "").strip()
    description = str(description or "").strip()
    experience_id = hash_id(role + company)
    try:
        execute_query(
            "CREATE (:Experience {id: $id, role: $role, co: $co, period: $period, d: $d})",
            {"id": experience_id, "role": role, "co": company, "period": period, "d": description},
        )
    except Exception:
        execute_query(
            "MATCH (e:Experience) WHERE e.id = $id SET e.role = $role, e.co = $co, e.period = $period, e.d = $d",
            {"id": experience_id, "role": role, "co": company, "period": period, "d": description},
        )
    _link_to_candidate("Experience", experience_id, "WORKED_AS")
    refresh_profile_snapshot(db_path)
    return {"id": experience_id, "role": role, "co": company, "period": period, "d": description}


def update_experience(experience_id: str, role: str, company: str, period: str, description: str, db_path: str | None = None) -> dict:
    role = str(role or "").strip()
    company = str(company or "").strip()
    period = str(period or "").strip()
    description = str(description or "").strip()
    execute_query(
        "MATCH (e:Experience) WHERE e.id = $id SET e.role = $role, e.co = $co, e.period = $period, e.d = $d",
        {"id": experience_id, "role": role, "co": company, "period": period, "d": description},
    )
    refresh_profile_snapshot(db_path)
    return {"id": experience_id, "role": role, "co": company, "period": period, "d": description}


def delete_experience(experience_id: str, db_path: str | None = None) -> None:
    refresh_profile_snapshot(db_path)
    execute_query("MATCH (e:Experience) WHERE e.id = $id DETACH DELETE e", {"id": experience_id})
    refresh_profile_snapshot(db_path)


def add_project(title: str, stack: str, repo: str, impact: str, db_path: str | None = None) -> dict:
    title = str(title or "").strip()
    stack = str(stack or "").strip()
    repo = str(repo or "").strip()
    impact = str(impact or "").strip()
    project_id = hash_id(title)
    try:
        execute_query(
            "CREATE (:Project {id: $id, title: $title, stack: $stack, repo: $repo, impact: $impact})",
            {"id": project_id, "title": title, "stack": stack, "repo": repo, "impact": impact},
        )
    except Exception:
        execute_query(
            "MATCH (p:Project) WHERE p.id = $id SET p.title = $title, p.stack = $stack, p.repo = $repo, p.impact = $impact",
            {"id": project_id, "title": title, "stack": stack, "repo": repo, "impact": impact},
        )
    _link_to_candidate("Project", project_id, "BUILT")
    try:
        add_project_vec(project_id, title, stack, impact)
    except Exception:
        pass
    refresh_profile_snapshot(db_path)
    return {"id": project_id, "title": title, "stack": stack.split(",") if stack else [], "repo": repo, "impact": impact}


def update_project(project_id: str, title: str, stack: str, repo: str, impact: str, db_path: str | None = None) -> dict:
    title = str(title or "").strip()
    stack = str(stack or "").strip()
    repo = str(repo or "").strip()
    impact = str(impact or "").strip()
    execute_query(
        "MATCH (p:Project) WHERE p.id = $id SET p.title = $title, p.stack = $stack, p.repo = $repo, p.impact = $impact",
        {"id": project_id, "title": title, "stack": stack, "repo": repo, "impact": impact},
    )
    try:
        add_project_vec(project_id, title, stack, impact)
    except Exception:
        pass
    refresh_profile_snapshot(db_path)
    return {"id": project_id, "title": title, "stack": stack.split(",") if stack else [], "repo": repo, "impact": impact}


def delete_project(project_id: str, db_path: str | None = None) -> None:
    delete_vec_rows("projects", [project_id])
    execute_query("MATCH (p:Project) WHERE p.id = $id DETACH DELETE p", {"id": project_id})
    refresh_profile_snapshot(db_path)


def _add_text_node(label: str, rel: str, title: str, db_path: str | None = None) -> dict:
    title = str(title or "").strip()
    node_id = hash_id(title)
    try:
        execute_query(f"CREATE (:{label} {{id: $id, title: $title}})", {"id": node_id, "title": title})
    except Exception:
        pass
    _link_to_candidate(label, node_id, rel)
    refresh_profile_snapshot(db_path)
    return {"id": node_id, "title": title}


def add_education(title: str, db_path: str | None = None) -> dict:
    return _add_text_node("Education", "HAS_EDUCATION", title, db_path)


def add_certification(title: str, db_path: str | None = None) -> dict:
    return _add_text_node("Certification", "HAS_CERTIFICATION", title, db_path)


def add_achievement(title: str, db_path: str | None = None) -> dict:
    return _add_text_node("Achievement", "HAS_ACHIEVEMENT", title, db_path)


def update_candidate(name: str, summary: str, db_path: str | None = None) -> dict:
    name = str(name or "").strip()
    summary = str(summary or "").strip()
    refresh_profile_snapshot(db_path)
    result = execute_query("MATCH (n:Candidate) RETURN n.id LIMIT 1")
    if result.has_next():
        candidate_id = result.get_next()[0]
        execute_query(
            "MATCH (n:Candidate {id: $id}) SET n.n = $n, n.s = $s",
            {"id": candidate_id, "n": name, "s": summary},
        )
    else:
        candidate_id = hash_id(name)
        try:
            execute_query(
                "CREATE (:Candidate {id: $id, n: $n, s: $s})",
                {"id": candidate_id, "n": name, "s": summary},
            )
        except Exception:
            pass
    refresh_profile_snapshot(db_path)
    return {"n": name, "s": summary}
