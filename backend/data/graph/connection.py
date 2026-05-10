from __future__ import annotations

import os
import threading

from core.logging import get_logger

_log = get_logger(__name__)

try:
    import kuzu
except Exception as exc:
    kuzu = None
    _KUZU_IMPORT_ERROR = str(exc)
else:
    _KUZU_IMPORT_ERROR = ""

BASE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "JustHireMe")
GRAPH_DIR = os.path.join(BASE_DIR, "graph")

_GRAPH_ERROR = ""
_GRAPH_DIR_READY = False
_graph_lock = threading.Lock()

try:
    os.makedirs(GRAPH_DIR, exist_ok=True)
    _GRAPH_DIR_READY = True
except Exception as exc:
    _GRAPH_ERROR = str(exc)
    _log.warning("graph store path unavailable: %s", exc)

try:
    if not _GRAPH_DIR_READY:
        raise RuntimeError(_GRAPH_ERROR or "Graph directory is not available")
    if kuzu is None:
        raise RuntimeError(_KUZU_IMPORT_ERROR or "Kuzu is not available")
    db = kuzu.Database(GRAPH_DIR)
    conn = kuzu.Connection(db)
except Exception as exc:
    db = None
    conn = None
    _GRAPH_ERROR = str(exc)
    _log.warning("graph store disabled: %s", exc)


def init_graph() -> None:
    if conn is None:
        return
    for statement in [
        "CREATE NODE TABLE IF NOT EXISTS Candidate(id STRING, n STRING, s STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Skill(id STRING, n STRING, cat STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Project(id STRING, title STRING, stack STRING, repo STRING, impact STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Experience(id STRING, role STRING, co STRING, period STRING, d STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Certification(id STRING, title STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Education(id STRING, title STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Achievement(id STRING, title STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS JobLead(job_id STRING, title STRING, co STRING, url STRING, platform STRING, PRIMARY KEY(job_id))",
        "CREATE REL TABLE IF NOT EXISTS WORKED_AS(FROM Candidate TO Experience)",
        "CREATE REL TABLE IF NOT EXISTS BUILT(FROM Candidate TO Project)",
        "CREATE REL TABLE IF NOT EXISTS HAS_CERTIFICATION(FROM Candidate TO Certification)",
        "CREATE REL TABLE IF NOT EXISTS HAS_EDUCATION(FROM Candidate TO Education)",
        "CREATE REL TABLE IF NOT EXISTS HAS_ACHIEVEMENT(FROM Candidate TO Achievement)",
        "CREATE REL TABLE IF NOT EXISTS EXP_UTILIZES(FROM Experience TO Skill)",
        "CREATE REL TABLE IF NOT EXISTS PROJ_UTILIZES(FROM Project TO Skill)",
        "CREATE REL TABLE IF NOT EXISTS REQUIRES(FROM JobLead TO Skill)",
    ]:
        execute_query(statement)


def execute_query(query: str, params: dict | None = None):
    if conn is None:
        return None
    with _graph_lock:
        if params:
            return conn.execute(query, params)
        return conn.execute(query)


init_graph()


def graph_available() -> bool:
    return db is not None and conn is not None


def graph_error() -> str:
    return _GRAPH_ERROR


def graph_counts() -> dict:
    out = {key: 0 for key in ["candidate", "skill", "project", "experience", "joblead"]}
    if conn is None:
        return out
    for table in ["Candidate", "Skill", "Project", "Experience", "JobLead"]:
        try:
            result = execute_query(f"MATCH (n:{table}) RETURN count(n)")
            out[table.lower()] = result.get_next()[0] if result.has_next() else 0
        except Exception as exc:
            _log.warning("graph count failed for %s: %s", table, exc)
    return out
