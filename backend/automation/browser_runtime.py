from __future__ import annotations

import os
import platform
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path


_RELEASE_DOWNLOAD_BASE = "https://github.com/vasu-devs/JustHireMe/releases/latest/download"


def browser_runtime_dir() -> Path:
    configured = os.environ.get("JHM_BROWSER_RUNTIME_DIR") or os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if configured:
        return Path(configured)
    if os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys_platform() == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return root / "JustHireMe" / "browser-runtime" / "ms-playwright"


def sys_platform() -> str:
    return platform.system().lower()


def browser_runtime_asset_name() -> str:
    system = sys_platform()
    if system == "windows":
        return "JustHireMe-browser-runtime-windows.zip"
    if system == "darwin":
        return "JustHireMe-browser-runtime-macos.zip"
    return "JustHireMe-browser-runtime-linux.zip"


def browser_runtime_url() -> str:
    return os.environ.get(
        "JHM_BROWSER_RUNTIME_URL",
        f"{_RELEASE_DOWNLOAD_BASE}/{browser_runtime_asset_name()}",
    )


def chromium_executable() -> str | None:
    candidates = [
        os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def browser_runtime_ready(path: Path | None = None) -> bool:
    root = path or browser_runtime_dir()
    if not root.exists():
        return False
    return any(candidate.name.lower().startswith("chromium") for candidate in root.iterdir() if candidate.is_dir())


def ensure_browser_runtime() -> Path:
    runtime_dir = browser_runtime_dir()
    if browser_runtime_ready(runtime_dir):
        return runtime_dir

    runtime_dir.parent.mkdir(parents=True, exist_ok=True)
    url = browser_runtime_url()
    with tempfile.TemporaryDirectory(prefix="jhm-browser-runtime-") as tmp:
        archive_path = Path(tmp) / browser_runtime_asset_name()
        try:
            urllib.request.urlretrieve(url, archive_path)
            extract_dir = Path(tmp) / "extract"
            extract_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(extract_dir)
        except Exception as exc:
            raise RuntimeError(
                "Playwright Chromium is not installed yet and the optional browser runtime "
                f"could not be downloaded from {url}. Connect to the internet and retry browser automation."
            ) from exc

        extracted_runtime = extract_dir / "ms-playwright"
        if not extracted_runtime.exists():
            nested = next(extract_dir.glob("**/ms-playwright"), None)
            if nested:
                extracted_runtime = nested
        if not extracted_runtime.exists():
            raise RuntimeError("Downloaded browser runtime archive did not contain ms-playwright.")

        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        shutil.copytree(extracted_runtime, runtime_dir)

    if not browser_runtime_ready(runtime_dir):
        raise RuntimeError("Browser runtime installation finished, but Chromium was not found.")
    return runtime_dir


async def launch_chromium(playwright, *, headless: bool = True, **kwargs):
    try:
        return await playwright.chromium.launch(headless=headless, **kwargs)
    except Exception as exc:
        message = str(exc).lower()
        if "executable" in message or "chromium" in message or "browser" in message:
            executable = chromium_executable()
            if executable:
                return await playwright.chromium.launch(
                    headless=headless,
                    executable_path=executable,
                    **kwargs,
                )
            runtime_dir = ensure_browser_runtime()
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(runtime_dir)
            return await playwright.chromium.launch(headless=headless, **kwargs)

        executable = chromium_executable()
        if not executable:
            raise
        return await playwright.chromium.launch(
            headless=headless,
            executable_path=executable,
            **kwargs,
        )
