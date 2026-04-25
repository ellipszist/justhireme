import asyncio
import base64
import anthropic
from pydantic import BaseModel, Field
from typing import List

_client = anthropic.Anthropic()
_MODEL  = "claude-sonnet-4-6"

_DOM_MAP = [
    ("input[name*='first_name']",  "first_name"),
    ("input[name*='firstName']",   "first_name"),
    ("input[name*='last_name']",   "last_name"),
    ("input[name*='lastName']",    "last_name"),
    ("input[name*='full_name']",   "name"),
    ("input[name*='fullName']",    "name"),
    ("input[name*='name']",        "name"),
    ("input[name*='email']",       "email"),
    ("input[type='email']",        "email"),
    ("input[name*='phone']",       "phone"),
    ("input[name*='mobile']",      "phone"),
    ("input[name*='linkedin']",    "linkedin_url"),
    ("input[name*='website']",     "website"),
    ("input[name*='github']",      "github"),
    ("input[name*='portfolio']",   "website"),
    ("textarea[name*='cover']",    "cover_letter"),
    ("textarea[name*='message']",  "cover_letter"),
]

_FILL_DELAY = 500


async def _fill_dom(p, j: dict, a: str):
    filled = []
    for sel, key in _DOM_MAP:
        v = j.get(key, "")
        if not v:
            continue
        try:
            el = p.locator(sel).first
            await el.wait_for(state="visible", timeout=2000)
            await el.focus()
            await p.wait_for_timeout(_FILL_DELAY)
            await el.fill(str(v), timeout=3000)
            filled.append(key)
            await p.wait_for_timeout(_FILL_DELAY)
        except Exception:
            pass
    try:
        u = p.locator("input[type='file']").first
        await u.set_input_files(a, timeout=5000)
        await p.wait_for_timeout(_FILL_DELAY)
    except Exception:
        pass
    return filled


class _Act(BaseModel):
    kind: str
    x:    float
    y:    float
    text: str = ""


class _Acts(BaseModel):
    actions: List[_Act] = Field(default_factory=list)


async def _fill_vision(p, j: dict, a: str):
    shot = await p.screenshot(type="png")
    b64  = base64.standard_b64encode(shot).decode()
    ctx  = (
        f"Name: {j.get('name','')} | Email: {j.get('email','')} | "
        f"Phone: {j.get('phone','')} | LinkedIn: {j.get('linkedin_url','')}"
    )
    r = _client.messages.parse(
        model=_MODEL,
        max_tokens=2048,
        system=(
            "You are a browser automation agent using Set-of-Mark visual grounding. "
            "Examine the job application form screenshot. "
            "Return ordered actions (click or type) with exact pixel coordinates (x, y) "
            "to fill every visible field with the candidate's details. "
            "For file upload inputs, emit a click action on the upload element. "
            "kind must be exactly 'click' or 'type'."
        ),
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                {"type": "text", "text": ctx},
            ],
        }],
        output_format=_Acts,
    )
    for act in r.parsed_output.actions:
        if act.kind == "click":
            await p.mouse.click(act.x, act.y)
            await p.wait_for_timeout(_FILL_DELAY)
        elif act.kind == "type":
            await p.mouse.click(act.x, act.y)
            await p.wait_for_timeout(200)
            await p.keyboard.type(act.text, delay=40)
            await p.wait_for_timeout(_FILL_DELAY)


async def _find_submit(p):
    for sel in [
        "button[type='submit']",
        "input[type='submit']",
        "button:has-text('Submit Application')",
        "button:has-text('Submit')",
        "button:has-text('Apply Now')",
        "button:has-text('Apply')",
    ]:
        try:
            btn = p.locator(sel).first
            await btn.wait_for(state="visible", timeout=2000)
            return btn
        except Exception:
            pass
    return None


async def _run(job: dict, asset: str, dry_run: bool = False) -> bool:
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        b   = await pw.chromium.launch(headless=False, slow_mo=80)
        ctx = await b.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        pg = await ctx.new_page()
        await pg.goto(job.get("url", ""), wait_until="domcontentloaded", timeout=30000)
        await pg.wait_for_timeout(2000)

        filled = []
        try:
            filled = await _fill_dom(pg, job, asset)
        except Exception:
            await _fill_vision(pg, job, asset)

        submit_btn = await _find_submit(pg)

        if dry_run:
            if submit_btn:
                await submit_btn.scroll_into_view_if_needed()
                await submit_btn.evaluate("el => el.style.outline = '3px solid #ef4444'")
            await pg.wait_for_timeout(4000)
            await ctx.close()
            await b.close()
            return bool(filled)

        ok = False
        if submit_btn:
            await submit_btn.click(timeout=5000)
            ok = True
        await pg.wait_for_timeout(2000)
        await ctx.close()
        await b.close()
    return ok


def run(job: dict, asset: str, dry_run: bool = False) -> bool:
    return asyncio.run(_run(job, asset, dry_run=dry_run))
