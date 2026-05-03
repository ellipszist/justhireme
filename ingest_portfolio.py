"""
JustHireMe - export current Knowledge Brain as a profile JSON.

Usage:
    python ingest_portfolio.py <PORT>

Reads your current profile from the running backend and writes
profile_export.json to the current directory. You can edit it
and re-import via the JSON Import tab in the app.
"""

import json
import sys

import requests


if len(sys.argv) < 2:
    print("Usage: python ingest_portfolio.py <PORT>")
    sys.exit(1)

PORT = int(sys.argv[1])
TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
BASE = f"http://127.0.0.1:{PORT}/api/v1"
HEADERS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}

profile = requests.get(f"{BASE}/profile", headers=HEADERS).json()
identity = requests.get(f"{BASE}/identity", headers=HEADERS).json()

export = {
    "candidate": {
        "name": profile.get("candidate", {}).get("n", "") or profile.get("n", ""),
        "summary": profile.get("candidate", {}).get("s", "") or profile.get("s", ""),
    },
    "identity": identity,
    "skills": [
        {"name": s["n"], "category": s.get("cat", "general")}
        for s in profile.get("skills", [])
    ],
    "experience": [
        {
            "role": e["role"],
            "company": e.get("co", ""),
            "period": e.get("period", ""),
            "description": e.get("d", ""),
        }
        for e in profile.get("experience", profile.get("exp", []))
    ],
    "projects": [
        {
            "title": p["title"],
            "stack": ", ".join(p.get("stack", [])) if isinstance(p.get("stack"), list) else p.get("stack", ""),
            "repo": p.get("repo", ""),
            "impact": p.get("impact", ""),
        }
        for p in profile.get("projects", [])
    ],
    "education": [
        {"title": e["title"]} if isinstance(e, dict) else {"title": str(e)}
        for e in profile.get("education", [])
    ],
    "certifications": [
        {"title": c["title"]} if isinstance(c, dict) else {"title": str(c)}
        for c in profile.get("certifications", [])
    ],
    "achievements": [
        {"title": a["title"]} if isinstance(a, dict) else {"title": str(a)}
        for a in profile.get("achievements", [])
    ],
}

with open("profile_export.json", "w", encoding="utf-8") as f:
    json.dump(export, f, indent=2, ensure_ascii=False)

print(
    f"Exported {sum(len(v) if isinstance(v, list) else 1 for v in export.values())} "
    "items to profile_export.json"
)
