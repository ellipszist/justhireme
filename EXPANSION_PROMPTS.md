# JustHireMe — Freelance + Expanded Jobs: Implementation Prompts

> **How to use:** Copy-paste each phase's prompt into Claude. Execute them **in order** (Phase 1 → 7). Each prompt is self-contained with all the context needed. After each phase, verify the changes before moving to the next.

---

## PHASE 1 — Database Schema: Add `kind`, `budget`, and Freelance Statuses

```
I need you to modify the database layer of my JustHireMe app to support freelance gigs alongside regular job leads.

## What to change

### File: `backend/db/client.py`

**1. Add new columns to the `leads` table via the existing migration pattern.**

In the `_init_sql()` function, there's already a migration block that does `ALTER TABLE leads ADD COLUMN ... ` with try/except for each new column. Add these two new columns to that migration list:

- `kind TEXT DEFAULT 'job'` — distinguishes `'job'` vs `'freelance'` leads
- `budget TEXT DEFAULT ''` — stores freelance gig budget info like "$500-1000" or "hourly $50-80"

This means all existing leads automatically get `kind='job'`.

**2. Update `save_lead()` to accept `kind` and `budget` parameters.**

Current signature:
```python
def save_lead(jid: str, t: str, co: str, u: str, plat: str, desc: str = ""):
```

New signature:
```python
def save_lead(jid: str, t: str, co: str, u: str, plat: str, desc: str = "", kind: str = "job", budget: str = ""):
```

Update the INSERT statement to include `kind` and `budget` columns.

**3. Update `get_all_leads()` to return the `kind` and `budget` fields.**

Add `kind` and `budget` to the SELECT query and include them in the returned dict. Current SELECT is:
```sql
SELECT job_id,title,company,url,platform,status,score,reason,match_points,asset_path,description,gaps,cover_letter_path,selected_projects FROM leads ORDER BY created_at DESC
```

Add `kind, budget` to the end. Include them in the returned dict.

**4. Add `get_all_freelance_leads()` — same as `get_all_leads()` but filtered to `kind='freelance'`.**

```python
def get_all_freelance_leads() -> list:
    c = _sq.connect(sql)
    rows = c.execute(
        "SELECT job_id,title,company,url,platform,status,score,reason,match_points,asset_path,description,gaps,cover_letter_path,selected_projects,kind,budget FROM leads WHERE kind='freelance' ORDER BY created_at DESC"
    ).fetchall()
    c.close()
    # ... same dict construction as get_all_leads but with kind and budget fields
```

**5. Add `get_discovered_freelance_leads()` — same as `get_discovered_leads()` but filtered to `kind='freelance'`.**

```python
def get_discovered_freelance_leads() -> list:
    c = _sq.connect(sql)
    rows = c.execute(
        "SELECT job_id,title,company,url,platform,description,budget FROM leads WHERE status='discovered' AND kind='freelance'"
    ).fetchall()
    c.close()
    return [{"job_id": r[0], "title": r[1], "company": r[2], "url": r[3], "platform": r[4], "description": r[5] or "", "budget": r[6] or ""} for r in rows]
```

**6. Update `update_lead_status()` to accept freelance statuses.**

Current valid set:
```python
valid = {
    "discovered", "evaluating", "tailoring", "approved",
    "applied", "interviewing", "rejected", "accepted", "discarded",
}
```

Add freelance statuses:
```python
valid = {
    "discovered", "evaluating", "tailoring", "approved",
    "applied", "interviewing", "rejected", "accepted", "discarded",
    # Freelance statuses
    "matched", "bidding", "proposal_sent", "awarded", "completed",
}
```

**7. Update `update_lead_score()` to handle freelance leads differently.**

Currently it hard-codes `status = "tailoring" if s >= 76 else "discarded"`. We need it to check the lead's `kind` first:

```python
def update_lead_score(jid: str, s: int, r: str, match_points: list | None = None, gaps: list | None = None):
    c = _sq.connect(sql)
    # Check if this is a freelance lead
    row = c.execute("SELECT kind FROM leads WHERE job_id=?", (jid,)).fetchone()
    kind = row[0] if row else "job"
    
    if kind == "freelance":
        status = "matched" if s >= 76 else "discarded"
    else:
        status = "tailoring" if s >= 76 else "discarded"
    
    mp  = _json_dumps_list(match_points)
    gps = _json_dumps_list(gaps)
    c.execute(
        "UPDATE leads SET status=?, score=?, reason=?, match_points=?, gaps=? WHERE job_id=?",
        (status, s, r[:500], mp, gps, jid),
    )
    c.execute(
        "INSERT INTO events(job_id,action) VALUES(?,?)",
        (jid, f"score={s} status={status}"),
    )
    c.commit()
    c.close()
```

**8. Also update `get_discovered_leads()` to exclude freelance leads** so the existing job scan doesn't re-evaluate freelance gigs:

Change the WHERE clause from `WHERE status='discovered'` to `WHERE status='discovered' AND (kind='job' OR kind IS NULL)`.

## Important constraints
- Do NOT rename or restructure existing functions — only extend them
- Keep backward compatibility: existing leads with no `kind` value should work as `'job'`
- Use the same try/except ALTER TABLE migration pattern that already exists in `_init_sql()`
- The `_json_list`, `_json_dumps_list` helpers already exist — reuse them
```

---

## PHASE 2 — Freelance Scout: Platform-Specific Scrapers

```
I need you to create a new freelance scout agent for my JustHireMe app. This agent scrapes freelance platforms for gigs, similar to how `backend/agents/scout.py` scrapes job boards.

## Context

The existing `backend/agents/scout.py` has these patterns I want you to mirror:
- `_h(url)` → MD5 hash for dedup (first 16 chars)
- `_to_md(html)` → html2text conversion
- `_crawl(url)` → Playwright headless crawl
- `_parse(md, src)` → LLM extraction of structured leads
- `_is_recent(date_str)` → 7-day freshness filter
- `_scrape_rss(url)` → RSS feed parser
- `scrape(url)` → generic Playwright + LLM extraction
- `run(urls, ...)` → main entry point that dispatches to the right scraper

The app uses `call_llm(system, user, PydanticModel, step="scout")` from `backend/llm.py` for structured LLM output. The `step` parameter controls which provider/model is used.

Leads are saved via `save_lead(jid, title, company, url, platform, description, kind, budget)` from `backend/db/client.py` (updated in Phase 1 to accept `kind` and `budget`).

Dedup check: `url_exists(jid)` returns True if the lead already exists.

## Create: `backend/agents/freelance_scout.py`

### Pydantic models

```python
class _FreelanceLead(BaseModel):
    title: str
    company: str           # client name or "Anonymous Client"
    url: str
    platform: str = ""
    description: str = ""
    budget: str = ""       # "$500-1000", "hourly $50-80/hr", "TBD"
    duration: str = ""     # "2 weeks", "1-3 months", "ongoing"
    required_skills: list[str] = Field(default_factory=list)
    posted_date: str = ""

class _FreelanceLeads(BaseModel):
    leads: list[_FreelanceLead] = Field(default_factory=list)
```

### LLM extraction prompt

The `_parse_freelance()` function should use a freelance-specific system prompt:

```
You are a freelance-gig extractor. Given scraped marketplace markdown,
return every distinct freelance project/gig you find.

For each gig extract:
- title: the project/gig title
- company: client name (use "Anonymous Client" if hidden)
- url: direct link to the gig posting
- description: 2-3 sentence summary of the work, required skills, and deliverables
- budget: the budget/rate as shown ("$500-1000", "hourly $30-50", "TBD" if not listed)
- duration: project timeline ("2 weeks", "ongoing", etc. — empty if not shown)
- required_skills: list of specific tech skills mentioned (e.g. ["Python", "FastAPI", "React"])
- posted_date: when posted, exactly as shown on the page

If no gigs found, return an empty list.
```

### Platform-specific scrapers

**1. Upwork RSS** — `_scrape_upwork_rss(url)`
Upwork has RSS feeds at URLs like:
- `https://www.upwork.com/ab/feed/jobs/rss?q=python+fastapi&sort=recency`
- Any URL containing `upwork.com` and ending with RSS indicators

Parse like the existing `_scrape_rss()` but extract budget from the `<description>` or `<content:encoded>` field (Upwork embeds budget info in the RSS item description). Set `platform="upwork"`.

**2. Freelancer.com** — `_scrape_freelancer(query_terms)`
Use their public projects endpoint:
```python
async def _scrape_freelancer(query: str) -> list:
    import httpx
    url = "https://www.freelancer.com/api/projects/0.1/projects/active/"
    params = {
        "query": query,
        "compact": "true",
        "limit": 30,
        "sort_field": "time_submitted",
        "job_details": "true",
    }
    headers = {"User-Agent": "Mozilla/5.0 ..."}
    async with httpx.AsyncClient(timeout=30, headers=headers) as cx:
        r = await cx.get(url, params=params)
        data = r.json()
    # Parse data["result"]["projects"] — each has title, description, budget (minimum_budget/maximum_budget), currency, jobs (skills list)
```

Set `platform="freelancer"`.

**3. Generic Playwright + LLM** — For Toptal, Arc.dev, Contra, and any unknown URL.
Same pattern as the existing scout: crawl with Playwright, convert to markdown, pass to `_parse_freelance()`. Set `platform="scout"`.

**4. Google Dork** — URLs starting with `site:` get the same treatment as the job scout (rewrite to Google search URL with `&tbs=qdr:w`), but use `_parse_freelance()` instead of `_parse()`.

### Main entry point

```python
def run(
    urls: list[str] | None = None,
    apify_token: str | None = None,
    apify_actor: str | None = None,
    headed: bool = False,
) -> list:
```

This function should:
1. Iterate over all URLs from the `freelance_boards` setting
2. Dispatch to the right scraper based on URL pattern:
   - Contains `upwork.com` + RSS indicators → `_scrape_upwork_rss()`
   - Contains `freelancer.com` → `_scrape_freelancer()`
   - Starts with `site:` → Google Dork + `_parse_freelance()`
   - Everything else → generic Playwright + `_parse_freelance()`
3. Deduplicate via `url_exists()`
4. Save via `save_lead(..., kind="freelance", budget=...)` 
5. Return list of new leads

### Important
- Reuse `_h()`, `_to_md()`, `_crawl()`, `_is_recent()`, `_ensure_scheme()` from `scout.py` by importing them: `from agents.scout import _h, _to_md, _crawl, _is_recent, _ensure_scheme`
- Use `step="scout"` when calling `call_llm` (reuses the scout's LLM config)
- All async functions should be called with `asyncio.run()` inside sync wrappers, same pattern as scout.py
- Filter out leads older than 7 days using `_is_recent()`
```

---

## PHASE 3 — Freelance Query Generator

```
I need you to create a freelance-specific query generator for my JustHireMe app. This generates search queries for freelance platforms, similar to how `backend/agents/query_gen.py` generates queries for job boards.

## Context

The existing `backend/agents/query_gen.py`:
1. Splits URLs into `site:` entries (to enrich) vs passthrough (RSS, API, direct URLs)
2. Builds a profile summary from skills, projects, and experience
3. Calls the LLM to generate targeted `site:domain query` strings
4. Falls back to simple queries if LLM fails

It uses `call_llm(system, user, PydanticModel, step="query_gen")` from `backend/llm.py`.

The candidate profile dict shape:
```python
{
    "n": "Vasu DevS",
    "s": "Full Stack AI Engineer...",
    "skills": [{"id": "...", "n": "Python", "cat": "language"}, ...],
    "projects": [{"id": "...", "title": "BranchGPT", "stack": ["Next.js", "TypeScript", ...], "impact": "...", "repo": "..."}, ...],
    "exp": [{"id": "...", "role": "Full-Stack Engineer", "co": "Freelance", "period": "Mar 2026 → Apr 2026", "d": "..."}, ...]
}
```

## Create: `backend/agents/freelance_query_gen.py`

The key difference from job query gen: **no seniority keywords**. Freelance gigs care about what you can DO, not your title level. Instead, emphasize:
- Stack expertise drawn from shipped projects
- Specific deliverable types (API, dashboard, agent, chatbot, voice pipeline, etc.)
- Domain keywords (AI, fintech, e-commerce, etc.)

### Pydantic model

```python
class _Plan(BaseModel):
    queries: list[str]
```

### Logic

```python
def generate(profile: dict, urls: list[str]) -> list[str]:
```

1. Split `urls` into `site_domains` and `passthrough` (same helper as query_gen.py)
2. If no site domains, return urls unchanged
3. Build a profile summary emphasizing PROOF OF WORK:
   - Top 15 skills
   - Project titles + their stack (up to 20 unique stack tokens)
   - Types of things built: "voice agents, RAG pipelines, dashboards, Chrome extensions, full-stack MVPs"
4. Call the LLM with this system prompt:

```
You are a freelance project search expert. Your job is to write targeted
Google site: search queries that will surface freelance gigs matching a
developer's proven capabilities.

Rules:
- Output exactly ONE query per domain — no more.
- Each query must start with site:<domain>
- Focus on STACK and DELIVERABLE TYPES, not seniority.
- Use the developer's actual shipped tech stack — e.g. "FastAPI" "React" "LangChain"
- Include deliverable keywords: "API" OR "dashboard" OR "chatbot" OR "agent"
- Use OR between alternatives
- Never add quotation marks around the whole query
- Return only the list of queries — no extra commentary
```

5. Fallback if LLM fails: generate simple `site:<domain> "skill1" OR "skill2" OR "skill3"` from top 3 skills.

6. Return `passthrough + smart` (same as query_gen.py)

### Important
- Use `step="scout"` for `call_llm` (reuses scout's LLM config, same as query_gen uses)
- Keep the function signature identical to `query_gen.generate()` for consistency
- Import pattern: `from llm import call_llm`
```

---

## PHASE 4 — Freelance Evaluator: Proof-of-Work Scoring

```
I need you to create a freelance-specific evaluator for my JustHireMe app. This scores freelance gigs against the candidate's proof of work (shipped projects), different from the job evaluator which focuses on seniority + stack alignment.

## Context

The existing `backend/agents/evaluator.py`:
- `_build_proof(candidate_data)` — builds a string from projects, experience, and skills
- `_infer_experience_level(candidate_data)` — detects fresher/junior/mid
- `score(jd, candidate_data)` — calls LLM with calibrated rubric, returns `{score, reason, match_points, gaps}`
- Uses `call_llm(system, user, _Score, step="evaluator")` from `backend/llm.py`

The `_Score` Pydantic model:
```python
class _Score(BaseModel):
    score: int
    reason: str
    match_points: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
```

## Create: `backend/agents/freelance_evaluator.py`

### Key difference from job evaluator

The job evaluator asks: "Does this candidate meet the job's requirements (stack + seniority)?"

The freelance evaluator asks: "Has this candidate already SHIPPED something that proves they can do this gig?"

This means:
- **No seniority rules at all** — a fresher with a shipped project that matches perfectly should score 90+
- **Projects are weighted 3x more than bare skills** — having "Python" as a skill is fine, but having shipped a FastAPI project is what matters
- **Match points must cite specific projects** — not just "has Python experience" but "Built Vaani using FastAPI + LiveKit — directly matches the Voice API requirement"
- **Budget reality check** — if the gig budget is visible and absurdly low for the scope, note it in gaps

### The `_build_proof()` function

Reuse the same function from `evaluator.py` — just import it:
```python
from agents.evaluator import _build_proof
```

Or copy it if you prefer isolation.

### The scoring rubric

```python
system = f"""You are a freelance project evaluator scoring gig-candidate fit based on
PROOF OF WORK — what the candidate has actually shipped, not credentials.

CANDIDATE PROOF OF WORK:
{proof}

SCORING RUBRIC (proof-of-work weighted):
  90 – 100: Candidate has shipped a project using the EXACT primary stack the gig requires,
             with documented impact. They could start this gig today.
  76 – 89 : Strong stack overlap — candidate has projects demonstrating 80%+ of required skills.
             Minor gaps are learnable in days.
  61 – 75 : Good overlap — candidate has adjacent projects. Core language/framework matches
             but they'd need to learn a specific tool or domain.
  41 – 60 : Partial match — candidate has some relevant skills but no shipped project
             directly demonstrates the gig's requirements.
  21 – 40 : Weak match — different tech domain but transferable engineering skills.
  0  – 20 : No connection — completely different field.

SCORING RULES:
1. READ THE GIG DESCRIPTION CAREFULLY. Identify the primary deliverable and required stack.
2. For EACH required skill/technology in the gig, search the candidate's project list for
   evidence. A shipped project using that technology is worth 3x more than just listing it as a skill.
3. match_points MUST cite specific projects by name:
   BAD:  "Has Python experience"
   GOOD: "Built Waldo (RAG pipeline) using FastAPI + Qdrant — directly matches the RAG requirement"
4. If the candidate has a project that is essentially the same type of work as the gig
   (e.g. gig asks for "voice AI agent" and candidate built Vaani), score 85+.
5. gaps should list specific missing technologies or domain knowledge, not vague concerns.
6. reason must be 1-3 sentences explaining the score concisely, referencing specific projects."""
```

### Function signature

```python
def score(gig_description: str, candidate_data: dict) -> dict:
    # Returns: {"score": int, "reason": str, "match_points": list[str], "gaps": list[str]}
```

Use `step="evaluator"` for `call_llm` (reuses the evaluator's LLM config).

### Important
- The function signature and return shape MUST match the job evaluator exactly — both return `{score, reason, match_points, gaps}`. This keeps the pipeline uniform.
- Import `call_llm` from `llm`, import `_Score` model definition (or redefine it — same fields)
- Do NOT include any seniority rules or caps
```

---

## PHASE 5 — Backend API Endpoints + Scan Pipeline

```
I need you to add freelance-specific API endpoints and a parallel scan pipeline to my JustHireMe FastAPI backend.

## Context

### File: `backend/main.py`

The existing scan pipeline works like this:
1. `POST /api/v1/scan` → creates async task `_run_scan_task()`
2. `_run_scan()` does: query_gen → scout → evaluate each discovered lead
3. WebSocket broadcasts events at each step for real-time UI updates
4. `_scan_stop` event allows cancellation
5. Ghost mode (`_ghost_tick()`) runs the same pipeline every 6h via APScheduler

Key existing patterns:
- `_scan_task: asyncio.Task | None` — tracks the running scan
- `_scan_stop = asyncio.Event()` — cancellation flag
- `cm.broadcast(msg)` — WebSocket broadcast to all connected clients
- Settings read via `get_settings()` which returns a dict of all key-value pairs
- `get_setting("ghost_mode") == "true"` — checks individual settings

### Existing Pydantic models in main.py:
```python
class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

class StatusBody(StrictBody):
    status: LeadStatus  # Literal type
```

The `LeadStatus` type will need to be extended with freelance statuses.

## Changes needed

### 1. Extend the `LeadStatus` Literal type

Find where `LeadStatus` is defined (it's a Literal type). Add the freelance statuses:
```python
LeadStatus = Literal[
    "discovered", "evaluating", "tailoring", "approved",
    "applied", "interviewing", "rejected", "accepted", "discarded",
    # Freelance
    "matched", "bidding", "proposal_sent", "awarded", "completed",
]
```

### 2. Add freelance scan infrastructure

Add these module-level variables (near the existing `_scan_stop` and `_scan_task`):
```python
_fl_scan_stop = asyncio.Event()
_fl_scan_task: asyncio.Task | None = None
```

### 3. Add the freelance scan function

Create `_run_freelance_scan()` — mirrors `_run_scan()` but uses:
- `freelance_boards` setting instead of `job_boards`
- `freelance_query_gen.generate()` instead of `query_gen.generate()`
- `freelance_scout.run()` instead of `scout.run()`
- `freelance_evaluator.score()` instead of `evaluator.score()`
- `get_discovered_freelance_leads()` instead of `get_discovered_leads()`
- Event names prefixed with `freelance_`: `freelance_scout_start`, `freelance_scout_done`, `freelance_eval_start`, `freelance_eval_scored`, `freelance_eval_done`
- Broadcast type `FREELANCE_LEAD_UPDATED` instead of `LEAD_UPDATED`

```python
async def _run_freelance_scan():
    from db.client import get_settings, get_discovered_freelance_leads, update_lead_score, get_profile
    from agents.freelance_scout import run as _fl_scout
    from agents.freelance_evaluator import score as _fl_score
    from agents.freelance_query_gen import generate as _fl_gen_queries

    cfg     = get_settings()
    profile = get_profile()
    raw_urls = [u.strip() for u in cfg.get("freelance_boards", "").split(",") if u.strip()]

    if not raw_urls:
        await cm.broadcast({"type": "agent", "event": "freelance_eval_done", "msg": "No freelance boards configured."})
        return

    # Step 1: Query generation
    await cm.broadcast({"type": "agent", "event": "freelance_scout_start", "msg": "Generating freelance search queries…"})
    try:
        urls = await asyncio.to_thread(_fl_gen_queries, profile, raw_urls)
        await cm.broadcast({"type": "agent", "event": "freelance_query_done", "msg": f"Freelance search plan ready — {len(urls)} targets"})
    except Exception as exc:
        urls = raw_urls
        await cm.broadcast({"type": "agent", "event": "freelance_query_error", "msg": f"Query gen failed ({exc}), using raw URLs"})

    # Step 2: Scout
    await cm.broadcast({"type": "agent", "event": "freelance_scout_start", "msg": f"Scanning {len(urls)} freelance targets…"})
    leads = await asyncio.to_thread(_fl_scout, urls=urls)
    await cm.broadcast({"type": "agent", "event": "freelance_scout_done", "msg": f"Freelance scout — {len(leads)} new gigs found"})

    if _fl_scan_stop.is_set():
        await cm.broadcast({"type": "agent", "event": "freelance_eval_done", "msg": "Freelance scan stopped."})
        return

    # Step 3: Evaluate
    discovered = await asyncio.to_thread(get_discovered_freelance_leads)
    await cm.broadcast({"type": "agent", "event": "freelance_eval_start", "msg": f"Evaluating {len(discovered)} freelance gigs"})

    for lead in discovered:
        if _fl_scan_stop.is_set():
            await cm.broadcast({"type": "agent", "event": "freelance_eval_done", "msg": "Freelance scan stopped during evaluation."})
            return
        try:
            desc = (lead.get("description") or "").strip()
            budget = (lead.get("budget") or "").strip()
            gig_desc = (
                f"Gig Title: {lead.get('title','')}\n"
                f"Client: {lead.get('company','')}\n"
                f"URL: {lead.get('url','')}\n"
                + (f"Budget: {budget}\n" if budget else "")
                + (f"Description: {desc}" if desc else "")
            )
            result = await asyncio.to_thread(_fl_score, gig_desc, profile)
            await asyncio.to_thread(
                update_lead_score,
                lead["job_id"], result["score"], result["reason"],
                result.get("match_points", []), result.get("gaps", []),
            )
            await cm.broadcast({"type": "FREELANCE_LEAD_UPDATED", "data": {**lead, **result}})
            await cm.broadcast({"type": "agent", "event": "freelance_eval_scored", "msg": f"Scored {lead.get('title','')} = {result['score']}/100"})
        except Exception as e:
            await cm.broadcast({"type": "agent", "event": "freelance_eval_error", "msg": f"Eval failed for {lead.get('title','')}: {e}"})

    await cm.broadcast({"type": "agent", "event": "freelance_eval_done", "msg": "Freelance evaluation complete"})
```

### 4. Add the wrapper task (same pattern as job scan)

```python
async def _run_freelance_scan_task():
    global _fl_scan_task
    try:
        await _run_freelance_scan()
    except Exception as exc:
        print(f"[freelance-scan] failed: {exc}", file=sys.stderr)
        await cm.broadcast({"type": "agent", "event": "freelance_eval_done", "msg": f"Freelance scan failed: {exc}"})
    finally:
        _fl_scan_task = None
```

### 5. Add API endpoints

Add these AFTER the existing job scan endpoints:

```python
# ── Freelance endpoints ──────────────────────────────────────────────

@app.get("/api/v1/freelance")
async def get_freelance_leads():
    from db.client import get_all_freelance_leads
    return get_all_freelance_leads()


@app.post("/api/v1/freelance/scan")
async def freelance_scan():
    global _fl_scan_task
    if _fl_scan_task and not _fl_scan_task.done():
        raise HTTPException(status_code=409, detail="Freelance scan already running")
    _fl_scan_stop.clear()
    _fl_scan_task = asyncio.create_task(_run_freelance_scan_task())
    return {"status": "scanning"}


@app.post("/api/v1/freelance/scan/stop")
async def stop_freelance_scan():
    if not _fl_scan_task or _fl_scan_task.done():
        return {"status": "idle"}
    _fl_scan_stop.set()
    await cm.broadcast({"type": "agent", "event": "freelance_eval_done", "msg": "Freelance scan stopped by user."})
    return {"status": "stopping"}


@app.put("/api/v1/freelance/{job_id}/status")
async def update_freelance_status(job_id: str, body: StatusBody):
    from db.client import update_lead_status
    update_lead_status(job_id, body.status)
    return {"ok": True}


@app.delete("/api/v1/freelance/{job_id}")
async def delete_freelance_lead(job_id: str):
    from db.client import delete_lead
    delete_lead(job_id)
    return {"ok": True}
```

### 6. Update Ghost Mode

In the `_ghost_tick()` function, AFTER the existing job pipeline code, add a freelance section:

```python
    # ── Freelance Ghost scan ──────────────────────────────────────
    if get_setting("freelance_ghost_mode") == "true":
        fl_boards = [b.strip() for b in cfg.get("freelance_boards", "").split(",") if b.strip()]
        if fl_boards:
            await cm.broadcast({"type": "agent", "event": "ghost_freelance", "msg": "Ghost Mode: freelance scan starting"})
            try:
                from agents.freelance_scout import run as _fl_scout
                from agents.freelance_evaluator import score as _fl_score
                from agents.freelance_query_gen import generate as _fl_gen

                fl_urls = await asyncio.to_thread(_fl_gen, profile, fl_boards)
                fl_leads = await asyncio.to_thread(_fl_scout, urls=fl_urls)
                await cm.broadcast({"type": "agent", "event": "ghost_freelance", "msg": f"Ghost freelance scout — {len(fl_leads)} new gigs"})

                from db.client import get_discovered_freelance_leads
                fl_discovered = await asyncio.to_thread(get_discovered_freelance_leads)
                for lead in fl_discovered:
                    try:
                        desc = (lead.get("description") or "").strip()
                        budget = (lead.get("budget") or "").strip()
                        gig_desc = (
                            f"Gig Title: {lead.get('title','')}\n"
                            f"Client: {lead.get('company','')}\n"
                            + (f"Budget: {budget}\n" if budget else "")
                            + (f"Description: {desc}" if desc else "")
                        )
                        result = await asyncio.to_thread(_fl_score, gig_desc, profile)
                        await asyncio.to_thread(
                            update_lead_score,
                            lead["job_id"], result["score"], result["reason"],
                            result.get("match_points", []), result.get("gaps", []),
                        )
                        await cm.broadcast({"type": "FREELANCE_LEAD_UPDATED", "data": {**lead, **result}})
                    except Exception as exc:
                        await cm.broadcast({"type": "agent", "event": "ghost_error", "msg": f"FL eval failed: {exc}"})
            except Exception as exc:
                await cm.broadcast({"type": "agent", "event": "ghost_error", "msg": f"Freelance ghost scan failed: {exc}"})
```

### 7. Update scheduler setup

In the settings save endpoint (`save_cfg`), after the ghost mode scheduler check, add:
```python
    fl_ghost = payload.get("freelance_ghost_mode") == "true"
    if fl_ghost and not _sched.get_job("ghost_freelance"):
        _sched.add_job(_ghost_tick, "interval", hours=6, id="ghost_freelance")
```

Wait — actually the freelance ghost runs inside `_ghost_tick` already, so no separate job is needed. Just make sure the setting is checked inside `_ghost_tick`.

## Important
- Both scan pipelines (job + freelance) must be able to run independently and concurrently
- They have separate stop flags (`_scan_stop` vs `_fl_scan_stop`) and task refs
- All freelance events are prefixed with `freelance_` and use `FREELANCE_LEAD_UPDATED` type
- The freelance scan reuses the same LLM step configs as the job scan (scout, evaluator)
```

---

## PHASE 6 — Settings UI: Freelance Boards Configuration

```
I need you to update the Settings modal in my JustHireMe app to add freelance board configuration.

## File: `src/SettingsModal.tsx`

### 1. Update the `Cfg` interface

Add these fields:
```typescript
freelance_boards: string;
freelance_ghost_mode: string;
```

### 2. Update the `EMPTY` defaults

Add:
```typescript
freelance_boards: "",
freelance_ghost_mode: "false",
```

### 3. Add a "Freelance Discovery" section

In the JSX, after the existing "Scraping & Discovery" section (the one with `job_boards` textarea, Apify token, etc.), add a new section:

```tsx
{/* 3b. Freelance Discovery */}
<div style={{ borderTop: "1px dashed var(--line)", paddingTop: 18 }}>
  <SectionLabel label="Freelance Discovery" sub="platforms to scan for freelance gigs" />
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <LabelledField label="Target freelance platforms" hint="comma-separated URLs or site: queries">
      <textarea
        value={cfg.freelance_boards}
        onChange={set("freelance_boards")}
        rows={4}
        className="mono field-input"
        placeholder={`https://www.upwork.com/ab/feed/jobs/rss?q=python+ai+agent&sort=recency,\nsite:freelancer.com/projects,\nsite:contra.com/opportunities,\nhttps://arc.dev/remote-jobs`}
        style={{
          width: "100%", padding: "9px 12px", borderRadius: 9,
          border: "1px solid var(--line)", background: "var(--card)",
          fontSize: 12, resize: "vertical", lineHeight: 1.5,
        }}
      />
    </LabelledField>
  </div>
</div>
```

### 4. Add Freelance Ghost Mode toggle

In the "Automation" section (the one with Ghost Mode and Auto Apply toggles), add a new `BigToggle` AFTER the existing Ghost Mode toggle:

```tsx
<BigToggle
  active={cfg.freelance_ghost_mode === "true"}
  onToggle={() => onChange("freelance_ghost_mode", cfg.freelance_ghost_mode === "true" ? "false" : "true")}
  icon="brief"
  tone="green"
  label="Freelance Ghost"
  badge={cfg.freelance_ghost_mode === "true" ? "autonomous" : "manual"}
  sub="Scans freelance platforms every 6 hours alongside the job pipeline"
/>
```

### Important
- The `BigToggle` component already exists — just use it with the right props
- The `LabelledField` and `SectionLabel` components already exist
- The `set()` helper already handles onChange for text inputs
- The placeholder text should show realistic example URLs for freelance platforms
- Make sure `freelance_boards` and `freelance_ghost_mode` are included when saving (they will be automatically since the save function sends the entire `cfg` object)
```

---

## PHASE 7 — Frontend: Freelance Tab + UI

```
I need you to add a dedicated "Freelance" tab/view to my JustHireMe app's React frontend.

## File: `src/App.tsx`

This is a single-file React app. All views (Dashboard, Pipeline, Knowledge, Activity, Identity Graph, Add Context) are components in this file.

### Current architecture:
- `type View = "dashboard" | "pipeline" | "graph" | "activity" | "profile" | "ingestion"`
- `NAV` array defines sidebar items with `{id, label, icon, tone}`
- The main `App()` component renders the active view based on `view` state
- `useLeads(port)` hook fetches and manages lead state
- `PipelineView` component renders leads in tabs (Found, Evaluated, Generated, Active, Discarded)
- `JobCard` component renders individual lead cards
- WebSocket handler in `useWS()` processes `LEAD_UPDATED` events to live-update leads

### Changes needed:

**1. Extend the View type:**
```typescript
type View = "dashboard" | "pipeline" | "freelance" | "graph" | "activity" | "profile" | "ingestion";
```

**2. Add a FreelancePipelineTab type:**
```typescript
type FreelanceTab = "found" | "matched" | "bidding" | "awarded" | "discarded";
```

**3. Add to the NAV array** (insert after "pipeline"):
```typescript
{ id: "freelance", label: "Freelance", icon: "brief", tone: "green" },
```

**4. Create a `useFreelanceLeads` hook** (mirrors `useLeads`):
```typescript
function useFreelanceLeads(port: number | null) {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!port) return;
    const load = () => fetch(`http://127.0.0.1:${port}/api/v1/freelance`)
      .then(r => r.json())
      .then(setLeads)
      .catch(() => {});
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [port]);
  return { leads, setLeads };
}
```

**5. Handle `FREELANCE_LEAD_UPDATED` in the WebSocket handler.**

In the `useWS()` hook's `ws.onmessage`, there's already a handler for `LEAD_UPDATED`. Add a similar one for `FREELANCE_LEAD_UPDATED` that updates the freelance leads state. You'll need to expose a callback for this — the simplest approach is to have the App component listen for a custom event or pass a ref.

Actually, the cleanest approach: in the `App()` component where WebSocket messages are processed, add:
```typescript
if (d.type === "FREELANCE_LEAD_UPDATED" && d.data) {
  setFreelanceLeads(prev => prev.map(l => 
    l.job_id === d.data.job_id ? { ...l, ...d.data } : l
  ));
}
```

**6. Add freelance status colors to `getTone()`:**
```typescript
case "matched":       return "green";
case "bidding":       return "teal";
case "proposal_sent": return "purple";
case "awarded":       return "blue";
case "completed":     return "green";
```

**7. Create the `FreelanceView` component.**

This is similar to `PipelineView` but with freelance-specific tabs and a "Scan Gigs" button. Here's the structure:

```typescript
function FreelanceView({ leads, openDrawer, deleteLead, port }: {
  leads: Lead[]; openDrawer: (l: Lead) => void;
  deleteLead: (id: string) => void; port: number | null;
}) {
  const [tab, setTab] = useState<FreelanceTab>("found");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);

  const q = search.toLowerCase();
  const filter = (arr: Lead[]) =>
    q ? arr.filter(l =>
      l.title.toLowerCase().includes(q) ||
      l.company.toLowerCase().includes(q) ||
      (l.description || "").toLowerCase().includes(q)
    ) : arr;

  const tabs: { id: FreelanceTab; label: string; tone: string; leads: Lead[] }[] = [
    { id: "found",     label: "Found",     tone: "blue",   leads: filter(leads.filter(l => l.status === "discovered")) },
    { id: "matched",   label: "Matched",   tone: "green",  leads: filter([...leads.filter(l => l.status === "matched" || l.score > 0)].sort((a, b) => b.score - a.score)) },
    { id: "bidding",   label: "Bidding",   tone: "teal",   leads: filter(leads.filter(l => ["bidding", "proposal_sent"].includes(l.status))) },
    { id: "awarded",   label: "Awarded",   tone: "purple", leads: filter(leads.filter(l => ["awarded", "completed"].includes(l.status))) },
    { id: "discarded", label: "Discarded", tone: "red",    leads: filter(leads.filter(l => l.status === "discarded")) },
  ];

  const startScan = async () => {
    if (!port) return;
    setScanning(true);
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/freelance/scan`, { method: "POST" });
    } catch {}
  };

  const stopScan = async () => {
    if (!port) return;
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/freelance/scan/stop`, { method: "POST" });
    } finally { setScanning(false); }
  };

  // Listen for scan completion via websocket events
  // The scanning state should be cleared when freelance_eval_done event arrives
  // This can be handled by the parent component passing a prop or via the logs

  const activeTab = tabs.find(t => t.id === tab)!;

  return (
    <div className="col" style={{ flex: 1, height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* Header with scan button */}
      <div style={{
        padding: "14px 20px 0", borderBottom: "1px solid var(--line)",
        background: "var(--paper)", flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "7px 14px", borderRadius: "10px 10px 0 0", fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
                  border: "1px solid var(--line)", borderBottom: tab === t.id ? "1px solid var(--paper)" : "1px solid var(--line)",
                  background: tab === t.id ? "var(--paper)" : "var(--paper-3)",
                  color: tab === t.id ? `var(--${t.tone}-ink)` : "var(--ink-3)",
                  marginBottom: tab === t.id ? -1 : 0,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {t.label}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                  background: tab === t.id ? `var(--${t.tone})` : "var(--paper-3)",
                  color: tab === t.id ? `var(--${t.tone}-ink)` : "var(--ink-4)",
                }}>{t.leads.length}</span>
              </button>
            ))}
          </div>

          <div className="row gap-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search gigs…"
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)",
                background: "var(--paper-3)", fontSize: 12, color: "var(--ink)", width: 200,
              }}
            />
            <button
              onClick={scanning ? stopScan : startScan}
              className={scanning ? "btn" : "btn btn-accent"}
              style={{ padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}
            >
              <Icon name={scanning ? "x" : "search"} size={13} />
              {scanning ? "Stop" : "Scan Gigs"}
            </button>
          </div>
        </div>
      </div>

      {/* Grid of cards */}
      <div className="scroll" style={{ flex: 1, padding: 20, minHeight: 0 }}>
        {activeTab.leads.length === 0 ? (
          <div style={{
            padding: "64px 24px", textAlign: "center",
            border: "1px dashed var(--line)", borderRadius: 16,
            color: "var(--ink-4)", fontSize: 13,
          }}>
            {search ? `No results for "${search}"` : `No ${activeTab.label.toLowerCase()} gigs yet. Hit "Scan Gigs" to start.`}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: 14,
          }}>
            {activeTab.leads.map(lead => (
              <JobCard
                key={lead.job_id}
                lead={lead}
                onOpen={openDrawer}
                onDelete={deleteLead}
                showScore={tab === "matched" || tab === "bidding" || tab === "awarded"}
                showGenerate={false}
                port={port}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**8. Wire it up in the App component.**

In the main `App()` function:

a) Add the freelance leads hook:
```typescript
const { leads: freelanceLeads, setLeads: setFreelanceLeads } = useFreelanceLeads(port);
```

b) Add `FREELANCE_LEAD_UPDATED` handling in the WebSocket message handler (where `LEAD_UPDATED` is handled).

c) Add freelance lead counts for the sidebar badge:
```typescript
const freelanceCounts = { total: freelanceLeads.length };
```

d) Update the NAV item for freelance to show the count (same pattern as pipeline).

e) Render the FreelanceView when `view === "freelance"`:
```typescript
{view === "freelance" && <FreelanceView leads={freelanceLeads} openDrawer={setSel} deleteLead={deleteFreelanceLead} port={port} />}
```

f) Add a `deleteFreelanceLead` function:
```typescript
const deleteFreelanceLead = async (id: string) => {
  if (!port) return;
  await fetch(`http://127.0.0.1:${port}/api/v1/freelance/${id}`, { method: "DELETE" });
  setFreelanceLeads(prev => prev.filter(l => l.job_id !== id));
};
```

**9. Update the Dashboard to show freelance stats.**

In the `DashboardView` component, add a freelance summary card alongside the existing job pipeline stats. Show:
- Total freelance gigs found
- Matched count
- Bidding count
- Awarded count

**10. Handle scan completion.**

In the WebSocket message handler (the big switch in useWS or the App component), when receiving `freelance_eval_done` or `freelance_scout_done` events, trigger a re-fetch of freelance leads. The simplest way: have the App component watch for these events in the logs and call the fetch.

### Important notes
- Reuse the existing `JobCard` component — freelance leads have the same shape (title, company, score, etc). The "company" field becomes the client name for freelance gigs.
- The `Icon` component already has "brief" icon available
- Match the exact styling patterns used in `PipelineView` — same tab bar, same card grid, same empty state
- The `Lead` interface already works for freelance leads since both have the same fields
- Add `budget` to the `Lead` interface if you want to display it on the card
```

---

## BONUS: New Job Sources (Pluggable)

```
I need you to add dedicated scrapers for three new job sources to the existing scout in my JustHireMe app.

## File: `backend/agents/scout.py`

### 1. Hacker News "Who's Hiring" via Algolia API

Add a new scraper function:

```python
async def _scrape_hn_hiring() -> list:
    """Fetch the latest HN 'Who is hiring?' thread and extract job posts."""
    import httpx
    
    # Step 1: Find the latest "Who is hiring?" thread
    search_url = "https://hn.algolia.com/api/v1/search"
    params = {
        "query": "Ask HN: Who is hiring?",
        "tags": "story,ask_hn",
        "numericFilters": "created_at_i>" + str(int((datetime.now(timezone.utc) - timedelta(days=35)).timestamp())),
    }
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.get(search_url, params=params)
        stories = r.json().get("hits", [])
    
    if not stories:
        return []
    
    # Get the most recent one
    story = max(stories, key=lambda s: s.get("created_at_i", 0))
    story_id = story["objectID"]
    
    # Step 2: Fetch all comments (each comment is a job posting)
    items_url = f"https://hn.algolia.com/api/v1/items/{story_id}"
    async with httpx.AsyncClient(timeout=60) as cx:
        r = await cx.get(items_url)
        data = r.json()
    
    children = data.get("children", [])
    results = []
    
    for child in children:
        text = child.get("text", "")
        if not text or len(text) < 50:
            continue
        author = child.get("author", "")
        created = child.get("created_at", "")
        hn_url = f"https://news.ycombinator.com/item?id={child.get('id', '')}"
        
        # Extract company name from first line (HN convention: "Company Name | Role | Location | ...")
        first_line = text.split("<p>")[0].split("|")[0].strip()
        # Strip HTML
        import re
        company = re.sub(r"<[^>]+>", "", first_line).strip()[:100]
        
        results.append({
            "title": re.sub(r"<[^>]+>", "", text.split("<p>")[0]).strip()[:200],
            "company": company or author,
            "url": hn_url,
            "platform": "hn_hiring",
            "description": re.sub(r"<[^>]+>", " ", text).strip()[:500],
            "posted_date": created,
        })
    
    return results
```

**2. In the `run()` function**, add detection for HN hiring:

In the for-loop over `all_targets`, add a check before the existing conditions:

```python
if "news.ycombinator.com" in target or "hn-hiring" in target.lower() or "hackernews" in target.lower():
    processed_leads.extend(asyncio.run(_scrape_hn_hiring()))
```

The user can now add `hn-hiring` or `news.ycombinator.com` to their `job_boards` setting.

**3. Wellfound (AngelList) dedicated handling:**

Wellfound URLs should get a specific LLM prompt that's better at parsing their page structure. In the `run()` loop:

```python
elif "wellfound.com" in target or "angel.co" in target:
    md = asyncio.run(_crawl(target, headed=headed))
    leads_parsed = _parse_wellfound(md, target)
    processed_leads.extend(leads_parsed)
```

Add `_parse_wellfound()`:
```python
def _parse_wellfound(md: str, src: str) -> list:
    from llm import call_llm
    o = call_llm(
        "You are a job-lead extractor specializing in Wellfound (AngelList) startup job listings. "
        "Given scraped page markdown from Wellfound, return every distinct job posting. "
        "Wellfound shows startup jobs with: job title, company name, compensation range, "
        "equity range, location/remote status, and a role description. "
        "For each posting extract: title, company, url (direct link to the job), "
        "a 2-3 sentence description summarising the role and tech stack, "
        "and posted_date if visible. "
        "If no jobs found, return an empty list.",
        f"Source URL: {src}\n\n{md}",
        _Leads,
        step="scout",
    )
    results = []
    for lead in o.leads:
        d = lead.model_dump()
        if _is_recent(d.get("posted_date", "")):
            d["platform"] = "wellfound"
            results.append(d)
    return results
```

**4. GitHub / ReadMe Jobs:**

Add detection for GitHub-style job boards:
```python
elif "github.com" in target and "jobs" in target.lower():
    processed_leads.extend(scrape(target, headed=headed))
    # Tag them
    for lead in processed_leads[-10:]:  # tag the last batch
        if not lead.get("platform") or lead["platform"] == "scout":
            lead["platform"] = "github_jobs"
```

### Update the default `job_boards` placeholder

In the SettingsModal (Phase 6), the `job_boards` textarea placeholder should include examples of the new sources:
```
hn-hiring,
site:boards.greenhouse.io,
site:jobs.lever.co,
site:wellfound.com/jobs,
https://remoteok.com/api,
site:arc.dev/remote-jobs
```

### Important
- All new scrapers go in the existing `scout.py` file — no new file needed
- They all funnel through the same `save_lead()` and dedup via `url_exists()`
- The HN scraper doesn't need query gen — it scrapes the whole thread
- Make sure to handle `_is_recent()` filtering for all sources
```
