---
name: justhireme
description: Agent-neutral guidance for working on JustHireMe, a local-first AI job intelligence workbench for scraping, filtering, ranking, and tailoring job applications; useful for source adapters, scoring, profile ingestion, generated application materials, the FastAPI sidecar, Tauri/React UI, and MCP-based reuse.
metadata:
  short-description: Work on JustHireMe job intelligence
---

# JustHireMe

## What This Skill Is For

Use this skill in any AI coding assistant or agent environment when a task touches JustHireMe's job discovery, lead quality gate, deterministic/LLM fit ranking, candidate profile graph, generated application materials, FastAPI sidecar, or Tauri/React workbench.

The instructions are intentionally agent-neutral: follow the workflow with whatever shell, editor, test runner, MCP client, or repository tools are available in the current environment.

## Repository Map

- Frontend workbench: `src/`
- Tauri shell: `src-tauri/`
- Backend sidecar: `backend/main.py`
- Backend agents: `backend/agents/`
- Data access and local stores: `backend/db/`
- Tests: `backend/tests/` and `src/**/*.test.ts`
- Product/architecture docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/source-adapters.md`

## Default Workflow

1. Read the relevant existing agent, API route, component, or hook before changing behavior.
2. Keep local-first behavior intact: profile data, lead history, generated docs, graph data, vectors, and settings should remain local by default.
3. Prefer deterministic filtering/ranking logic for core scoring. Use LLM behavior only as an optional enhancement with clear fallback.
4. Preserve explainability: every filter, score, status change, and generated artifact should have visible reasons or events.
5. Treat browser automation and auto-apply as experimental. Avoid expanding it unless the user explicitly asks.
6. Validate with focused backend tests, frontend tests, build, or typecheck based on the files touched.
7. Do not commit local app data, vector stores, graph databases, generated PDFs, API keys, cookies, private resumes, or machine-specific caches.

## Important Backend Patterns

- `backend/agents/quality_gate.py` rejects stale, thin, spammy, senior-only, or low-context leads before CRM insertion.
- `backend/agents/scoring_engine.py` is the deterministic fit rubric. Keep changes quantified, capped, and evidence-backed.
- `backend/agents/evaluator.py` wraps the deterministic score and may call an LLM only when configured.
- `backend/agents/lead_intel.py` extracts lightweight signal, stack, budget, urgency, location, and company hints from raw text.
- API routes in `backend/main.py` require bearer auth except `/health`; preserve that guard.

## MCP Usage

This repo includes a lightweight stdio MCP server at `backend/mcp_server.py`.

Start command from the repo root on Windows:

```powershell
backend\.venv\Scripts\python.exe backend\mcp_server.py
```

Start command from the repo root on macOS/Linux:

```bash
backend/.venv/bin/python backend/mcp_server.py
```

Exposed tools:

- `score_job_fit`: scores a raw job posting against a candidate JSON profile.
- `evaluate_lead_quality`: runs the deterministic lead quality gate.
- `extract_lead_intel`: extracts company, location, budget, urgency, stack, and signal quality from raw lead text.

Prefer MCP tools for agent-to-agent reuse across Claude, Codex, custom MCP clients, IDE agents, or other assistants. Prefer direct backend functions when editing or testing inside this repo.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "justhireme": {
      "command": "/absolute/path/to/JustHireMe/backend/.venv/bin/python",
      "args": ["/absolute/path/to/JustHireMe/backend/mcp_server.py"],
      "cwd": "/absolute/path/to/JustHireMe"
    }
  }
}
```

On Windows, use `backend\\.venv\\Scripts\\python.exe` as the interpreter path.

## Frontend Notes

- The app is a workbench, not a landing page. Prefer dense, scannable operational UI.
- Keep controls predictable: filters, status changes, approvals, and generated assets should be easy to review.
- Match existing React/TypeScript component patterns in `src/components`, `src/hooks`, and `src/views`.
