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

BASE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "JustHireMe")
VECTOR_DIR = os.path.join(BASE_DIR, "vector")
os.makedirs(VECTOR_DIR, exist_ok=True)


class NullVectorStore:
    """No-op vector store so profile CRUD never fails because embeddings are unavailable."""

    def list_tables(self):
        return []

    def create_table(self, *_args, **_kwargs):
        return None

    def open_table(self, *_args, **_kwargs):
        return self

    def add(self, *_args, **_kwargs):
        return None


try:
    if lancedb is None:
        raise RuntimeError(_LANCEDB_IMPORT_ERROR or "LanceDB is not available")
    vec = lancedb.connect(VECTOR_DIR)
except Exception as exc:
    _log.warning("vector store disabled: %s", exc)
    vec = NullVectorStore()
