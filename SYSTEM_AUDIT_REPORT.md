# JustHireMe — Full System Audit Report

**Date:** May 10, 2026  
**Scope:** Complete codebase audit — backend, frontend, tests, CI, build, and modularization progress  
**Purpose:** Identify all existing issues, dead code, coupling problems, and risks before continuing production-readiness work

---

## Executive Summary

The modularization is **significantly underway** — far more than the previous roadmap assumed. The target architecture from `MODULARIZATION_ROADMAP.md` has been largely implemented:

| Roadmap Phase | Status | Notes |
|---|---|---|
| Phase 0 — `core/` kernel | ✅ Complete | types.py, errors.py, config.py, events.py, logging.py, taxonomy.py, telemetry.py all exist |
| Phase 1 — `data/` layer | ✅ Complete | sqlite/{connection,leads,settings,events}.py + migrations/, graph/{connection,profile}.py, vector/{connection,embeddings}.py, repository.py, feedback.py |
| Phase 2 — `profile/` domain | ✅ Complete | service.py + ingestor.py, linkedin_parser.py, github_ingestor.py, portfolio_ingestor.py |
| Phase 3 — `discovery/` domain | ✅ Complete | service.py + sources/{apify,hackernews,rss,github_jobs,x_twitter,custom,ats,reddit,web,common}.py + quality_gate.py, normalizer.py, query_gen.py, targets.py |
| Phase 4 — `ranking/` domain | ✅ Complete | service.py + scoring_engine.py + criteria/{role_alignment,stack_coverage,evidence,seniority_fit,logistics,learning_curve,registry}.py + evaluator.py, semantic.py, feedback_ranker.py, taxonomy.py |
| Phase 5 — `generation/` domain | ✅ Complete | service.py + generators/{resume,cover_letter,outreach_email,linkedin_message,founder_message,keywords,drafting,package}.py + pdf_renderer.py, contact_lookup.py |
| Phase 6 — `api/` layer | ✅ Complete | app.py + auth.py + websocket.py + scheduler.py + dependencies.py + startup_validation.py + routers/{leads,profile,discovery,generation,ingestion,settings,events,automation,health,misc}.py |
| Phase 7 — Frontend | ✅ Complete | features/{dashboard,pipeline,inbox,apply,profile,graph,activity,settings}/ + shared/{hooks,components,context,lib}/ + api/{client,types,leads,profile,discovery,generation,settings}.ts |
| Phase 8 — Build/Test/CI | ✅ Complete | Per-domain CI matrix, import boundary tests, pytest markers |
| Phase 9 — Operational | ⚠️ Partial | telemetry.py + startup_validation.py exist, but issues remain |

**Bottom line:** The structural refactor is done. The remaining problems are runtime bugs, incomplete migrations, dead code, and coupling that survived the restructure.

---

## Part 1: What's Working Well

### 1.1 — Architecture is Clean

- `main.py` is now **55 lines** (down from ~1,900). It's a thin entry point that wires together the app factory.
- `db/client.py` is now **387 lines** — a facade that delegates to the new `data/` sub-modules. Previously ~1,300 lines.
- Import boundary enforcement via `tests/test_import_boundaries.py` with explicit allowed imports per domain.
- CI runs import boundary checks first, domain tests second, in a matrix.

### 1.2 — Domain Services Exist with DI

- `api/dependencies.py` uses `@lru_cache` to create singleton services via factory functions.
- Each service (`RankingService`, `DiscoveryService`, `GenerationService`, `ProfileService`, `AutomationService`) has a clean public API.
- Services use `asyncio.to_thread()` to run CPU-bound work without blocking the event loop.

### 1.3 — Scoring is Properly Decomposed

- 6 individual criterion files in `ranking/criteria/` with a `registry.py` for composition.
- `ScoringEngine` orchestrates criteria and applies hard caps.
- The old 41 KB monolith is now 24 KB (scoring_engine.py) + ~6 individual criterion files.

### 1.4 — Frontend is Feature-Structured

- Proper feature folders with co-located components.
- Typed API client layer in `src/api/`.
- Discriminated union for WebSocket messages (`WSMessage` type).
- Extracted `AppContext` for state management.

### 1.5 — CI/CD is Comprehensive

- Dependency audit (npm, pip-audit, cargo-audit).
- Frontend: typecheck + test + build.
- Backend: import boundary test + full pytest.
- Per-domain matrix tests.
- Multi-platform release workflow (Windows, Linux, macOS) with signed updates.

---

## Part 2: Issues Found

### CRITICAL — Must Fix Before Next Release

#### C1. `agents/` Directory Contains Live Code Alongside Shims

**What:** The `agents/` directory has a mix of:
- **Shims** (redirect to new modules): `evaluator.py` (5 lines → `ranking.evaluator`), `scoring_engine.py` (5 lines), `ingestor.py` (2 lines), `quality_gate.py` (1 line), etc.
- **Live code that hasn't been migrated**: `scout.py` (590 lines), `free_scout.py` (419 lines), `x_scout.py` (471 lines), `actuator.py` (454 lines), `help_agent.py` (466 lines), `browser_runtime.py` (131 lines), `selectors.py` (84 lines).

**Impact:** The scouting and automation code lives in BOTH `agents/` and `automation/`. The `agents/scout.py` imports from `discovery.quality_gate` and `discovery.sources.*` — it's partially migrated but the file itself hasn't moved. This creates confusion about which version is canonical.

**Evidence:**
```
agents/scout.py (590 lines) — imports from discovery.sources.*, db.client
automation/scout.py (same content, 21KB) — appears to be a copy
automation/free_scout.py (same content, 16KB) — appears to be a copy
automation/x_scout.py (same content, 17KB) — appears to be a copy
```

**Risk:** Bug fixes applied to one location won't be reflected in the other. Contributors won't know which file to edit.

---

#### C2. `db/client.py` is Still the Universal Import Target

**What:** Even though the data layer has been properly decomposed into `data/sqlite/`, `data/graph/`, `data/vector/`, the `db/client.py` file (387 lines) acts as a compatibility facade that re-exports everything:

```python
from data.graph import connection as graph_connection
from data.sqlite import leads as sqlite_leads
conn = graph_connection.conn  # global mutable
vec = vector_connection.vec    # global mutable
```

**Impact:** Any code that imports `from db.client import save_lead` still works, which means:
1. The old import paths are never broken (good for migration)
2. But they're also never cleaned up (bad for long-term)
3. The global `conn` and `vec` objects are re-exported as module-level singletons

**Risk:** The facade masks the real dependency structure. When `test_import_boundaries.py` checks imports, it sees `db` as an allowed import everywhere, hiding coupling.

---

#### C3. Race Condition in Scan/Reevaluate Task Management

**What:** In `api/routers/discovery.py`, global variables `SCAN_TASK` and `REEVALUATE_TASK` are modified without synchronization:

```python
SCAN_TASK: asyncio.Task | None = None
REEVALUATE_TASK: asyncio.Task | None = None
SCAN_STOP = asyncio.Event()
REEVALUATE_STOP = asyncio.Event()
```

**Impact:** Two concurrent POST requests to `/api/v1/scan` could both pass the `if SCAN_TASK and not SCAN_TASK.done()` check and create duplicate scan tasks.

**Risk:** Resource exhaustion, duplicate leads, undefined behavior. With 200+ users, concurrent requests are realistic if multiple UI tabs are open.

---

#### C4. Thread Safety of Kuzu Graph Connection

**What:** `data/graph/connection.py` creates a single `kuzu.Connection(db)` at module load time. This connection is used from `asyncio.to_thread()` calls across multiple services.

**Impact:** Kuzu's Python binding may not be thread-safe for concurrent reads/writes. If `ProfileService.ingest_resume()` writes to the graph while `RankingService.evaluate_lead()` reads from it via `asyncio.to_thread()`, the results are undefined.

**Risk:** Graph corruption, intermittent crashes that are nearly impossible to reproduce.

---

### HIGH — Should Fix Soon

#### H1. `help_agent.py` Still in `agents/` — Not Migrated

**What:** `agents/help_agent.py` (466 lines) is still a full implementation file that hasn't been moved to a new domain module. There's no `help/` directory in the new structure. The `api/routers/` likely still imports from `agents.help_agent`.

**Impact:** This is the help chat feature. If it breaks, users lose in-app assistance.

---

#### H2. `automation/` Module Has Mixed Concerns

**What:** The `automation/` module contains:
- `actuator.py` — browser automation for auto-apply
- `browser_runtime.py` — Playwright wrapper
- `selectors.py` — CSS selectors for forms
- **`scout.py`** (21 KB) — job board scraping
- **`free_scout.py`** (16 KB) — free source scraping
- **`x_scout.py`** (17 KB) — Twitter scraping
- `source_adapters.py` — adapter layer
- `service.py` — automation service

**Problem:** The scouts belong in `discovery/`, not `automation/`. "Automation" should be about browser automation (applying to jobs), not about discovering jobs. This is a domain boundary violation.

---

#### H3. No EventBus Usage Despite Implementation

**What:** `core/events.py` defines a proper `InProcessEventBus` with pub/sub. But `api/websocket.py` still uses the old `ConnectionManager.broadcast()` pattern directly. Domain services don't publish events — the routers manually call `cm.broadcast()` after every operation.

**Impact:** The EventBus was part of the decoupling plan but hasn't been wired in. Cross-domain communication still goes through the API layer manually broadcasting.

---

#### H4. WebSocket Connection Manager Has No Backpressure

**What:** `api/websocket.py` broadcasts to all connected clients sequentially. If one client is slow, it blocks broadcasts to all others. Dead connections are cleaned up reactively (on send failure).

**Impact:** A single slow/broken WebSocket client could delay events for all other clients.

---

#### H5. SQLite Connection Not Pooled

**What:** `data/sqlite/connection.py` creates individual connections per operation. There's no connection pool or WAL mode explicitly set.

**Impact:** Under concurrent load (ghost mode scan + user interaction + reevaluation), SQLite could return "database is locked" errors.

---

#### H6. Frontend: No AbortController on Long-Running API Calls

**What:** API calls in `ApprovalDrawer`, `ApplyJobView`, and `OnboardingWizard` don't use `AbortController`. Closing a component mid-request causes React state-update-on-unmounted-component warnings.

**Impact:** Memory leaks, console warnings, potential UI glitches if responses arrive after navigation.

---

#### H7. Frontend: WebSocket Reconnection Without Backoff

**What:** `src/shared/hooks/useWS.ts` reconnects on a fixed 3-second timer. No exponential backoff, no jitter, no max-retry limit.

**Impact:** If the backend is down for maintenance, the frontend will hammer it with connection attempts every 3 seconds from every connected user.

---

#### H8. Frontend: Race Between HTTP Fetch and WebSocket Updates in useLeads

**What:** `useLeads.ts` polls leads every 5 seconds via HTTP AND receives real-time updates via WebSocket. No version/timestamp coordination between the two.

**Impact:** A WebSocket update can be overwritten by a stale HTTP response that started before the update arrived. The user sees leads "revert" momentarily.

---

### MEDIUM — Should Address

#### M1. Scoring Engine Silent Fallback on Semantic Failure

**What:** If vector store is unavailable, `scoring_engine.py` silently returns `None` for the semantic criterion. This means the same lead can score differently depending on whether LanceDB is healthy.

**Impact:** Non-deterministic scoring. A user re-running evaluation might see different scores if vector store was temporarily unavailable during one run.

---

#### M2. `ManualLeadBody.text` Has 20,000 Character Limit But No Rate Limiting

**What:** Users can POST up to 20 KB of text to `/api/v1/leads/manual`. This text gets processed by LLM (via `lead_intel.manual_lead_from_text`). No rate limiting exists.

**Impact:** A user (or automated tool) could spam manual lead creation, exhausting LLM API credits.

---

#### M3. Orphaned Temp Files from Resume Ingestion

**What:** `api/routers/ingestion.py` creates `tempfile.NamedTemporaryFile(delete=False)` for uploaded PDFs. If the process crashes between creation and the `finally` cleanup, files remain forever.

**Impact:** Disk space leak over time on user machines.

---

#### M4. Ghost Mode Broadcasts Excessive Events

**What:** `api/scheduler.py` ghost_tick broadcasts one event per lead for scout, eval, and gen phases. With 1000 leads, that's 3000+ messages in one cycle.

**Impact:** WebSocket bandwidth, UI lag, event log bloat.

---

#### M5. Migration System Has No Locking

**What:** `data/sqlite/connection.py` runs migrations without acquiring an exclusive lock. Two processes starting simultaneously could both try to apply the same migration.

**Impact:** Duplicate column errors, schema corruption (rare but possible).

---

#### M6. Frontend Only Has 1 Test File

**What:** `src/shared/lib/leadUtils.test.ts` is the only frontend test. No component tests, no hook tests, no integration tests.

**Impact:** Frontend regressions won't be caught automatically. The `npm test` CI step passes trivially.

---

#### M7. Path Traversal Risk in PDF Endpoint

**What:** `/api/v1/leads/{job_id}/pdf` constructs file paths from `job_id`. While the base directory is fixed, a crafted `job_id` with `../` could potentially escape.

**Impact:** Information disclosure if exploited (low probability since the app is local-only, but still a code quality issue).

---

#### M8. `core/types.py` TypedDicts Are Incomplete

**What:** `Lead` TypedDict only defines ~10 fields with `total=False`. The actual lead dict from SQLite has 39+ columns. Code still uses untyped `dict` access patterns everywhere.

**Impact:** TypeScript-level type safety exists in the frontend but Python-level safety is incomplete. Type checker can't catch key typos.

---

### LOW — Technical Debt

#### L1. Old `agents/` Directory Should Be Removed

**What:** 8 files in `agents/` are shims (redirect imports). 7 files are live code that's duplicated in `automation/`. The directory adds confusion.

**Action needed:** Move remaining live code, convert all to shims or delete.

---

#### L2. `db/client.py` Facade Should Be Deprecated

**What:** The 387-line facade will continue to be the path of least resistance for new code. Without deprecation warnings, it will accumulate new logic.

**Action needed:** Add deprecation comments, update import boundary test to flag new usages.

---

#### L3. No Structured Logging

**What:** All logging uses `_log.info(f"...")` without structured fields. No request IDs, no durations, no domain tags.

**Impact:** Debugging production issues requires manual log reading. No ability to filter/search by request or domain.

---

#### L4. `test_regressions.py` Still Exists as Monolith

**What:** The 50 KB regression test file still exists alongside the newer per-domain regression tests (`test_regression_api_profile.py`, `test_regression_discovery_sources.py`, etc.).

**Impact:** Duplication between old and new test files. Unclear which is authoritative.

---

#### L5. Frontend Inconsistent Error Messages

**What:** Error messages vary: "Backend unreachable", "Server returned 500", "Lead load failed (404)". No standardized error format or user-facing message system.

---

#### L6. No Pagination on Lead List API

**What:** `GET /api/v1/leads` returns ALL leads in one response. With 10,000+ leads, response size could be several MB.

---

#### L7. `discovery/targets.py` is Only 883 Bytes

**What:** Most target configuration logic is still in `core/config.py` (6.9 KB). The `discovery/targets.py` file appears to be just re-exports or a thin wrapper.

**Impact:** The target logic hasn't fully moved to its domain yet.

---

## Part 3: Dead Code Inventory

| File | Lines | Status | Action |
|---|---|---|---|
| `agents/evaluator.py` | 5 | Shim → `ranking.evaluator` | Delete after confirming no external imports |
| `agents/scoring_engine.py` | 5 | Shim → `ranking.scoring_engine` | Delete |
| `agents/ingestor.py` | 2 | Shim → `profile.ingestor` | Delete |
| `agents/linkedin_parser.py` | 2 | Shim → `profile.linkedin_parser` | Delete |
| `agents/github_ingestor.py` | 2 | Shim → `profile.github_ingestor` | Delete |
| `agents/portfolio_ingestor.py` | 2 | Shim → `profile.portfolio_ingestor` | Delete |
| `agents/lead_intel.py` | 2 | Shim → `discovery.lead_intel` | Delete |
| `agents/quality_gate.py` | 1 | Shim → `discovery.quality_gate` | Delete |
| `agents/feedback_ranker.py` | 5 | Shim → `ranking.feedback_ranker` | Delete |
| `agents/semantic.py` | 5 | Shim → `ranking.semantic` | Delete |
| `agents/contact_lookup.py` | 5 | Shim → `generation.contact_lookup` | Delete |
| `agents/generator.py` | 5 | Shim → `generation.generator` | Delete |
| `agents/query_gen.py` | 1 | Shim → `discovery.query_gen` | Delete |
| `agents/scout.py` | 590 | **LIVE** — duplicated in `automation/scout.py` | Decide canonical location, delete other |
| `agents/free_scout.py` | 419 | **LIVE** — duplicated in `automation/free_scout.py` | Same as above |
| `agents/x_scout.py` | 471 | **LIVE** — duplicated in `automation/x_scout.py` | Same as above |
| `agents/actuator.py` | 454 | **LIVE** — duplicated in `automation/actuator.py` | Same as above |
| `agents/help_agent.py` | 466 | **LIVE** — no new home yet | Create `help/` module |
| `agents/browser_runtime.py` | 131 | **LIVE** — duplicated in `automation/browser_runtime.py` | Same as above |
| `agents/selectors.py` | 84 | **LIVE** — duplicated in `automation/selectors.py` | Same as above |
| `tests/test_regressions.py` | ~1,500 | Partially superseded by per-domain regression tests | Audit for unique tests, migrate, delete |

**Total dead/duplicate code:** ~3,150 lines that can be removed.

---

## Part 4: Test Coverage Assessment

### Backend Tests (22 test files)

| Test File | Domain | Purpose |
|---|---|---|
| `test_api.py` | api | Route integration tests with fakes |
| `test_automation_service.py` | automation | Service layer tests |
| `test_data_feedback.py` | data | Feedback scoring tests |
| `test_discovery_service.py` | discovery | Service layer tests |
| `test_discovery_sources.py` | discovery | Individual source tests |
| `test_generation_generators.py` | generation | Generator unit tests |
| `test_generation_service.py` | generation | Service layer tests |
| `test_graph.py` | data/graph | Graph operations tests |
| `test_import_boundaries.py` | meta | Cross-domain import enforcement |
| `test_mcp_server.py` | mcp | MCP interface tests |
| `test_profile_service.py` | profile | Service layer tests |
| `test_ranking_criteria.py` | ranking | Individual criteria tests |
| `test_ranking_evaluator.py` | ranking | Evaluator integration tests |
| `test_ranking_service.py` | ranking | Service layer tests |
| `test_regression_api_profile.py` | regression | API + profile regression |
| `test_regression_discovery_sources.py` | regression | Discovery regression |
| `test_regression_feedback_automation.py` | regression | Feedback regression |
| `test_regression_generation_pdf.py` | regression | PDF generation regression |
| `test_regression_llm_help.py` | regression | LLM + help regression |
| `test_regression_ranking_semantic.py` | regression | Ranking + semantic regression |
| `test_regression_targets_quality.py` | regression | Targets + quality gate regression |
| `test_regressions.py` | legacy | Old monolithic regression file |
| `test_ingestion.py` | profile (root) | Ad-hoc ingestion tests |
| `test_live_fire.py` | automation (root) | End-to-end tests |

### Frontend Tests (1 test file)

| Test File | Coverage |
|---|---|
| `src/shared/lib/leadUtils.test.ts` | Lead filtering/sorting utilities only |

### Coverage Gaps

1. **No frontend component tests** — React components, hooks, and views are untested
2. **No WebSocket integration tests** — The real-time event flow is untested
3. **No E2E browser tests** — User workflows aren't tested end-to-end
4. **No load/stress tests** — Unknown behavior under 10,000+ leads
5. **No concurrent operation tests** — Scan + reevaluate + user action simultaneously

---

## Part 5: Build & CI Assessment

### What's Good

- CI runs on every push and PR
- Multi-job matrix for backend domains
- Dependency auditing (npm, pip, cargo)
- Multi-platform release automation with signing
- Auto-updater support built in

### Issues

1. **No test run timing** — Can't tell which tests are slow
2. **No coverage reporting** — No codecov or similar integration
3. **Frontend tests are trivial** — `npm test` passes with 1 test file
4. **No lint/format enforcement** — No ruff, black, or eslint in CI
5. **Build time unknown** — The sidecar build (PyInstaller) duration isn't tracked

---

## Part 6: Recommended Priority Actions

### Immediate (before next release)

1. **Resolve agents/ vs automation/ duplication** — Pick one canonical location for scout.py, free_scout.py, x_scout.py, actuator.py. Delete the other. Update all imports.
2. **Add asyncio.Lock to scan/reevaluate task management** — Prevent race conditions.
3. **Set SQLite WAL mode** in `data/sqlite/connection.py` — Prevents "database is locked" under concurrent access.
4. **Add AbortController to frontend API calls** — Prevent state-update-on-unmounted-component.

### Short-term (next 1-2 weeks)

5. **Delete all shim files in agents/** — They've served their migration purpose.
6. **Deprecate db/client.py** — Add a deprecation log warning when imported. Update tests to import from new paths.
7. **Wire up EventBus** — Replace direct `cm.broadcast()` calls in routers with event publishing from domain services.
8. **Add exponential backoff to WebSocket reconnection** — With jitter and max-retry.
9. **Create `help/` domain module** — Move `help_agent.py` out of `agents/`.
10. **Add 5-10 frontend component tests** — At minimum: useWS, useLeads, PipelineView.

### Medium-term (next month)

11. **Complete Lead TypedDict** — Add all 39 columns so type checker catches key errors.
12. **Add structured logging** — Request IDs, durations, domain tags.
13. **Add API pagination** — `GET /api/v1/leads?page=1&limit=50`.
14. **Move scouts from automation/ to discovery/** — Fix the domain boundary violation.
15. **Add rate limiting** — Prevent LLM credit exhaustion from manual lead spam.
16. **Add connection pooling or WAL journal mode to SQLite** — Production hardening.

---

## Part 7: Architecture Diagram — Current State

```
┌────���────────���───────────────────────────────────────────────────┐
│                         main.py (55 lines)                       │
│                    Entry point + app wiring                       │
└──────��───────────────────────┬──────────���───────────────────────┘
                               │
┌───��──────────────────────────▼────────────���─────────────────────┐
│                    api/ (app.py + routers/)                       │
│  leads | profile | discovery | generation | ingestion            │
│  settings | events | automation | health | misc                   │
│  + auth.py | websocket.py | scheduler.py | dependencies.py       │
└───────┬────────────┬─────────────┬─────────��───┬────────────────┘
        │            │             │             │
   ┌────▼────┐  ┌────▼─────┐  ┌───▼────┐  ┌────▼───────┐
   │ profile │  │ discovery │  │ranking │  │ generation │
   │ service │  │  service  │  │service ���  │  service   │
   └────┬────┘  └────┬──┬──┘  └───┬────┘  └────┬��──────┘
        │            │  │         │             │
        │            │  │    ┌─��──▼────────┐    │
        │            │  └───►│ automation/ │◄───┘
        │            │       │scout,x,free │
        │            │       └─────────────┘
        │            │              │
   ┌────▼────────────▼──────────────▼─────────────────────────────┐
   │                    db/client.py (facade)                       │
   │              ┌─────────┬──────────┬──────────┐                │
   │              │         │          │          │                │
   │        data/sqlite  data/graph  data/vector  data/feedback    │
   │        {leads,      {profile,   {embeddings, {ranker}        │
   │         settings,    connection}  connection}                  │
   │         events,                                               │
   │         connection,                                           │
   │         migrations/}                                          │
   └───���──────────────────────────────────��────────────────────────┘
                               │
   ┌───────────────────────────▼──────���────────────────────────���───┐
   │          core/ (types, errors, config, events, taxonomy)       │
   │          llm/ (client + providers/{anthropic,groq,ollama,...}) │
   └────────────────────��─────────────────────────────���────────────┘

   ┌──────────────────────────────────────���────────────────────────┐
   │  ⚠️  DEAD ZONE: agents/ (shims + duplicated live code)         │
   │  Still importable. Should be deleted/migrated.                │
   └─────────────────���─────────────────────��───────────────────────┘
```

---

## Conclusion

The codebase is in a **strong transitional state**. The hard architectural work is done — modules are separated, services have clean APIs, CI enforces boundaries, and the frontend has been restructured. What remains is cleanup work:

1. **Eliminate the duplication** between `agents/` and `automation/` (biggest risk)
2. **Harden concurrency** (scan race conditions, SQLite locking, graph thread safety)
3. **Wire up the EventBus** to complete the decoupling story
4. **Add missing tests** (frontend is nearly untested, concurrency untested)
5. **Deprecate and remove the db/client.py facade** to enforce the new architecture

The "fix one thing, break another" cycle should already be dramatically reduced thanks to the module boundaries. The remaining coupling (db/client.py facade, automation/ containing scouts) is the last source of cross-domain entanglement.
