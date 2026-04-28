import asyncio
import hashlib
import sys
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from pydantic import BaseModel, Field
from db.client import url_exists, save_lead

_MAX_AGE_DAYS = 7


def _cutoff() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=_MAX_AGE_DAYS)


def _parse_date(s: str) -> datetime | None:
    """
    Parse a posted-date string into a UTC datetime.
    Handles:
      - Relative: "2 days ago", "3 hours ago", "1 week ago", "yesterday", "just now"
      - RFC 2822: "Wed, 29 Jan 2025 10:00:00 +0000"  (RSS pubDate)
      - ISO 8601: "2025-01-29T10:00:00Z"
      - Common: "Jan 29, 2025", "January 29 2025", "29/01/2025"
    Returns None if unparseable (caller treats as recent — include by default).
    """
    import re
    if not s or not s.strip():
        return None
    s = s.strip().lower()

    # ── Relative dates ───────────────────────────────────────────────
    now = datetime.now(timezone.utc)

    if s in ("just now", "moments ago", "seconds ago", "today"):
        return now

    if s == "yesterday":
        return now - timedelta(days=1)

    m = re.search(r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago", s)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {
            "second": timedelta(seconds=n),
            "minute": timedelta(minutes=n),
            "hour":   timedelta(hours=n),
            "day":    timedelta(days=n),
            "week":   timedelta(weeks=n),
            "month":  timedelta(days=n * 30),
            "year":   timedelta(days=n * 365),
        }.get(unit)
        return now - delta if delta else None

    # ── Absolute dates ───────────────────────────────────────────────
    # Normalise to titlecase so month names parse correctly
    s_orig = s.strip()
    for fmt in (
        "%a, %d %b %Y %H:%M:%S %z",   # RFC 2822
        "%Y-%m-%dT%H:%M:%SZ",          # ISO 8601 Z
        "%Y-%m-%dT%H:%M:%S%z",         # ISO 8601 with tz
        "%Y-%m-%d",                     # 2025-01-29
        "%d/%m/%Y",                     # 29/01/2025
        "%m/%d/%Y",                     # 01/29/2025
        "%b %d, %Y",                    # Jan 29, 2025
        "%B %d, %Y",                    # January 29, 2025
        "%d %b %Y",                     # 29 Jan 2025
        "%d %B %Y",                     # 29 January 2025
    ):
        try:
            dt = datetime.strptime(s_orig.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue

    return None  # unknown — caller will include the lead


def _is_recent(date_str: str) -> bool:
    """Return True if the date is within _MAX_AGE_DAYS, or if date is unknown."""
    if not date_str:
        return True   # no date info → include (don't discard on uncertainty)
    dt = _parse_date(date_str)
    if dt is None:
        return True   # unparseable → include
    return dt >= _cutoff()


def _h(u: str) -> str:
    return hashlib.md5(u.encode()).hexdigest()[:16]


def _to_md(html: str) -> str:
    import html2text
    h = html2text.HTML2Text()
    h.ignore_links = False
    return h.handle(html)


async def _crawl(u: str, headed: bool = False) -> str:
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        br = await pw.chromium.launch(headless=not headed)
        ctx = await br.new_context(ignore_https_errors=True)
        pg = await ctx.new_page()
        await pg.goto(u, wait_until="domcontentloaded", timeout=30000)
        html = await pg.content()
        await br.close()
    return _to_md(html)


class _Lead(BaseModel):
    title:       str
    company:     str
    url:         str
    platform:    str = ""
    description: str = ""   # brief summary of the role / requirements
    posted_date: str = ""   # raw date string as it appears on the page


class _Leads(BaseModel):
    leads: List[_Lead] = Field(default_factory=list)


def _parse(md: str, src: str) -> list:
    from llm import call_llm
    o = call_llm(
        "You are a job-lead extractor. Given scraped job-board markdown, "
        "return every distinct job posting you find. "
        "For each posting extract: title, company, url, a 2-3 sentence "
        "description summarising the role, required tech stack, and seniority level, "
        "and posted_date (the date/time the job was posted exactly as shown on the page, "
        "e.g. '2 days ago', 'Jan 29 2025', '3 hours ago' — leave empty string if not visible). "
        "If the page is a single job, return just that one. "
        "If no jobs found, return an empty list.",
        f"Source URL: {src}\n\n{md}",
        _Leads,
        step="scout",
    )
    # Filter to recent only — exclude anything provably older than 7 days
    results = []
    for lead in o.leads:
        d = lead.model_dump()
        if _is_recent(d.get("posted_date", "")):
            results.append(d)
        else:
            print(f"[scout] Skipping old listing ({d.get('posted_date','')}): {d.get('title','')}", file=sys.stderr)
    return results


async def apify(actor: str, inp: dict, tok: str) -> list:
    import httpx
    async with httpx.AsyncClient(timeout=60) as cx:
        run = await cx.post(
            f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items",
            params={"token": tok},
            json=inp,
        )
        run.raise_for_status()
        return run.json()


def _ensure_scheme(u: str) -> str:
    """Prepend https:// if the URL has no scheme — Playwright requires a full URL."""
    if u.startswith("site:") or u.startswith("http://") or u.startswith("https://"):
        return u
    return "https://" + u


def scrape(u: str, headed: bool = False) -> list:
    u = _ensure_scheme(u)
    md = asyncio.run(_crawl(u, headed=headed))
    return _parse(md, u)


async def _scrape_rss(u: str) -> list:
    import httpx
    import xml.etree.ElementTree as ET
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.get(u)
        root = ET.fromstring(r.text)
        items = []
        cut = _cutoff()
        for item in root.findall(".//item"):
            t    = item.find("title").text if item.find("title") is not None else ""
            link = item.find("link").text  if item.find("link")  is not None else ""
            pub  = item.find("pubDate")
            date_str = pub.text if pub is not None else ""
            # Filter by pubDate — include if recent or date unknown
            if not _is_recent(date_str):
                print(f"[scout] RSS: skipping old item ({date_str}): {t}", file=sys.stderr)
                continue
            items.append({"title": t, "company": "RSS Feed", "url": link,
                          "platform": "rss", "posted_date": date_str})
        return items


async def _scrape_remoteok() -> list:
    import httpx
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    async with httpx.AsyncClient(timeout=30, headers=headers) as cx:
        r = await cx.get("https://remoteok.com/api")
        data = r.json()
    cut = _cutoff()
    results = []
    for j in data:
        if not isinstance(j, dict):
            continue
        epoch = j.get("epoch")  # Unix timestamp
        if epoch:
            posted = datetime.fromtimestamp(int(epoch), tz=timezone.utc)
            if posted < cut:
                continue  # too old
        results.append({
            "title":    j.get("position", ""),
            "company":  j.get("company", ""),
            "url":      j.get("url", ""),
            "platform": "remoteok",
            "posted_date": datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat() if epoch else "",
        })
    return results


def run(
    urls: list[str] | None = None,
    queries: list[str] | None = None,
    apify_token: str | None = None,
    apify_actor: str | None = None,
    headed: bool = False,
) -> list:
    leads = []
    
    # Handle Special Targets (RSS/API)
    all_targets = urls or []
    processed_leads = []

    for target in all_targets:
        target = _ensure_scheme(target)
        try:
            if "remoteok.com/api" in target:
                processed_leads.extend(asyncio.run(_scrape_remoteok()))
            elif target.endswith(".rss") or "weworkremotely.com" in target:
                processed_leads.extend(asyncio.run(_scrape_rss(target)))
            elif target.startswith("site:"):
                # Google Dork — qdr:w = past week (7 days)
                query = target.replace(" ", "+")
                google_url = f"https://www.google.com/search?q={query}&tbs=qdr:w"
                for item in scrape(google_url, headed=headed):
                    processed_leads.append(item)
            else:
                # Standard Web Scrape
                processed_leads.extend(scrape(target, headed=headed))
        except Exception as _e:
            import sys
            print(f"[scout] Skipping {target}: {_e}", file=sys.stderr)

    # Apify fallback
    if apify_token and apify_actor and queries:
        raw = asyncio.run(apify(apify_actor, {"queries": queries}, apify_token))
        for item in raw:
            processed_leads.append({
                "title": item.get("title", ""),
                "company": item.get("company", ""),
                "url": item.get("url", ""),
                "platform": "apify"
            })

    # Save and Deduplicate
    for item in processed_leads:
        u = item.get("url", "")
        if not u: continue
        jid = _h(u)
        if not url_exists(jid):
            t    = item.get("title", "")
            co   = item.get("company", "")
            plat = item.get("platform", "scout")
            desc = item.get("description", "")
            save_lead(jid, t, co, u, plat, desc)
            leads.append({"job_id": jid, "title": t, "company": co, "url": u, "platform": plat, "description": desc})

    return leads
