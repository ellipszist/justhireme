# -*- mode: python ; coding: utf-8 -*-
import sys
import site
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None
backend_root = Path("backend").resolve()
if not (backend_root / "main.py").exists():
    backend_root = Path(".").resolve()
venv_site_packages = backend_root / ".venv" / "Lib" / "site-packages"
site.getusersitepackages = lambda: str(venv_site_packages)

hidden = [
    "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto",
    "uvicorn.protocols", "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto", "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "fastapi", "fastapi.middleware.cors",
    "kuzu", "lancedb",
    "anthropic", "openai", "instructor",
    "langgraph", "langgraph.graph",
    "apscheduler", "apscheduler.schedulers.asyncio",
    "fpdf",
    "pypdf", "markdown",
    "tenacity",
    "agents.ingestor", "agents.evaluator", "agents.generator",
    "agents.actuator", "agents.scout", "agents.free_scout",
    "agents.scoring_engine", "agents.semantic", "agents.contact_lookup",
    "agents.lead_intel", "agents.feedback_ranker", "agents.query_gen",
    "agents.x_scout", "agents.feedback_ranker", "agents.browser_runtime",
    "graph",
    "db.client",
    "llm", "logger",
] + collect_submodules("playwright")

datas = collect_data_files("playwright")

a = Analysis(
    ["main.py"],
    pathex=[str(backend_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "matplotlib", "PIL", "cv2",
        "pytest", "tensorboard",
        "sentence_transformers", "transformers",
        "torch", "torch.distributed",
        "sklearn", "scipy",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, a.binaries, a.zipfiles, a.datas,
    [],
    exclude_binaries=False,
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
