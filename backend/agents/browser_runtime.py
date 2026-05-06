from __future__ import annotations

import os


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


async def launch_chromium(playwright, *, headless: bool = True, **kwargs):
    try:
        return await playwright.chromium.launch(headless=headless, **kwargs)
    except Exception as exc:
        executable = chromium_executable()
        if not executable:
            raise
        message = str(exc).lower()
        if "executable" not in message and "chromium" not in message and "browser" not in message:
            raise
        return await playwright.chromium.launch(
            headless=headless,
            executable_path=executable,
            **kwargs,
        )
