from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path


def test_vector_store_uses_jhm_app_data_dir(monkeypatch, tmp_path):
    calls: list[str] = []

    fake_lancedb = types.SimpleNamespace(
        connect=lambda path: calls.append(path) or types.SimpleNamespace()
    )
    monkeypatch.setitem(sys.modules, "lancedb", fake_lancedb)
    monkeypatch.setenv("JHM_APP_DATA_DIR", str(tmp_path / "roaming-app-data"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local-app-data"))

    from data.vector import connection

    module = importlib.reload(connection)

    expected_base = tmp_path / "roaming-app-data" / "JustHireMe"
    expected_vector = expected_base / "vector"
    assert Path(module.BASE_DIR) == expected_base
    assert Path(module.VECTOR_DIR) == expected_vector
    assert Path(calls[-1]) == expected_vector


def test_vector_store_falls_back_to_local_app_data(monkeypatch, tmp_path):
    calls: list[str] = []

    fake_lancedb = types.SimpleNamespace(
        connect=lambda path: calls.append(path) or types.SimpleNamespace()
    )
    monkeypatch.setitem(sys.modules, "lancedb", fake_lancedb)
    monkeypatch.delenv("JHM_APP_DATA_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local-app-data"))

    from data.vector import connection

    module = importlib.reload(connection)

    expected_vector = tmp_path / "local-app-data" / "JustHireMe" / "vector"
    assert Path(module.VECTOR_DIR) == expected_vector
    assert Path(calls[-1]) == expected_vector


def test_null_vector_store_reports_disabled_reason():
    from data.vector.connection import NullVectorStore

    vec = NullVectorStore("LanceDB not bundled")

    assert vec.available is False
    assert vec.reason == "LanceDB not bundled"
    assert vec.list_tables() == []
