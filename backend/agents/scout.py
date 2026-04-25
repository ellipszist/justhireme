import asyncio
import hashlib
from typing import List
from pydantic import BaseModel, Field
from db.client import url_exists, save_lead


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
        pg = await br.new_page()
        await pg.goto(u, wait_until="networkidle", timeout=30000)
        html = await pg.content()
        await br.close()
    return _to_md(html)


class _Lead(BaseModel):
    title:    str
    company:  str
    url:      str
    platform: str = ""


class _Leads(BaseModel):
    leads: List[_Lead] = Field(default_factory=list)


def _parse(md: str, src: str) -> list:
    from llm import call_llm
    o = call_llm(
        "You are a job-lead extractor. Given scraped job-board markdown, "
        "return every distinct job posting you find. "
        "If the page is a single job, return just that one. "
        "If no jobs found, return an empty list.",
        f"Source URL: {src}\n\n{md}",
        _Leads,
    )
    return [l.model_dump() for l in o.leads]


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


def scrape(u: str, headed: bool = False) -> list:
    md = asyncio.run(_crawl(u, headed=headed))
    return _parse(md, u)


def run(
    urls: list[str] | None = None,
    queries: list[str] | None = None,
    apify_token: str | None = None,
    apify_actor: str | None = None,
    headed: bool = False,
) -> list:
    leads = []

    if apify_token and apify_actor and queries:
        raw = asyncio.run(apify(apify_actor, {"queries": queries}, apify_token))
        for item in raw:
            u = item.get("url", "")
            jid = _h(u)
            if u and not url_exists(jid):
                t, co, plat = item.get("title", ""), item.get("company", ""), item.get("platform", "apify")
                save_lead(jid, t, co, u, plat)
                leads.append({"job_id": jid, "title": t, "company": co, "url": u, "platform": plat})

    for u in (urls or []):
        jid = _h(u)
        if url_exists(jid):
            continue
        for item in scrape(u, headed=headed):
            ju = item.get("url", u)
            jjid = _h(ju)
            if url_exists(jjid):
                continue
            t, co, plat = item.get("title", ""), item.get("company", ""), item.get("platform", "web")
            save_lead(jjid, t, co, ju, plat)
            leads.append({"job_id": jjid, "title": t, "company": co, "url": ju, "platform": plat})

    return leads
