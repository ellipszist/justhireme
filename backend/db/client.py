import os
import sqlite3 as _sq
import json
import kuzu
import lancedb

_b = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "BoomBoom")
_g, _v = os.path.join(_b, "graph"), os.path.join(_b, "vector")
sql = os.path.join(_b, "crm.db")
os.makedirs(_b, exist_ok=True)
os.makedirs(_v, exist_ok=True)

db   = kuzu.Database(_g)
conn = kuzu.Connection(db)
vec: lancedb.LanceDBConnection = lancedb.connect(_v)

def _init():
    for s in [
        "CREATE NODE TABLE IF NOT EXISTS Candidate(id STRING, n STRING, s STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Skill(id STRING, n STRING, cat STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Project(id STRING, title STRING, stack STRING, repo STRING, impact STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Experience(id STRING, role STRING, co STRING, period STRING, d STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS JobLead(job_id STRING, title STRING, co STRING, url STRING, platform STRING, PRIMARY KEY(job_id))",
        "CREATE REL TABLE IF NOT EXISTS WORKED_AS(FROM Candidate TO Experience)",
        "CREATE REL TABLE IF NOT EXISTS BUILT(FROM Candidate TO Project)",
        "CREATE REL TABLE IF NOT EXISTS EXP_UTILIZES(FROM Experience TO Skill)",
        "CREATE REL TABLE IF NOT EXISTS PROJ_UTILIZES(FROM Project TO Skill)",
        "CREATE REL TABLE IF NOT EXISTS REQUIRES(FROM JobLead TO Skill)",
    ]:
        conn.execute(s)

_init()


def _init_sql():
    c = _sq.connect(sql)
    c.executescript("""
        CREATE TABLE IF NOT EXISTS leads(
            job_id TEXT PRIMARY KEY, title TEXT, company TEXT,
            url TEXT, platform TEXT, status TEXT DEFAULT 'discovered',
            score INTEGER DEFAULT 0,
            reason TEXT DEFAULT '',
            match_points TEXT DEFAULT '',
            asset_path TEXT DEFAULT '',
            cover_letter_path TEXT DEFAULT '',
            selected_projects TEXT DEFAULT '',
            description TEXT DEFAULT '',
            gaps TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT, action TEXT, ts TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings(
            key TEXT PRIMARY KEY, val TEXT
        );
    """)
    # Migration: add columns if upgrading from older schema
    for col, definition in [
        ("score",        "INTEGER DEFAULT 0"),
        ("reason",       "TEXT DEFAULT ''"),
        ("match_points", "TEXT DEFAULT ''"),
        ("asset_path",   "TEXT DEFAULT ''"),
        ("cover_letter_path", "TEXT DEFAULT ''"),
        ("selected_projects", "TEXT DEFAULT ''"),
        ("description",  "TEXT DEFAULT ''"),
        ("gaps",         "TEXT DEFAULT ''"),
    ]:
        try:
            c.execute(f"ALTER TABLE leads ADD COLUMN {col} {definition}")
        except Exception:
            pass  # column already exists
    c.commit()
    c.close()

_init_sql()


def url_exists(jid: str) -> bool:
    c = _sq.connect(sql)
    r = c.execute("SELECT 1 FROM leads WHERE job_id=?", (jid,)).fetchone()
    c.close()
    return r is not None


def save_lead(jid: str, t: str, co: str, u: str, plat: str, desc: str = ""):
    c = _sq.connect(sql)
    c.execute(
        "INSERT OR IGNORE INTO leads(job_id,title,company,url,platform,description) VALUES(?,?,?,?,?,?)",
        (jid, t, co, u, plat, desc),
    )
    c.commit()
    c.close()


def update_lead_score(jid: str, s: int, r: str, match_points: list | None = None, gaps: list | None = None):
    status = "tailoring" if s >= 76 else "discarded"
    mp  = ",".join(match_points) if match_points else ""
    gps = ",".join(gaps) if gaps else ""
    c = _sq.connect(sql)
    c.execute(
        "UPDATE leads SET status=?, score=?, reason=?, match_points=?, gaps=? WHERE job_id=?",
        (status, s, r[:500], mp, gps, jid),
    )
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"score={s} status={status}"),
    )
    c.commit()
    c.close()


def save_asset_path(jid: str, path: str):
    c = _sq.connect(sql)
    c.execute(
        "UPDATE leads SET status='approved', asset_path=? WHERE job_id=?",
        (path, jid),
    )
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"asset={path}"),
    )
    c.commit()
    c.close()


def save_asset_package(jid: str, resume_path: str, cover_letter_path: str = "", selected_projects: list | None = None):
    projects = json.dumps(selected_projects or [])
    c = _sq.connect(sql)
    c.execute(
        "UPDATE leads SET status='approved', asset_path=?, cover_letter_path=?, selected_projects=? WHERE job_id=?",
        (resume_path, cover_letter_path, projects, jid),
    )
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"assets=resume:{resume_path} cover:{cover_letter_path}"),
    )
    c.commit()
    c.close()


def mark_applied(jid: str):
    c = _sq.connect(sql)
    c.execute("UPDATE leads SET status='applied' WHERE job_id=?", (jid,))
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, "submitted application"),
    )
    c.commit()
    c.close()


def get_all_leads() -> list:
    c = _sq.connect(sql)
    rows = c.execute(
        "SELECT job_id,title,company,url,platform,status,score,reason,match_points,asset_path,description,gaps,cover_letter_path,selected_projects FROM leads ORDER BY created_at DESC"
    ).fetchall()
    c.close()
    return [
        {
            "job_id": r[0], "title": r[1], "company": r[2], "url": r[3],
            "platform": r[4], "status": r[5], "score": r[6] or 0,
            "reason": r[7] or "",
            "match_points": [m for m in (r[8] or "").split(",") if m],
            "asset": r[9] or "",
            "description": r[10] or "",
            "gaps": [g for g in (r[11] or "").split(",") if g],
            "resume_asset": r[9] or "",
            "cover_letter_asset": r[12] or "",
            "selected_projects": _json_list(r[13] or "[]"),
        }
        for r in rows
    ]


def _json_list(s: str) -> list:
    try:
        v = json.loads(s or "[]")
        return v if isinstance(v, list) else []
    except Exception:
        return []


def get_lead_for_fire(jid: str) -> tuple:
    c = _sq.connect(sql)
    row = c.execute(
        "SELECT job_id,title,company,url,platform,asset_path FROM leads WHERE job_id=?", (jid,)
    ).fetchone()
    c.close()
    if not row:
        return {}, ""
    lead = {"job_id": row[0], "title": row[1], "company": row[2], "url": row[3], "platform": row[4]}
    path = row[5] or ""
    return lead, path


def save_settings(d: dict):
    c = _sq.connect(sql)
    for k, v in d.items():
        c.execute("INSERT OR REPLACE INTO settings(key,val) VALUES(?,?)", (k, str(v)))
    c.commit()
    c.close()


def get_settings() -> dict:
    c = _sq.connect(sql)
    rows = c.execute("SELECT key,val FROM settings").fetchall()
    c.close()
    return {r[0]: r[1] for r in rows}


def get_setting(k: str, default: str = "") -> str:
    c = _sq.connect(sql)
    r = c.execute("SELECT val FROM settings WHERE key=?", (k,)).fetchone()
    c.close()
    return r[0] if r else default


def get_lead_by_id(jid: str) -> dict:
    c = _sq.connect(sql)
    row = c.execute(
        "SELECT job_id,title,company,url,platform,status,score,reason,match_points,asset_path,description,gaps,cover_letter_path,selected_projects FROM leads WHERE job_id=?",
        (jid,)
    ).fetchone()
    evs = c.execute(
        "SELECT action, ts FROM events WHERE job_id=? ORDER BY ts DESC LIMIT 20",
        (jid,)
    ).fetchall()
    c.close()
    if not row:
        return {}
    return {
        "job_id": row[0], "title": row[1], "company": row[2], "url": row[3],
        "platform": row[4], "status": row[5], "score": row[6] or 0,
        "reason": row[7] or "",
        "match_points": [m for m in (row[8] or "").split(",") if m],
        "asset": row[9] or "",
        "description": row[10] or "",
        "gaps": [g for g in (row[11] or "").split(",") if g],
        "resume_asset": row[9] or "",
        "cover_letter_asset": row[12] or "",
        "selected_projects": _json_list(row[13] or "[]"),
        "events": [{"action": e[0], "ts": e[1]} for e in evs],
    }


def delete_lead(jid: str):
    c = _sq.connect(sql)
    c.execute("DELETE FROM leads WHERE job_id=?", (jid,))
    c.execute("DELETE FROM events WHERE job_id=?", (jid,))
    c.commit()
    c.close()


def update_lead_status(jid: str, status: str):
    valid = {
        "discovered", "evaluating", "tailoring", "approved",
        "applied", "interviewing", "rejected", "accepted", "discarded",
    }
    if status not in valid:
        raise ValueError(f"Invalid status: {status}")
    c = _sq.connect(sql)
    c.execute("UPDATE leads SET status=? WHERE job_id=?", (status, jid))
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"status_changed={status}"),
    )
    c.commit()
    c.close()


def get_events(limit: int = 100, job_id: str | None = None) -> list:
    c = _sq.connect(sql)
    if job_id:
        rows = c.execute(
            "SELECT job_id,action,ts FROM events WHERE job_id=? ORDER BY ts DESC LIMIT ?",
            (job_id, limit),
        ).fetchall()
    else:
        rows = c.execute(
            "SELECT job_id,action,ts FROM events ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
    c.close()
    return [{"job_id": r[0], "action": r[1], "ts": r[2]} for r in rows]


def get_discovered_leads() -> list:
    c = _sq.connect(sql)
    rows = c.execute(
        "SELECT job_id,title,company,url,platform,description FROM leads WHERE status='discovered'"
    ).fetchall()
    c.close()
    return [{"job_id": r[0], "title": r[1], "company": r[2], "url": r[3], "platform": r[4], "description": r[5] or ""} for r in rows]


def _h(t: str) -> str:
    import hashlib
    return hashlib.md5(t.encode()).hexdigest()[:12]


def get_profile() -> dict:
    from kuzu import Connection
    c = Connection(db)

    # 1. Candidate
    r = c.execute("MATCH (n:Candidate) RETURN n.id, n.n, n.s")
    cand = r.get_next() if r.has_next() else ["", "", ""]

    # 2. Skills
    r = c.execute("MATCH (n:Skill) RETURN n.id, n.n, n.cat")
    skills = []
    while r.has_next():
        row = r.get_next()
        skills.append({"id": row[0], "n": row[1], "cat": row[2]})

    # 3. Projects
    r = c.execute("MATCH (n:Project) RETURN n.id, n.title, n.stack, n.repo, n.impact")
    projects = []
    while r.has_next():
        row = r.get_next()
        projects.append({"id": row[0], "title": row[1], "stack": row[2].split(",") if row[2] else [], "repo": row[3], "impact": row[4]})

    # 4. Experience
    r = c.execute("MATCH (n:Experience) RETURN n.id, n.role, n.co, n.period, n.d")
    exp = []
    while r.has_next():
        row = r.get_next()
        exp.append({"id": row[0], "role": row[1], "co": row[2], "period": row[3], "d": row[4]})

    return {
        "n": cand[1],
        "s": cand[2],
        "skills": skills,
        "projects": projects,
        "exp": exp
    }


# ── CRUD: Skills ──────────────────────────────────────────────────

def add_skill(n: str, cat: str) -> dict:
    from kuzu import Connection
    sid = _h(n)
    c = Connection(db)
    try:
        c.execute("CREATE (:Skill {id: $id, n: $n, cat: $cat})", {"id": sid, "n": n, "cat": cat})
    except Exception:
        c = Connection(db)
        c.execute("MATCH (s:Skill) WHERE s.id = $id SET s.n = $n, s.cat = $cat", {"id": sid, "n": n, "cat": cat})
    # Link to candidate if one exists
    c2 = Connection(db)
    try:
        c2.execute("MATCH (c:Candidate) RETURN c.id LIMIT 1")
    except Exception:
        pass
    # Add to vector store
    try:
        _add_skill_vec(sid, n, cat)
    except Exception:
        pass
    return {"id": sid, "n": n, "cat": cat}


def update_skill(sid: str, n: str, cat: str) -> dict:
    from kuzu import Connection
    c = Connection(db)
    c.execute("MATCH (s:Skill) WHERE s.id = $id SET s.n = $n, s.cat = $cat", {"id": sid, "n": n, "cat": cat})
    return {"id": sid, "n": n, "cat": cat}


def delete_skill(sid: str):
    from kuzu import Connection
    c = Connection(db)
    try:
        c.execute("MATCH (s:Skill {id: $id})-[r]-() DELETE r", {"id": sid})
    except Exception:
        pass
    c2 = Connection(db)
    try:
        c2.execute("MATCH (s:Skill {id: $id}) DELETE s", {"id": sid})
    except Exception:
        pass


# ── CRUD: Experience ──────────────────────────────────────────────

def add_experience(role: str, co: str, period: str, d: str) -> dict:
    from kuzu import Connection
    eid = _h(role + co)
    c = Connection(db)
    try:
        c.execute(
            "CREATE (:Experience {id: $id, role: $role, co: $co, period: $period, d: $d})",
            {"id": eid, "role": role, "co": co, "period": period, "d": d}
        )
    except Exception:
        c = Connection(db)
        c.execute(
            "MATCH (e:Experience) WHERE e.id = $id SET e.role = $role, e.co = $co, e.period = $period, e.d = $d",
            {"id": eid, "role": role, "co": co, "period": period, "d": d}
        )
    # Link to candidate
    c2 = Connection(db)
    try:
        r = c2.execute("MATCH (c:Candidate) RETURN c.id LIMIT 1")
        if r.has_next():
            cid = r.get_next()[0]
            c3 = Connection(db)
            c3.execute(
                "MATCH (a:Candidate {id: $s}), (b:Experience {id: $d}) MERGE (a)-[:WORKED_AS]->(b)",
                {"s": cid, "d": eid}
            )
    except Exception:
        pass
    return {"id": eid, "role": role, "co": co, "period": period, "d": d}


def update_experience(eid: str, role: str, co: str, period: str, d: str) -> dict:
    from kuzu import Connection
    c = Connection(db)
    c.execute(
        "MATCH (e:Experience) WHERE e.id = $id SET e.role = $role, e.co = $co, e.period = $period, e.d = $d",
        {"id": eid, "role": role, "co": co, "period": period, "d": d}
    )
    return {"id": eid, "role": role, "co": co, "period": period, "d": d}


def delete_experience(eid: str):
    from kuzu import Connection
    c = Connection(db)
    try:
        c.execute("MATCH (e:Experience {id: $id})-[r]-() DELETE r", {"id": eid})
    except Exception:
        pass
    c2 = Connection(db)
    try:
        c2.execute("MATCH (e:Experience {id: $id}) DELETE e", {"id": eid})
    except Exception:
        pass


# ── CRUD: Projects ────────────────────────────────────────────────

def add_project(title: str, stack: str, repo: str, impact: str) -> dict:
    from kuzu import Connection
    pid = _h(title)
    c = Connection(db)
    try:
        c.execute(
            "CREATE (:Project {id: $id, title: $title, stack: $stack, repo: $repo, impact: $impact})",
            {"id": pid, "title": title, "stack": stack, "repo": repo, "impact": impact}
        )
    except Exception:
        c = Connection(db)
        c.execute(
            "MATCH (p:Project) WHERE p.id = $id SET p.title = $title, p.stack = $stack, p.repo = $repo, p.impact = $impact",
            {"id": pid, "title": title, "stack": stack, "repo": repo, "impact": impact}
        )
    # Link to candidate
    c2 = Connection(db)
    try:
        r = c2.execute("MATCH (c:Candidate) RETURN c.id LIMIT 1")
        if r.has_next():
            cid = r.get_next()[0]
            c3 = Connection(db)
            c3.execute(
                "MATCH (a:Candidate {id: $s}), (b:Project {id: $d}) MERGE (a)-[:BUILT]->(b)",
                {"s": cid, "d": pid}
            )
    except Exception:
        pass
    # Add to vector store
    try:
        _add_project_vec(pid, title, stack, impact)
    except Exception:
        pass
    return {"id": pid, "title": title, "stack": stack.split(",") if stack else [], "repo": repo, "impact": impact}


def update_project(pid: str, title: str, stack: str, repo: str, impact: str) -> dict:
    from kuzu import Connection
    c = Connection(db)
    c.execute(
        "MATCH (p:Project) WHERE p.id = $id SET p.title = $title, p.stack = $stack, p.repo = $repo, p.impact = $impact",
        {"id": pid, "title": title, "stack": stack, "repo": repo, "impact": impact}
    )
    return {"id": pid, "title": title, "stack": stack.split(",") if stack else [], "repo": repo, "impact": impact}


def delete_project(pid: str):
    from kuzu import Connection
    c = Connection(db)
    try:
        c.execute("MATCH (p:Project {id: $id})-[r]-() DELETE r", {"id": pid})
    except Exception:
        pass
    c2 = Connection(db)
    try:
        c2.execute("MATCH (p:Project {id: $id}) DELETE p", {"id": pid})
    except Exception:
        pass


# ── CRUD: Candidate ──────────────────────────────────────────────

def update_candidate(name: str, summary: str) -> dict:
    from kuzu import Connection
    import hashlib
    c = Connection(db)
    r = c.execute("MATCH (n:Candidate) RETURN n.id LIMIT 1")
    if r.has_next():
        cid = r.get_next()[0]
        c2 = Connection(db)
        c2.execute(
            "MATCH (n:Candidate {id: $id}) SET n.n = $n, n.s = $s",
            {"id": cid, "n": name, "s": summary}
        )
    else:
        cid = hashlib.md5(name.encode()).hexdigest()[:12]
        c2 = Connection(db)
        try:
            c2.execute(
                "CREATE (:Candidate {id: $id, n: $n, s: $s})",
                {"id": cid, "n": name, "s": summary}
            )
        except Exception:
            pass
    return {"n": name, "s": summary}


# ── Vector helpers (reuse ingestor patterns) ──────────────────────

def _add_skill_vec(sid: str, n: str, cat: str):
    try:
        from agents.ingestor import _emb
        vecs = _emb([n])
        if vecs:
            rows = [{"id": sid, "n": n, "cat": cat, "vector": vecs[0]}]
            if "skills" in vec.list_tables():
                vec.open_table("skills").add(rows)
            else:
                vec.create_table("skills", data=rows)
    except Exception:
        pass


def _add_project_vec(pid: str, title: str, stack: str, impact: str):
    try:
        from agents.ingestor import _emb
        text = f"{title} {stack} {impact}"
        vecs = _emb([text])
        if vecs:
            rows = [{"id": pid, "title": title, "stack": stack, "impact": impact, "vector": vecs[0]}]
            if "projects" in vec.list_tables():
                vec.open_table("projects").add(rows)
            else:
                vec.create_table("projects", data=rows)
    except Exception:
        pass
