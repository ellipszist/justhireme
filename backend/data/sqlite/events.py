from __future__ import annotations

from data.sqlite.connection import DEFAULT_DB_PATH, connect


def record_event(job_id: str | None, action: str, db_path: str = DEFAULT_DB_PATH) -> None:
    conn = connect(db_path)
    try:
        conn.execute(
            "INSERT INTO events(job_id,action) VALUES(?,?)",
            ((job_id or "__system__")[:160], str(action or "")[:1000]),
        )
        conn.commit()
    finally:
        conn.close()


def get_events(limit: int = 50, job_id: str | None = None, db_path: str = DEFAULT_DB_PATH) -> list[dict]:
    conn = connect(db_path)
    try:
        if job_id:
            rows = conn.execute(
                "SELECT job_id, action, ts FROM events WHERE job_id=? ORDER BY ts DESC LIMIT ?",
                (job_id, int(limit)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT job_id, action, ts FROM events ORDER BY ts DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
    finally:
        conn.close()
    return [{"job_id": row[0], "action": row[1], "ts": row[2]} for row in rows]
