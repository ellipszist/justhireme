Good — now I can see the exact shape of everything. The IngestionView has four tabs and talks to a clean profile CRUD API. LinkedIn and GitHub fit naturally as two new tabs. Here's the prompt:

---

```
You are adding LinkedIn data export ingestion and GitHub deep ingestion
to JustHireMe. Both add new tabs to the existing IngestionView and new
backend parsing agents. Read every file mentioned before writing.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXT — read these before writing anything
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read in full:
  src/views/IngestionView.tsx      (current tab structure, api() usage)
  backend/main.py                  (profile CRUD endpoints + ingest endpoint)
  backend/agents/ingestor.py       (existing ingest logic, LLM usage pattern)
  backend/llm.py                   (how to call the LLM from an agent)
  backend/db/client.py             (profile CRUD functions: add_skill,
                                    add_experience, add_project, get_profile, etc.)

After reading, you will know:
- The exact db.client function names for adding skills/experience/projects
- The exact Pydantic body shapes (SkillBody, ExperienceBody, ProjectBody)
- How llm.py resolves a model and calls it with instructor
- The tab pattern in IngestionView so you can add new tabs consistently

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART A — LinkedIn data export ingestion (backend)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Context: LinkedIn lets users download their full data as a ZIP file via
Settings → Data Privacy → Get a copy of your data. The ZIP contains
structured CSVs. This is the legal, reliable LinkedIn ingestion path —
no scraping, no API tokens, always up to date.

Step A1 — Create backend/agents/linkedin_parser.py

  The file parses a LinkedIn data export ZIP and returns a structured
  profile dict that maps cleanly to the existing Kùzu schema.

  LinkedIn ZIP CSV files and their relevant columns:
    Profile.csv      → First Name, Last Name, Headline, Summary, Geo Location
    Positions.csv    → Company Name, Title, Description, Location,
                       Started On, Finished On
    Education.csv    → School Name, Degree Name, Start Date, End Date, Notes
    Skills.csv       → Name
    Projects.csv     → Title, Description, Url, Started On, Finished On
    Certifications.csv → Name, Authority, Started On, Finished On

  from __future__ import annotations
  import csv, io, zipfile
  from logger import get_logger
  _log = get_logger(__name__)

  def _read_csv(zf: zipfile.ZipFile, name: str) -> list[dict]:
      """Find and parse a CSV by filename pattern (case-insensitive)."""
      candidates = [n for n in zf.namelist()
                    if n.lower().endswith(name.lower())]
      if not candidates:
          _log.warning("linkedin export: %s not found in ZIP", name)
          return []
      with zf.open(candidates[0]) as f:
          text = f.read().decode("utf-8-sig")   # handles BOM
      reader = csv.DictReader(io.StringIO(text))
      return [dict(r) for r in reader]

  def parse_linkedin_export(zip_bytes: bytes) -> dict:
      """
      Parse a LinkedIn data export ZIP.
      Returns:
        {
          "candidate": {"n": str, "s": str},   # name + headline/summary
          "skills": [{"n": str, "cat": str}],
          "experience": [{"role": str, "co": str, "period": str, "d": str}],
          "education": [{"title": str}],
          "projects": [{"title": str, "stack": str, "repo": str, "impact": str}],
          "certifications": [{"title": str}],
          "stats": {"skills": int, "experience": int, ...}
        }
      """
      with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
          # Profile
          profile_rows = _read_csv(zf, "Profile.csv")
          p = profile_rows[0] if profile_rows else {}
          first  = p.get("First Name", "").strip()
          last   = p.get("Last Name", "").strip()
          name   = f"{first} {last}".strip()
          headline = p.get("Headline", "").strip()
          summary  = p.get("Summary", "").strip()
          location = p.get("Geo Location", "").strip()
          # Build candidate summary: headline first, then summary
          candidate_summary = headline
          if summary and summary != headline:
              candidate_summary = f"{headline}\n\n{summary}" if headline else summary

          # Skills
          skill_rows = _read_csv(zf, "Skills.csv")
          skills = []
          for row in skill_rows:
              n = (row.get("Name") or "").strip()
              if n:
                  skills.append({"n": n, "cat": "general"})

          # Experience / Positions
          pos_rows = _read_csv(zf, "Positions.csv")
          experience = []
          for row in pos_rows:
              role   = (row.get("Title") or "").strip()
              co     = (row.get("Company Name") or "").strip()
              start  = (row.get("Started On") or "").strip()
              end    = (row.get("Finished On") or "Present").strip() or "Present"
              desc   = (row.get("Description") or "").strip()
              loc    = (row.get("Location") or "").strip()
              if role or co:
                  period = f"{start} – {end}" if start else end
                  d = desc
                  if loc:
                      d = f"{d}\n{loc}".strip() if d else loc
                  experience.append({"role": role, "co": co, "period": period, "d": d})

          # Education
          edu_rows = _read_csv(zf, "Education.csv")
          education = []
          for row in edu_rows:
              school = (row.get("School Name") or "").strip()
              degree = (row.get("Degree Name") or "").strip()
              notes  = (row.get("Notes") or "").strip()
              start  = (row.get("Start Date") or "").strip()
              end    = (row.get("End Date") or "").strip()
              if school:
                  parts = [p for p in [degree, school, notes] if p]
                  period = f"{start}–{end}" if start or end else ""
                  title  = " · ".join(parts)
                  if period:
                      title = f"{title} ({period})"
                  education.append({"title": title})

          # Projects
          proj_rows = _read_csv(zf, "Projects.csv")
          projects = []
          for row in proj_rows:
              title = (row.get("Title") or "").strip()
              desc  = (row.get("Description") or "").strip()
              url   = (row.get("Url") or "").strip()
              if title:
                  projects.append({
                      "title":  title,
                      "stack":  "",          # LinkedIn doesn't provide stack info
                      "repo":   url,
                      "impact": desc,
                  })

          # Certifications
          cert_rows = _read_csv(zf, "Certifications.csv")
          certifications = []
          for row in cert_rows:
              name_c    = (row.get("Name") or "").strip()
              authority = (row.get("Authority") or "").strip()
              if name_c:
                  title = f"{name_c} — {authority}" if authority else name_c
                  certifications.append({"title": title})

      return {
          "candidate":      {"n": name, "s": candidate_summary},
          "skills":         skills,
          "experience":     experience,
          "education":      education,
          "projects":       projects,
          "certifications": certifications,
          "location":       location,
          "stats": {
              "skills":         len(skills),
              "experience":     len(experience),
              "education":      len(education),
              "projects":       len(projects),
              "certifications": len(certifications),
          }
      }

Step A2 — Add POST /api/v1/ingest/linkedin in main.py

  from agents.linkedin_parser import parse_linkedin_export

  @app.post("/api/v1/ingest/linkedin")
  async def ingest_linkedin(file: UploadFile = File(...)):
      if not file.filename.endswith(".zip"):
          raise HTTPException(400, "expected a .zip file from LinkedIn data export")
      raw = await file.read()
      if len(raw) > 50 * 1024 * 1024:   # 50 MB guard
          raise HTTPException(413, "file too large")
      try:
          parsed = await asyncio.to_thread(parse_linkedin_export, raw)
      except Exception as exc:
          _log.error("linkedin parse failed: %s", exc)
          raise HTTPException(422, f"could not parse linkedin export: {exc}")

      # Write to Knowledge Brain using existing db functions.
      # Read db/client.py to find the exact function names.
      # Pattern: call add_* for each item; skip items that fail (don't abort all).
      errors = []
      from db.client import (
          save_candidate, add_skill, add_experience,
          add_education, add_project, add_certification,
      )
      # Candidate — always update
      try:
          c = parsed["candidate"]
          if c["n"]:
              await asyncio.to_thread(save_candidate, c["n"], c["s"])
      except Exception as e:
          errors.append(f"candidate: {e}")

      for skill in parsed["skills"]:
          try:
              await asyncio.to_thread(add_skill, skill["n"], skill["cat"])
          except Exception:
              pass   # duplicates are expected — skip silently

      for exp in parsed["experience"]:
          try:
              await asyncio.to_thread(add_experience,
                  exp["role"], exp["co"], exp["period"], exp["d"])
          except Exception as e:
              errors.append(f"exp {exp.get('role')}: {e}")

      for edu in parsed["education"]:
          try:
              await asyncio.to_thread(add_education, edu["title"])
          except Exception as e:
              errors.append(f"edu: {e}")

      for proj in parsed["projects"]:
          try:
              await asyncio.to_thread(add_project,
                  proj["title"], proj["stack"], proj["repo"], proj["impact"])
          except Exception as e:
              errors.append(f"proj {proj.get('title')}: {e}")

      for cert in parsed["certifications"]:
          try:
              await asyncio.to_thread(add_certification, cert["title"])
          except Exception as e:
              errors.append(f"cert: {e}")

      return {
          "status":  "ok" if not errors else "partial",
          "stats":   parsed["stats"],
          "location": parsed["location"],
          "errors":  errors,
      }

  IMPORTANT: After reading db/client.py, use the EXACT function names
  that exist. If any of the above (add_education, add_certification,
  save_candidate) don't exist, find the correct equivalent. Do not
  invent function names.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART B — GitHub deep ingestion (backend)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Context: The existing ingestor.py may do shallow GitHub ingestion.
This module goes deeper: it fetches the user's top repos by stars,
downloads each repo's README.md, and uses the LLM to extract structured
project data (description, stack, impact statement) before writing to
the graph.

Step B1 — Create backend/agents/github_ingestor.py

  Read llm.py in full before writing — copy the exact pattern for
  calling the LLM with instructor structured output.

  from __future__ import annotations
  import base64, re
  from typing import Optional
  from pydantic import BaseModel, Field
  from logger import get_logger
  _log = get_logger(__name__)

  GITHUB_API = "https://api.github.com"
  _HEADERS = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
  }

  class _RepoExtract(BaseModel):
      description: str  = Field(default="", description="1–2 sentence project summary")
      stack:       str  = Field(default="", description="comma-separated tech stack")
      impact:      str  = Field(default="", description="quantified outcome or key achievement, max 120 chars")
      is_relevant: bool = Field(default=True,  description="false if repo is a fork, tutorial, or boilerplate with no original work")

  def _gh_headers(token: str | None = None) -> dict:
      h = dict(_HEADERS)
      if token:
          h["Authorization"] = f"Bearer {token}"
      return h

  async def _fetch(url: str, token: str | None) -> dict | list | None:
      import httpx
      try:
          async with httpx.AsyncClient(timeout=10) as client:
              r = await client.get(url, headers=_gh_headers(token))
              if r.status_code == 404:
                  return None
              r.raise_for_status()
              return r.json()
      except Exception as exc:
          _log.warning("github fetch %s: %s", url, exc)
          return None

  def _decode_readme(readme_data: dict | None) -> str:
      if not readme_data:
          return ""
      content = readme_data.get("content", "")
      encoding = readme_data.get("encoding", "")
      if encoding == "base64":
          try:
              return base64.b64decode(content).decode("utf-8", errors="ignore")
          except Exception:
              return ""
      return content

  def _truncate(text: str, max_chars: int = 3000) -> str:
      return text[:max_chars] + "…" if len(text) > max_chars else text

  async def _extract_project(repo: dict, readme: str, llm_cfg: dict) -> _RepoExtract | None:
      """Use LLM to extract structured project info from a repo + README."""
      repo_desc = repo.get("description") or ""
      topics    = ", ".join(repo.get("topics") or [])
      lang      = repo.get("language") or ""

      prompt = f"""Extract structured information about this GitHub repository.

  Repository: {repo['full_name']}
  Description: {repo_desc}
  Primary language: {lang}
  Topics: {topics}
  Stars: {repo.get('stargazers_count', 0)}

  README (first 3000 chars):
  {_truncate(readme)}

  Return a JSON object with:
  - description: 1–2 sentence summary of what this project does
  - stack: comma-separated list of technologies/frameworks used
  - impact: the most impressive quantified outcome (e.g. "Reduced latency 40%", "500+ GitHub stars", "Used by 200 teams"). If none, describe the scope.
  - is_relevant: false only if this is clearly a fork, tutorial clone, or has no original work
  """
      from llm import _resolve, _client
      try:
          provider, api_key, model = _resolve("ingestor")
          if not api_key:
              return None
          client = _client(provider, api_key)
          result = client.chat.completions.create(
              model=model,
              response_model=_RepoExtract,
              messages=[{"role": "user", "content": prompt}],
              max_tokens=400,
          )
          return result
      except Exception as exc:
          _log.warning("github LLM extract failed for %s: %s", repo.get("name"), exc)
          return None

  async def ingest_github(username: str, token: str | None = None,
                          max_repos: int = 12) -> dict:
      """
      Fetch a GitHub user's top repos by stars, extract project data
      via LLM from each README, and return structured profile additions.

      Returns:
        {
          "github_user": { "login": str, "bio": str, "location": str, "blog": str },
          "projects":    [{ "title", "stack", "repo", "impact" }],
          "skills":      [{ "n": str, "cat": "github" }],   # from all stacks merged
          "stats":       { "repos_fetched": int, "projects_extracted": int },
          "errors":      [str],
        }
      """
      errors: list[str] = []

      # 1. Fetch user profile
      user = await _fetch(f"{GITHUB_API}/users/{username}", token)
      if not user:
          return {"error": f"GitHub user '{username}' not found"}

      github_user = {
          "login":    user.get("login", username),
          "bio":      user.get("bio") or "",
          "location": user.get("location") or "",
          "blog":     user.get("blog") or "",
          "avatar":   user.get("avatar_url") or "",
      }

      # 2. Fetch repos sorted by stars (top max_repos)
      repos_data = await _fetch(
          f"{GITHUB_API}/users/{username}/repos?sort=stars&per_page={max_repos}&type=owner",
          token,
      )
      if not repos_data or not isinstance(repos_data, list):
          return {**github_user, "projects": [], "skills": [],
                  "stats": {"repos_fetched": 0, "projects_extracted": 0}, "errors": errors}

      # Filter out forks unless they have significant stars
      repos = [r for r in repos_data if not r.get("fork") or r.get("stargazers_count", 0) >= 10]
      repos = repos[:max_repos]

      # 3. For each repo, fetch README and extract with LLM
      projects: list[dict] = []
      skill_names: set[str] = set()
      repos_fetched = len(repos)

      from db.client import get_settings
      cfg = get_settings()

      import asyncio
      async def _process_repo(repo: dict):
          name      = repo.get("name", "")
          full_name = repo.get("full_name", "")
          stars     = repo.get("stargazers_count", 0)
          url       = repo.get("html_url", "")
          lang      = repo.get("language") or ""

          readme_data = await _fetch(f"{GITHUB_API}/repos/{full_name}/readme", token)
          readme      = _decode_readme(readme_data)

          extract = await _extract_project(repo, readme, cfg)

          if extract and extract.is_relevant:
              # Fall back to repo description if LLM returned empty
              desc   = extract.description or repo.get("description") or name
              stack  = extract.stack or lang
              impact = extract.impact
              if stars >= 10 and f"{stars}" not in impact:
                  impact = f"{impact} · {stars} GitHub stars".strip(" ·")
              projects.append({
                  "title":  name,
                  "stack":  stack,
                  "repo":   url,
                  "impact": impact or desc,
              })
              for s in re.split(r"[,;/]", stack):
                  s = s.strip()
                  if s and len(s) < 40:
                      skill_names.add(s)
          elif not extract:
              # No LLM — use raw repo metadata as fallback
              if not repo.get("fork"):
                  desc = repo.get("description") or name
                  projects.append({
                      "title":  name,
                      "stack":  lang,
                      "repo":   url,
                      "impact": f"{desc} · {stars} stars" if stars else desc,
                  })
                  if lang:
                      skill_names.add(lang)

      await asyncio.gather(*[_process_repo(r) for r in repos])

      skills = [{"n": s, "cat": "github"} for s in sorted(skill_names)]

      return {
          "github_user":  github_user,
          "projects":     projects,
          "skills":       skills,
          "stats":        {"repos_fetched": repos_fetched,
                           "projects_extracted": len(projects)},
          "errors":       errors,
      }

Step B2 — Add POST /api/v1/ingest/github in main.py

  class GithubIngestBody(StrictBody):
      username: str  = Field(max_length=100)
      token:    str  = Field(default="", max_length=200)   # optional, for higher rate limits
      max_repos: int = Field(default=12, ge=1, le=30)

  @app.post("/api/v1/ingest/github")
  async def ingest_github_endpoint(body: GithubIngestBody):
      from agents.github_ingestor import ingest_github
      result = await ingest_github(
          body.username,
          token=body.token or None,
          max_repos=body.max_repos,
      )
      if "error" in result:
          raise HTTPException(404, result["error"])

      # Write projects and skills to graph using existing db functions
      from db.client import add_skill, add_project, save_setting
      errors = list(result.get("errors", []))

      for skill in result["skills"]:
          try:
              await asyncio.to_thread(add_skill, skill["n"], skill["cat"])
          except Exception:
              pass

      for proj in result["projects"]:
          try:
              await asyncio.to_thread(add_project,
                  proj["title"], proj["stack"], proj["repo"], proj["impact"])
          except Exception as e:
              errors.append(f"proj {proj.get('title')}: {e}")

      # Store github username in settings for display
      gu = result.get("github_user", {})
      if gu.get("login"):
          await asyncio.to_thread(save_setting, "github_username", gu["login"])
      if gu.get("blog"):
          await asyncio.to_thread(save_setting, "website_url", gu["blog"])

      return {
          "status":      "ok" if not errors else "partial",
          "github_user": result["github_user"],
          "stats":       result["stats"],
          "errors":      errors,
      }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART C — Frontend: two new tabs in IngestionView
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read src/views/IngestionView.tsx in full before writing.
Add two new tabs following the exact same pattern as existing tabs.

Step C1 — Add "LinkedIn Export" tab

  Add to TABS array:
    { id: "linkedin" as const, label: "LinkedIn Export" }

  Update the View type union to include "linkedin".

  Tab content for "linkedin":
    A drop zone / file input that accepts .zip files only.

    State: linkedinFile: File | null, linkedinResult: any | null

    Layout:
      ┌─────────────────────────────────────────────────┐
      │  Drop your LinkedIn data export (.zip) here     │
      │  or click to browse                             │
      │                                                 │
      │  How to get it: LinkedIn → Settings →           │
      │  Data Privacy → Get a copy of your data         │
      └─────────────────────────────────────────────────┘
      [Import LinkedIn data]  ← disabled until file selected

    On file select: set linkedinFile, show filename.
    On import click:
      - Build FormData with file appended as "file"
      - POST to /api/v1/ingest/linkedin
      - On success, show stats:
          "Imported: 12 skills · 4 jobs · 2 projects · 3 certifications"
      - On partial (status === "partial"), show stats + warning:
          "Some items could not be imported."
      - On error, show muted error message.

    The drop zone should support actual drag-and-drop:
      onDragOver: e.preventDefault()
      onDrop: extract e.dataTransfer.files[0], validate .zip, set state
    Style the drop zone with a dashed border matching the existing
    file upload style in the resume tab.

Step C2 — Add "GitHub" tab

  Add to TABS array:
    { id: "github" as const, label: "GitHub" }

  Update the View type union.

  State:
    githubUsername: string
    githubToken:    string     (optional, shown as password input)
    githubResult:   any | null
    showToken:      boolean    (toggle to show/hide the token input)

  Layout:
    ┌─────────────────────────────────────────────────┐
    │  GitHub username  [________________]            │
    │                                                 │
    │  [+ Add GitHub token for higher rate limits]   │
    │  (if showToken):                                │
    │    Token [________________] (type=password)     │
    │    "Optional — increases API rate limit from    │
    │     60 to 5,000 req/hr. Never stored remotely." │
    │                                                 │
    │  Max repos to scan: [12] (number input, 1–30)  │
    └─────────────────────────────────────────────────┘
    [Scan GitHub profile]

    On scan click:
      - POST to /api/v1/ingest/github with { username, token, max_repos }
      - Show loading: "Fetching repos and reading READMEs…"
        (this takes a few seconds — set a meaningful loading message)
      - On success show:
          GitHub user card:
            Avatar (img from github_user.avatar or initials fallback)
            @{login}  ·  {bio}
          Stats: "Found {repos_fetched} repos · Extracted {projects_extracted} projects"
          If errors.length > 0: muted warning "Some items skipped"
      - On 404: "GitHub user '{username}' not found"
      - On error: muted error message

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART D — Tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Read backend/tests/test_api.py for the existing stub and helper pattern.

Add class TestIngestionEndpoints(unittest.TestCase):

  test_linkedin_ingest_rejects_non_zip
    POST /api/v1/ingest/linkedin with a .txt file
    → status 400

  test_linkedin_ingest_rejects_invalid_zip
    POST /api/v1/ingest/linkedin with a .zip file containing garbage bytes
    → status 422

  test_linkedin_ingest_accepts_valid_zip
    Build a minimal in-memory ZIP containing:
      Profile.csv  with header + one row (First Name,Last Name,Headline,Summary,Geo Location)
      Skills.csv   with header + two rows (Name)
      Positions.csv with header + one row
    POST to /api/v1/ingest/linkedin
    → status 200, response has "stats" key with "skills" >= 2

    Build the zip with:
      import io, zipfile
      buf = io.BytesIO()
      with zipfile.ZipFile(buf, "w") as zf:
          zf.writestr("Profile.csv", "First Name,Last Name,Headline,Summary,Geo Location\nTest,User,Engineer,Summary,London")
          zf.writestr("Skills.csv", "Name\nPython\nTypeScript")
          zf.writestr("Positions.csv", "Company Name,Title,Description,Location,Started On,Finished On\nAcme,Engineer,Did things,London,Jan 2023,Present")
      zip_bytes = buf.getvalue()

  test_github_ingest_unknown_user
    POST /api/v1/ingest/github with json={"username": "this-user-does-not-exist-jhm-test"}
    This will hit the real GitHub API, which may be slow or rate-limited.
    Skip this test if no network, or mock _fetch to return None.
    Recommended: mock agents.github_ingestor._fetch to return None for the user endpoint.
    → status 404

  test_github_ingest_missing_username
    POST /api/v1/ingest/github with json={"username": ""}
    → status 422  (empty string fails Pydantic min-length if enforced,
                   or 404 from GitHub — assert status != 200)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERIFICATION CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ npm run typecheck                 → zero errors
□ npm run build                     → clean build
□ uv run python -m pytest tests/ -v → 96+ passed (92 + 4 new)
□ backend/agents/linkedin_parser.py exports parse_linkedin_export
□ backend/agents/github_ingestor.py exports ingest_github
□ POST /api/v1/ingest/linkedin      in main.py
□ POST /api/v1/ingest/github        in main.py
□ IngestionView has "LinkedIn Export" tab with drop zone
□ IngestionView has "GitHub" tab with username + token inputs
□ No existing tests deleted or modified
□ The linkedin_parser does NOT make any network calls (pure ZIP parsing)
□ The github_ingestor gracefully returns partial results if LLM is
  unavailable — it must never crash when llm.py returns an error
```

---

One thing to watch: **the `add_education` and `add_certification` function names in Part A** are the most likely to diverge from what actually exists in `db/client.py`. The prompt explicitly tells Claude Code to read the file first and use exact names — but double-check the endpoint response if you get import errors. The quick fix is always just grepping `db/client.py` for `def add_` to see the real names.

The GitHub tab's loading message ("Fetching repos and reading READMEs…") is worth keeping visible — with `max_repos=12` and an LLM call per repo, this realistically takes 15–30 seconds on a cold run. Users need to know the app is working.