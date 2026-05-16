from __future__ import annotations

import importlib
from pathlib import Path


def test_pdf_renderer_uses_jhm_app_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("JHM_APP_DATA_DIR", str(tmp_path / "roaming-app-data"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local-app-data"))

    import generation.pdf_renderer as pdf_renderer

    module = importlib.reload(pdf_renderer)

    assert Path(module._assets) == tmp_path / "roaming-app-data" / "JustHireMe" / "assets"


def test_lead_asset_fallback_uses_jhm_app_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("JHM_APP_DATA_DIR", str(tmp_path / "roaming-app-data"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local-app-data"))

    from api.routers import leads

    assert Path(leads.default_assets_dir()) == tmp_path / "roaming-app-data" / "JustHireMe" / "assets"
