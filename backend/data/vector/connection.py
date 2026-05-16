from __future__ import annotations

import os

from core.logging import get_logger

_log = get_logger(__name__)

try:
    import lancedb
except Exception as exc:
    lancedb = None
    _LANCEDB_IMPORT_ERROR = str(exc)
else:
    _LANCEDB_IMPORT_ERROR = ""

def default_base_dir() -> str:
    root = os.environ.get("JHM_APP_DATA_DIR") or os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
    return os.path.join(root, "JustHireMe")


def default_vector_dir() -> str:
    return os.path.join(default_base_dir(), "vector")


BASE_DIR = default_base_dir()
VECTOR_DIR = default_vector_dir()


class NullVectorStore:
    """No-op vector store so profile CRUD never fails because embeddings are unavailable."""

    available = False

    def __init__(self, reason: str = ""):
        self.reason = reason

    def list_tables(self):
        return []

    def create_table(self, *_args, **_kwargs):
        return None

    def open_table(self, *_args, **_kwargs):
        return self

    def add(self, *_args, **_kwargs):
        return None


def _connect_vector_store():
    global BASE_DIR, VECTOR_DIR
    BASE_DIR = default_base_dir()
    VECTOR_DIR = default_vector_dir()
    os.makedirs(VECTOR_DIR, exist_ok=True)
    if lancedb is None:
        raise RuntimeError(_LANCEDB_IMPORT_ERROR or "LanceDB is not available")
    return lancedb.connect(VECTOR_DIR)


try:
    vec = _connect_vector_store()
except Exception as exc:
    if lancedb is None:
        _log.info("vector store disabled: %s", exc)
    else:
        _log.warning("vector store disabled: %s", exc)
    vec = NullVectorStore(str(exc))
