from __future__ import annotations

import asyncio
import re

from pydantic import BaseModel, Field

from agents.browser_runtime import launch_chromium
from logger import get_logger

_log = get_logger(__name__)


class _PortfolioExtract(BaseModel):
    candidate_summary: str = Field(
        default="",
        description="2-4 sentence professional bio from the About/Hero section",
    )
    skills: list[str] = Field(
        default_factory=list,
        description="tech skills mentioned anywhere on the page",
    )
    projects: list[dict] = Field(
        default_factory=list,
        description="list of {title, stack, repo, impact} for each project shown",
    )
    achievements: list[str] = Field(
        default_factory=list,
        description="awards, publications, notable mentions",
    )


async def ingest_portfolio_url(url: str) -> dict:
    """
    Fetch a personal portfolio site with Playwright, extract text,
    and use the LLM to parse projects, skills, and bio.

    Returns the same shape as ProfileImportBody so the caller can
    feed it directly into profile JSON import logic.
    """
    page_text = ""
    screenshot_b64 = ""
    fetch_error = None

    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            browser = await launch_chromium(pw, headless=True)
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle", timeout=25000)
            await page.wait_for_timeout(1500)

            page_text = await page.evaluate("""() => {
                const bad = ['script', 'style', 'noscript', 'svg', 'head'];
                bad.forEach(t => document.querySelectorAll(t)
                    .forEach(el => el.remove()));
                return document.body.innerText;
            }""")
            page_text = page_text[:6000]

            try:
                raw = await page.screenshot(type="png", full_page=False)
                import base64
                screenshot_b64 = base64.b64encode(raw).decode()
            except Exception:
                pass
            await browser.close()
    except Exception as exc:
        _log.warning("portfolio browser fetch failed for %s: %s; trying HTTP fallback", url, exc)
        fetch_error = str(exc)
        page_text = await asyncio.to_thread(_fetch_portfolio_text_http, url)

    if not page_text and fetch_error:
        return {"error": fetch_error}

    llm_unavailable = False
    extract = None
    try:
        from llm import _resolve
        provider, api_key, _model = _resolve("ingestor")
        llm_unavailable = provider != "ollama" and not api_key
        system = (
            "You extract structured professional information from personal "
            "portfolio websites."
        )
        user_prompt = (
            f"Extract structured professional information from this portfolio website.\n\n"
            f"URL: {url}\n\nPage content:\n{page_text}\n\n"
            "Return skills as simple strings. For each project include title, "
            "comma-separated stack, repo URL if visible (else empty string), "
            "and a 1-sentence impact/description."
        )
        from llm import call_llm
        if not llm_unavailable:
            extract = await asyncio.to_thread(
                call_llm, system, user_prompt, _PortfolioExtract, "ingestor",
            )
    except Exception as exc:
        _log.warning("portfolio LLM extract failed: %s", exc)

    if extract:
        projects = []
        for p in (extract.projects or []):
            if isinstance(p, dict):
                projects.append({
                    "title": str(p.get("title", "")),
                    "stack": str(p.get("stack", "")),
                    "repo": str(p.get("repo", "")),
                    "impact": str(p.get("impact", "")),
                })
        return {
            "source": "portfolio_url",
            "url": url,
            "screenshot_b64": screenshot_b64,
            "candidate": {"name": "", "summary": extract.candidate_summary},
            "skills": [{"name": s, "category": "general"} for s in extract.skills],
            "projects": projects,
            "achievements": [{"title": a} for a in extract.achievements],
            "experience": [],
            "education": [],
            "certifications": [],
            "stats": {
                "skills": len(extract.skills),
                "projects": len(projects),
            },
            "error": None,
        }

    return {
        "source": "portfolio_url",
        "url": url,
        "screenshot_b64": screenshot_b64,
        "raw_text": page_text,
        "candidate": None,
        "error": "LLM unavailable - configure an API key to extract structured data",
    }


def _fetch_portfolio_text_http(url: str) -> str:
    import html
    import httpx

    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            response = client.get(
                url,
                headers={"User-Agent": "JustHireMe portfolio importer"},
            )
            response.raise_for_status()
            text = response.text
    except Exception as exc:
        _log.warning("portfolio HTTP fallback failed for %s: %s", url, exc)
        return ""

    text = re.sub(r"(?is)<(script|style|noscript|svg|head).*?</\1>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)[:6000]
