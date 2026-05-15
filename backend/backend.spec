# -*- mode: python ; coding: utf-8 -*-
import sys
import site
import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None
backend_root = Path("backend").resolve()
if not (backend_root / "main.py").exists():
    backend_root = Path(".").resolve()
onedir_sidecar = sys.platform == "win32"
if sys.platform == "win32":
    venv_site_packages = backend_root / ".venv" / "Lib" / "site-packages"
else:
    venv_site_packages = backend_root / ".venv" / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
site.getusersitepackages = lambda: str(venv_site_packages)

release_features = {
    feature.strip().lower()
    for feature in os.environ.get("JHM_RELEASE_FEATURES", "core,graph").split(",")
    if feature.strip()
}
include_browser = "browser" in release_features or "all" in release_features
include_vector = "vector" in release_features or "all" in release_features
include_graph = "graph" in release_features or "all" in release_features

hidden = [
    "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto",
    "uvicorn.protocols", "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto", "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "fastapi", "fastapi.middleware.cors",
    "anthropic", "openai", "instructor",
    "langgraph", "langgraph.graph",
    "apscheduler", "apscheduler.schedulers.asyncio",
    "fpdf",
    "pypdf", "markdown",
    "tenacity",
    "graph",
    "contracts", "contracts.services",
    "gateway", "gateway.clients", "gateway.supervisor",
    "services", "services.apps", "services.auth",
    "graph_service", "graph_service.stats", "graph_service.helpers",
    "db.client",
    "llm", "logger",
] + collect_submodules("contracts") + collect_submodules("gateway") + collect_submodules("services") + collect_submodules("graph_service")

if include_graph:
    hidden += ["kuzu"]

if include_browser:
    hidden += collect_submodules("playwright")

if include_vector:
    hidden += ["lancedb", "pyarrow"] + collect_submodules(
        "lancedb",
        filter=lambda name: ".tests" not in name and not name.endswith(".conftest"),
    ) + collect_submodules(
        "pyarrow",
        filter=lambda name: ".tests" not in name and not name.endswith(".conftest"),
    )

datas = (
    [(str(backend_root / "data" / "sqlite" / "migrations"), "data/sqlite/migrations")]
)

if include_browser:
    datas += collect_data_files("playwright")

if include_vector:
    datas += collect_data_files("lancedb") + collect_data_files("pyarrow")

excludes = [
    "IPython", "notebook", "jupyter", "docutils", "sphinx",
    "setuptools", "pip", "wheel", "pkg_resources",
    "unittest", "pydoc", "xmlrpc", "lib2to3",
    "pyarrow.tests", "lancedb.tests",
    "tkinter", "matplotlib", "PIL", "cv2",
    "pytest", "tensorboard",
    "sentence_transformers", "transformers",
    "torch", "torch.distributed",
    "sklearn", "scipy",
]

if not include_browser:
    excludes += ["playwright"]

if not include_vector:
    excludes += ["lancedb", "pyarrow"]

a = Analysis(
    ["main.py"],
    pathex=[str(backend_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe_inputs = [] if onedir_sidecar else [a.binaries, a.zipfiles, a.datas]

exe = EXE(
    pyz, a.scripts,
    *exe_inputs,
    exclude_binaries=onedir_sidecar,
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # The Tauri shell captures stdout/stderr; on Windows a console subsystem
    # sidecar flashes a terminal window during app startup.
    console=sys.platform != "win32",
)

if onedir_sidecar:
    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=False,
        name="backend",
    )
