import os
import sqlite3 as _sq
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
    c.close()

_init_sql()


def url_exists(jid: str) -> bool:
    c = _sq.connect(sql)
    r = c.execute("SELECT 1 FROM leads WHERE job_id=?", (jid,)).fetchone()
    c.close()
    return r is not None


def save_lead(jid: str, t: str, co: str, u: str, plat: str):
    c = _sq.connect(sql)
    c.execute(
        "INSERT OR IGNORE INTO leads(job_id,title,company,url,platform) VALUES(?,?,?,?,?)",
        (jid, t, co, u, plat),
    )
    c.commit()
    c.close()


def update_lead_score(jid: str, s: int, r: str):
    status = "tailoring" if s >= 85 else "discarded"
    c = _sq.connect(sql)
    c.execute(
        "UPDATE leads SET status=? WHERE job_id=?",
        (status, jid),
    )
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"score={s} status={status} reason={r[:200]}"),
    )
    c.commit()
    c.close()


def save_asset_path(jid: str, path: str):
    c = _sq.connect(sql)
    c.execute("UPDATE leads SET status='approved' WHERE job_id=?", (jid,))
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"asset={path}"),
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
        "SELECT job_id,title,company,url,platform,status FROM leads ORDER BY created_at DESC"
    ).fetchall()
    arows = c.execute(
        "SELECT job_id,action FROM events WHERE action LIKE 'asset=%'"
    ).fetchall()
    c.close()
    assets = {r[0]: r[1].split("asset=", 1)[1] for r in arows}
    return [
        {"job_id": r[0], "title": r[1], "company": r[2], "url": r[3],
         "platform": r[4], "status": r[5], "asset": assets.get(r[0], "")}
        for r in rows
    ]


def get_lead_for_fire(jid: str) -> tuple:
    c = _sq.connect(sql)
    row = c.execute(
        "SELECT job_id,title,company,url,platform FROM leads WHERE job_id=?", (jid,)
    ).fetchone()
    ar = c.execute(
        "SELECT action FROM events WHERE job_id=? AND action LIKE 'asset=%' ORDER BY ts DESC LIMIT 1",
        (jid,),
    ).fetchone()
    c.close()
    lead = {"job_id": row[0], "title": row[1], "company": row[2], "url": row[3], "platform": row[4]} if row else {}
    path = ar[0].split("asset=", 1)[1] if ar else ""
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


def get_discovered_leads() -> list:
    c = _sq.connect(sql)
    rows = c.execute(
        "SELECT job_id,title,company,url,platform FROM leads WHERE status='discovered'"
    ).fetchall()
    c.close()
    return [{"job_id": r[0], "title": r[1], "company": r[2], "url": r[3], "platform": r[4]} for r in rows]
