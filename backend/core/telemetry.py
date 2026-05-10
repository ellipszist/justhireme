from __future__ import annotations

import json
import os
import time
import traceback
from pathlib import Path


def telemetry_enabled() -> bool:
    return os.environ.get("JHM_LOCAL_ERROR_TELEMETRY", "").strip().lower() in {"1", "true", "yes", "on"}


def errors_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "JustHireMe"
    return Path(os.environ.get("JHM_ERRORS_JSONL", base / "errors.jsonl"))


def record_exception(exc: BaseException, *, domain: str = "api", request_id: str = "", path: str = "") -> None:
    if not telemetry_enabled():
        return
    try:
        path_obj = errors_path()
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "domain": domain,
            "request_id": request_id,
            "path": path,
            "error_type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__)[-8:],
        }
        with path_obj.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        return


def _rotate_error_log(max_lines: int = 500) -> None:
    try:
        path_obj = errors_path()
        lines = path_obj.read_text(encoding="utf-8").splitlines(True)
        if len(lines) > max_lines:
            path_obj.write_text("".join(lines[-max_lines:]), encoding="utf-8")
    except Exception:
        return


def log_error(exc: BaseException | str, context: dict | None = None) -> None:
    try:
        path_obj = errors_path()
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "type": type(exc).__name__ if not isinstance(exc, str) else "FrontendError",
            "message": str(exc),
            "traceback": traceback.format_exc() if not isinstance(exc, str) else "",
            "context": context or {},
        }
        with path_obj.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        _rotate_error_log()
    except Exception:
        return
