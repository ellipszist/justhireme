from __future__ import annotations

from data.sqlite.connection import DEFAULT_DB_PATH, connect


def save_settings(data: dict, db_path: str = DEFAULT_DB_PATH) -> None:
    conn = connect(db_path)
    try:
        for key, value in data.items():
            conn.execute("INSERT OR REPLACE INTO settings(key,val) VALUES(?,?)", (key, str(value)))
        conn.commit()
    finally:
        conn.close()


def get_settings(db_path: str = DEFAULT_DB_PATH) -> dict:
    conn = connect(db_path)
    try:
        rows = conn.execute("SELECT key,val FROM settings").fetchall()
    finally:
        conn.close()
    return {row[0]: row[1] for row in rows}


def get_setting(key: str, default: str = "", db_path: str = DEFAULT_DB_PATH) -> str:
    conn = connect(db_path)
    try:
        row = conn.execute("SELECT val FROM settings WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    return row[0] if row else default

