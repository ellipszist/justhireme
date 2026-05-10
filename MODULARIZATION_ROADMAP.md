# JustHireMe — Modularization & Microservices Roadmap

**Author:** Claude (drafted for Vasu)  
**Date:** May 9, 2026  
**Status:** Planning — no code changes yet  
**Goal:** Break the monolithic codebase into cleanly isolated modules with internal microservice boundaries so that (a) changing one part never breaks another, (b) builds are fast and incremental, and (c) new contributors can work on a single module without understanding the entire system.

---

## Table of Contents

1. [Current State — What Hurts and Why](#1-current-state)
2. [Target Architecture — The Module Map](#2-target-architecture)
3. [Phase 0 — Foundation (do first, everything depends on it)](#3-phase-0)
4. [Phase 1 — Extract the Data Layer](#4-phase-1)
5. [Phase 2 — Extract the Profile Domain](#5-phase-2)
6. [Phase 3 — Extract the Discovery Domain](#6-phase-3)
7. [Phase 4 — Extract the Ranking Domain](#7-phase-4)
8. [Phase 5 — Extract the Generation Domain](#8-phase-5)
9. [Phase 6 — Slim Down the Orchestration Layer (main.py)](#9-phase-6)
10. [Phase 7 — Frontend Modularization](#10-phase-7)
11. [Phase 8 — Build, Test, and CI Overhaul](#11-phase-8)
12. [Phase 9 — Operational Readiness](#12-phase-9)
13. [Migration Strategy — How to Ship Without Breaking Users](#13-migration-strategy)
14. [Dependency Graph — Before and After](#14-dependency-graph)
15. [Risk Register](#15-risk-register)

---

## 1. Current State — What Hurts and Why <a name="1-current-state"></a>

### The "fix one, break another" cycle

The root cause is **tight coupling across three axes**:

| Coupling type | Where it shows up | Impact |
|---|---|---|
| **Data coupling** | `db/client.py` is a 1,200+ line god module. Every agent imports it directly. SQLite, Kuzu, and LanceDB are initialized as module-level globals. | You can't test an agent without initializing all three databases. Changing a column name ripples through 15+ files. |
| **Logic coupling** | `free_scout.py` imports private functions from `scout.py` (`_hn_company_role`, `_is_recent`, `_strip_html_text`). `quality_gate.py` imports from `lead_intel.py`. `evaluator.py` imports the full scoring engine. `generator.py` imports from evaluator, semantic, and scoring engine. | Touching the scoring rubric can break PDF generation. |
| **Orchestration coupling** | `main.py` is 1,900+ lines. It contains API routes, WebSocket broadcasting, job-target configuration, scan orchestration, ghost mode scheduling, profile merging, seniority annotation, and the entire ingestion flow. Global mutable state (`_scan_stop`, `_reevaluate_stop`, `cm`) is shared across async tasks. | Every new feature or bugfix means rebuilding and retesting the entire backend. |

### What the numbers say

- `main.py`: ~1,900 lines, 50+ route handlers, 15+ helper functions
- `db/client.py`: ~1,300 lines, 60+ exported functions, 3 database engines
- `generator.py`: ~51 KB, handles resume + cover letter + outreach + keywords + project selection
- `scoring_engine.py`: ~41 KB, monolithic rubric with 6 criteria groups
- `test_regressions.py`: ~50 KB with inline fixtures (hard to maintain)
- Build time: ~1 hour for full sidecar rebuild

---

## 2. Target Architecture — The Module Map <a name="2-target-architecture"></a>

The backend will be organized into **6 domain modules**, each with a clear public API (a Python interface/protocol), its own tests, and no direct imports from other domains.

```
backend/
├── core/                          # Shared kernel — types, errors, config, logging
│   ├── __init__.py
│   ├── types.py                   # LeadStatus, ScoreResult, CandidateEvidence, etc.
│   ├── errors.py                  # Domain exceptions
│   ├── config.py                  # Settings loading, validation, defaults
│   ├── events.py                  # Event bus interface (pub/sub)
│   └── logging.py                 # Logger factory (replaces logger.py)
│
├── data/                          # Data access layer — the ONLY module that talks to databases
│   ├── __init__.py
│   ├── sqlite/
│   │   ├── __init__.py
│   │   ├── connection.py          # Connection pool, migrations
│   │   ├── leads.py               # Lead CRUD
│   │   ├── settings.py            # Settings CRUD
│   │   ├── events.py              # Event log CRUD
│   │   └── migrations/            # Versioned schema migrations (SQL files)
│   ├── graph/
│   │   ├── __init__.py
│   │   ├── connection.py          # Kuzu connection management
│   │   ├── profile.py             # Profile graph operations
│   │   └── jobs.py                # Job-skill graph operations
│   ├── vector/
│   │   ├── __init__.py
│   │   ├── connection.py          # LanceDB connection management
│   │   └── embeddings.py          # Vector store operations
│   └── repository.py              # Facade that exposes a clean Repository interface
│
├── profile/                       # Profile domain — ingestion, parsing, graph building
│   ├── __init__.py
│   ├── service.py                 # ProfileService — public API
│   ├── ingestor.py                # Resume PDF parsing
│   ├── linkedin_parser.py         # LinkedIn profile parsing
│   ├── github_ingestor.py         # GitHub profile parsing
│   ├── portfolio_ingestor.py      # Portfolio site parsing
│   └── tests/
│       ├── test_ingestor.py
│       ├── test_linkedin.py
│       └── fixtures/
│
├── discovery/                     # Discovery domain — finding jobs from external sources
│   ├── __init__.py
│   ├── service.py                 # DiscoveryService — public API
│   ├── sources/                   # Each source is its own microservice
│   │   ├── __init__.py
│   │   ├── base.py                # Abstract Source protocol
│   │   ├── apify.py               # Apify (LinkedIn, Indeed) scraper
│   │   ├── hackernews.py          # HN "Who is Hiring?" parser
│   │   ├── github_jobs.py         # GitHub job listings
│   │   ├── rss.py                 # RSS/Atom feed parser (RemoteOK, Remotive, etc.)
│   │   ├── x_twitter.py           # X/Twitter API source
│   │   └── custom.py              # User-defined custom connectors
│   ├── normalizer.py              # Raw scrape → standard Lead shape
│   ├── quality_gate.py            # Pre-save quality filters
│   ├── query_gen.py               # Search term optimization
│   ├── targets.py                 # Job target configuration & market focus logic
│   └── tests/
│       ├── test_hackernews.py
│       ├── test_quality_gate.py
│       └── fixtures/
│
├── ranking/                       # Ranking domain — scoring, evaluation, matching
│   ├── __init__.py
│   ├── service.py                 # RankingService — public API
│   ├── scoring_engine.py          # Deterministic rubric (refactored into sub-criteria)
│   ├── criteria/                  # Each scoring criterion is its own microservice
│   │   ├── __init__.py
│   │   ├── base.py                # Abstract Criterion protocol
│   │   ├── role_alignment.py      # Role title/function matching (15 pts)
│   │   ├── stack_coverage.py      # Tech stack overlap (22 pts)
│   │   ├── evidence.py            # Work/project/cert evidence (20 pts)
│   │   ├── seniority_fit.py       # Seniority level matching (25 pts)
│   │   ├── logistics.py           # Location, pay, red flags (13 pts)
│   │   └── learning_curve.py      # Growth potential (5 pts)
│   ├── evaluator.py               # LLM-optional evaluation wrapper
│   ├── semantic.py                # Vector similarity matching
│   ├── feedback_ranker.py         # User feedback learning
│   └── tests/
│       ├── test_scoring.py
│       ├── test_criteria/
│       ├── test_evaluator.py
│       └── fixtures/
│
├── generation/                    # Generation domain — creating tailored assets
│   ├── __init__.py
│   ├── service.py                 # GenerationService — public API
│   ├── generators/                # Each output type is its own microservice
│   │   ├── __init__.py
│   │   ├── base.py                # Abstract Generator protocol
│   │   ├── resume.py              # Tailored resume PDF
│   │   ├── cover_letter.py        # Cover letter PDF
│   │   ├── outreach_email.py      # Cold outreach draft
│   │   ├── linkedin_message.py    # Connection request message
│   │   ├── founder_message.py     # Executive direct contact
│   │   └── keywords.py            # Keyword coverage analysis
│   ├── contact_lookup.py          # Contact discovery
│   ├── pdf_renderer.py            # PDF rendering utilities (shared)
│   └── tests/
│       ├── test_resume.py
│       ├── test_cover_letter.py
│       └── fixtures/
│
├── llm/                           # LLM abstraction layer
│   ├── __init__.py
│   ├── client.py                  # Unified LLM client (Anthropic, Groq, Ollama)
│   ├── providers/
│   │   ├── anthropic.py
│   │   ├── groq.py
│   │   └── ollama.py
│   └── tests/
│
├── automation/                    # Browser automation (experimental)
│   ├── __init__.py
│   ├── actuator.py
│   ├── form_reader.py
│   ├── browser_runtime.py
│   ├── selectors.py
│   └── tests/
│
├── api/                           # HTTP + WebSocket layer (replaces main.py)
│   ├── __init__.py
│   ├── app.py                     # FastAPI app factory, lifespan, middleware
│   ├── auth.py                    # Token auth, CORS
│   ├── websocket.py               # WebSocket connection manager + broadcaster
│   ├── scheduler.py               # APScheduler ghost mode setup
│   ├── routers/                   # Each router is a thin adapter calling domain services
│   │   ├── __init__.py
│   │   ├── leads.py               # /api/v1/leads/*
│   │   ├── profile.py             # /api/v1/profile/*
│   │   ├── discovery.py           # /api/v1/scan/*, /api/v1/free-sources/*
│   │   ├── generation.py          # /api/v1/leads/{id}/generate, /api/v1/template
│   │   ├── ingestion.py           # /api/v1/ingest/*
│   │   ├── settings.py            # /api/v1/settings/*
│   │   ├── events.py              # /api/v1/events
│   │   ├── automation.py          # /api/v1/fire/*, /api/v1/leads/{id}/form/*
│   │   └── health.py              # /health
│   └── tests/
│       ├── test_leads_router.py
│       ├── test_profile_router.py
│       └── conftest.py            # Shared fixtures, fakes
│
├── mcp_server.py                  # MCP stdio interface (thin, calls domain services)
├── main.py                        # Entry point: just `from api.app import create_app; app = create_app()`
└── tests/
    ├── conftest.py                # Global test fixtures
    ├── integration/               # Cross-module integration tests
    └── regression/                # Regression suite (migrated from test_regressions.py)
```

### Why this structure?

**The dependency rule:** imports only flow inward. `api/` calls domain services. Domain services call `data/` and `core/`. Nobody imports from `api/`. `core/` imports nothing from the project.

```
api/routers  →  domain services  →  data/repository  →  databases
                      ↓
                   core/types
                   core/events
                   llm/client
```

---

## 3. Phase 0 — Foundation (do first, everything depends on it) <a name="3-phase-0"></a>

**Duration estimate:** 2–3 days  
**Risk:** Low — purely additive, no behavior changes  
**Goal:** Set up the shared kernel so that later phases have types and contracts to import from.

### Task 0.1 — Create `core/types.py`

Extract all shared data types from across the codebase into one canonical location:

- `LeadStatus` literal type (currently in `main.py` line 53)
- `ScoreResult` and `CriterionScore` dataclasses (currently in `scoring_engine.py`)
- `CandidateEvidence` dataclass (currently in `scoring_engine.py`)
- Pydantic request/response models (`StatusBody`, `FeedbackBody`, `ManualLeadBody`, etc. — currently in `main.py` lines 60–99)
- `Lead` TypedDict (currently implicit — dict passed around everywhere)
- `Profile` TypedDict (currently implicit)

**Why this matters:** Right now the same "lead" dict shape is assumed in 15+ files but never defined. A single typo in a key name causes a silent bug. Making it a TypedDict or Pydantic model means the type checker catches it.

### Task 0.2 — Create `core/errors.py`

Define domain exceptions:
- `LeadNotFoundError`
- `ProfileNotFoundError`
- `IngestionError`
- `ScoringError`
- `GenerationError`
- `DiscoveryError`
- `ConfigurationError`

Currently errors are raised as generic `ValueError`, `LookupError`, or `HTTPException` deep inside agents. Moving to domain errors lets each layer handle them appropriately (the API layer converts them to HTTP status codes; the domain layer just raises them).

### Task 0.3 — Create `core/config.py`

Extract all configuration logic currently scattered across `main.py`:
- `_job_targets()`, `_split_configured_targets()`, `_dedupe_targets()` (lines 220–281)
- `_job_market_focus()` (line 244)
- `_desired_position()`, `_profile_for_discovery()` (lines 284–303)
- `_terms_for_discovery()` (lines 306–325)
- `_int_cfg()`, `_truthy()`, `_free_sources_enabled()`, `_has_x_token()` (lines 352–365)
- `DEFAULT_JOB_TARGETS`, `INDIA_JOB_TARGETS`, `_BLOCKED_JOB_TARGET_MARKERS` (lines 176–217)

This is ~150 lines of pure logic that has zero business being in the HTTP router file.

### Task 0.4 — Create `core/events.py`

Define a simple in-process event bus:

```python
# core/events.py
from typing import Protocol, Callable, Any

class EventBus(Protocol):
    async def publish(self, event_type: str, data: dict) -> None: ...
    def subscribe(self, event_type: str, handler: Callable) -> None: ...
```

This replaces the current pattern where every function takes `cm` (the WebSocket broadcaster) as an implicit global. Domain services will publish events; the API layer will subscribe and forward them to WebSocket clients. This is the single most important decoupling mechanism in the entire refactor.

### Task 0.5 — Create `core/logging.py`

Move `logger.py` into `core/logging.py`. Trivial but establishes the pattern.

---

## 4. Phase 1 — Extract the Data Layer <a name="4-phase-1"></a>

**Duration estimate:** 4–5 days  
**Risk:** Medium — this is the most load-bearing refactor  
**Goal:** Split the 1,300-line `db/client.py` god module into focused sub-modules behind a clean repository interface.

### Task 1.1 — Create `data/sqlite/connection.py`

Extract SQLite connection management:
- `_init_sql()` function and all column migrations (currently lines 139–223)
- Connection factory that returns a connection from a pool (currently every function calls `_sq.connect(sql)` individually)
- Move to a proper migration system: each migration is a numbered SQL file in `data/sqlite/migrations/`

**Micro-tasks:**
1. Create `migrations/001_initial.sql` with the base `leads`, `events`, `settings` tables
2. Create `migrations/002_add_signal_columns.sql` for the signal_score, signal_reason, etc. columns
3. Create `migrations/003_add_feedback_columns.sql` for feedback, learning_delta, etc.
4. Write a `run_migrations()` function that applies un-applied migrations in order
5. Replace the brittle "ALTER TABLE IF NOT EXISTS" pattern with proper migration tracking

### Task 1.2 — Create `data/sqlite/leads.py`

Move all lead-related functions (~500 lines):
- `save_lead()`, `get_all_leads()`, `get_lead_by_id()`, `delete_lead()`
- `update_lead_score()`, `update_lead_status()`, `save_lead_feedback()`
- `save_asset_path()`, `save_asset_package()`, `save_contact_lookup()`
- `mark_applied()`, `update_lead_followup()`, `get_due_followups()`
- `get_discovered_leads()`, `get_job_leads_for_evaluation()`
- `cleanup_bad_leads()`, `lead_cleanup_reasons()`
- `url_exists()`
- `_lead_row_dict()` (the 50-column row mapper)
- `get_lead_for_fire()`

All functions receive a connection as a parameter instead of creating their own.

### Task 1.3 — Create `data/sqlite/settings.py`

Move settings functions (~30 lines):
- `save_settings()`, `get_settings()`, `get_setting()`

### Task 1.4 — Create `data/sqlite/events.py`

Move event log functions (~20 lines):
- `record_event()`, `get_events()`

### Task 1.5 — Create `data/graph/connection.py` and `data/graph/profile.py`

Extract Kuzu graph operations:
- Connection initialization with graceful fallback (currently lines 72–83 in `client.py`)
- `_init()` graph schema creation (lines 92–115)
- `graph_available()`, `graph_error()`, `graph_counts()`
- `_read_profile_from_graph()`, `_save_profile_snapshot()`, `_load_profile_snapshot()`
- All profile CRUD: `get_profile()`, `upsert_candidate()`, `add_skill()`, `remove_skill()`, etc.

### Task 1.6 — Create `data/vector/connection.py` and `data/vector/embeddings.py`

Extract LanceDB operations:
- Connection initialization with `_NullVectorStore` fallback
- Vector table creation and search (currently used by `ingestor.py` and `semantic.py`)

### Task 1.7 — Create `data/repository.py`

A facade class that composes all three stores:

```python
class Repository:
    def __init__(self, sqlite: SQLiteStore, graph: GraphStore, vector: VectorStore):
        self.leads = sqlite.leads
        self.settings = sqlite.settings
        self.events = sqlite.events
        self.profile = graph
        self.vectors = vector
```

Domain services receive a `Repository` instance via dependency injection instead of importing `db.client` directly. This is the key to testability — tests can inject fakes for any store.

### Task 1.8 — Create `data/feedback.py`

Move feedback-related functions that are currently in `client.py`:
- `get_feedback_training_examples()`
- `rank_lead_by_feedback()`
- `recompute_learning_scores()`

These straddle data access and business logic. Keep them in the data layer but behind a clear interface so the ranking domain can call them without importing SQLite internals.

---

## 5. Phase 2 — Extract the Profile Domain <a name="5-phase-2"></a>

**Duration estimate:** 2–3 days  
**Risk:** Low — the profile agents are already relatively well-isolated  
**Goal:** Bundle all profile-related functionality behind a `ProfileService`.

### Task 2.1 — Create `profile/service.py`

```python
class ProfileService:
    def __init__(self, repo: Repository, llm: LLMClient):
        self.repo = repo
        self.llm = llm
    
    async def ingest_resume(self, pdf_bytes: bytes) -> Profile: ...
    async def ingest_linkedin(self, url_or_text: str) -> Profile: ...
    async def ingest_github(self, username: str) -> Profile: ...
    async def ingest_portfolio(self, url: str) -> Profile: ...
    async def ingest_manual_profile(self, data: dict) -> Profile: ...
    def get_profile(self) -> Profile: ...
    def update_candidate(self, name: str, summary: str) -> Profile: ...
    def add_skill(self, skill: Skill) -> Profile: ...
    # ... etc
```

### Task 2.2 — Move agents into `profile/`

Move these files with minimal changes:
- `agents/ingestor.py` → `profile/ingestor.py`
- `agents/linkedin_parser.py` → `profile/linkedin_parser.py`
- `agents/github_ingestor.py` → `profile/github_ingestor.py`
- `agents/portfolio_ingestor.py` → `profile/portfolio_ingestor.py`

**Key change:** Replace `from db.client import ...` with receiving a `Repository` via the service.

### Task 2.3 — Extract inline ingestion logic from `main.py`

The `/api/v1/ingest`, `/api/v1/ingest/linkedin`, `/api/v1/ingest/github`, `/api/v1/ingest/portfolio`, and `/api/v1/ingest/profile` routes (lines 1387–1730 in `main.py`) contain ~350 lines of inline parsing, validation, and graph-building logic. This logic belongs in `ProfileService`, not in HTTP handlers.

---

## 6. Phase 3 — Extract the Discovery Domain <a name="6-phase-3"></a>

**Duration estimate:** 4–5 days  
**Risk:** Medium — the scouts have the most cross-dependencies  
**Goal:** Each job source becomes a pluggable "source" behind a common protocol. The quality gate and normalizer become standalone services.

### Task 3.1 — Define the Source protocol

```python
# discovery/sources/base.py
from typing import Protocol

class Source(Protocol):
    name: str
    
    async def fetch(self, queries: list[str], config: dict) -> list[RawLead]: ...
```

Every source (Apify, HN, GitHub, RSS, X, custom) implements this protocol. The `DiscoveryService` iterates over enabled sources and merges results.

### Task 3.2 — Extract shared utilities into `discovery/normalizer.py`

Functions currently shared between `scout.py` and `free_scout.py`:
- `_strip_html_text()` — HTML cleaning
- `_is_recent()` — freshness checking
- `_hn_company_role()` — HN post title parsing
- `_looks_like_hn_job_post()` — HN post detection
- `classify_job_seniority()` — seniority classification

These are currently private functions in `scout.py` that `free_scout.py` imports directly (a major coupling violation). Move them to shared utilities.

### Task 3.3 — Split `scout.py` into `sources/apify.py`

The current `scout.py` is primarily an Apify scraper. Strip out the shared utilities (Task 3.2), strip out the quality gate calls, and make it a pure `Source` implementation that returns `RawLead` objects.

### Task 3.4 — Split `free_scout.py` into individual source files

`free_scout.py` handles HN, GitHub, Reddit, RSS, and custom connectors all in one file. Split each into:
- `sources/hackernews.py` — HN "Who is Hiring?" parser
- `sources/github_jobs.py` — GitHub job listings
- `sources/rss.py` — RSS/Atom feed parser (covers RemoteOK, Remotive, Jobicy, WWR)
- `sources/custom.py` — User-defined custom connectors

Each file is small, testable, and independently deployable.

### Task 3.5 — Extract `x_scout.py` into `sources/x_twitter.py`

Move with minimal changes. Remove the global `LAST_USAGE` and `LAST_ERRORS` state — return them as part of the result instead.

### Task 3.6 — Move `quality_gate.py` into `discovery/quality_gate.py`

Currently imports from `lead_intel.py`. The quality gate should receive its dependencies (text cleaning, signal scoring) as parameters rather than importing them directly.

### Task 3.7 — Move `lead_intel.py` into `discovery/normalizer.py` (merge)

`lead_intel.py` contains `clean_text()`, `signal_quality()`, and `manual_lead_from_text()`. These are normalization concerns that belong alongside the normalizer.

### Task 3.8 — Move `query_gen.py` into `discovery/query_gen.py`

Search term optimization. Currently imports LLM directly. Should receive an `LLMClient` via the service.

### Task 3.9 — Create `discovery/targets.py`

Extract all job-target configuration from `main.py`:
- `DEFAULT_JOB_TARGETS`, `INDIA_JOB_TARGETS`
- `_job_targets()`, `_split_configured_targets()`, `_dedupe_targets()`
- `_profile_free_source_targets()`, `_profile_x_queries()`
- Market focus logic

### Task 3.10 — Create `discovery/service.py`

```python
class DiscoveryService:
    def __init__(self, repo: Repository, llm: LLMClient, event_bus: EventBus):
        self.sources: list[Source] = []  # registered at startup
        self.quality_gate = QualityGate(...)
        self.normalizer = Normalizer(...)

    async def scan(self, config: DiscoveryConfig, stop_event: asyncio.Event) -> ScanResult:
        """Run all enabled sources, normalize, gate, save, and publish events."""
        ...

    async def scan_free_sources(self, config: DiscoveryConfig) -> ScanResult: ...
    async def scan_x(self, config: DiscoveryConfig) -> ScanResult: ...
```

The scan orchestration logic currently in `main.py` (the `_run_scan` async function, `_run_free_source_scan`, `_run_x_signal_scan` — ~200 lines) moves here.

---

## 7. Phase 4 — Extract the Ranking Domain <a name="7-phase-4"></a>

**Duration estimate:** 3–4 days  
**Risk:** Medium — the scoring engine is the most complex single file  
**Goal:** Break the 41 KB scoring engine into pluggable criteria. Make the evaluator a thin orchestrator.

### Task 4.1 — Define the Criterion protocol

```python
# ranking/criteria/base.py
from typing import Protocol
from core.types import CandidateEvidence, CriterionScore

class Criterion(Protocol):
    name: str
    max_weight: int
    
    def evaluate(self, job: JobDescription, candidate: CandidateEvidence) -> CriterionScore: ...
```

### Task 4.2 — Split `scoring_engine.py` into individual criteria

The current scoring engine has 6 scoring sections inline. Extract each into its own file:

| File | Current section | Weight |
|---|---|---|
| `criteria/role_alignment.py` | Role title matching, function overlap | 15 |
| `criteria/stack_coverage.py` | Tech stack intersection, framework matching | 22 |
| `criteria/evidence.py` | Project evidence, work experience, certifications | 20 |
| `criteria/seniority_fit.py` | Seniority level matching, years-of-experience caps | 25 |
| `criteria/logistics.py` | Location, pay, red flags, company signals | 13 |
| `criteria/learning_curve.py` | Growth potential, adjacent skills | 5 |

**Why this matters:** The seniority scoring bug that gave 92 to senior roles with 0 experience happened because the seniority logic was tangled with 800 lines of other scoring code. When seniority is its own 100-line file, that bug is immediately obvious and testable in isolation.

### Task 4.3 — Refactor `scoring_engine.py` into an orchestrator

The remaining `scoring_engine.py` becomes a thin orchestrator:

```python
class ScoringEngine:
    def __init__(self, criteria: list[Criterion]):
        self.criteria = criteria

    def score(self, job: JobDescription, candidate: CandidateEvidence) -> ScoreResult:
        results = [c.evaluate(job, candidate) for c in self.criteria]
        total = sum(r.score for r in results)
        # Apply hard caps...
        return ScoreResult(score=total, criteria=results, ...)
```

### Task 4.4 — Clean up `evaluator.py`

Currently `evaluator.py` imports the full scoring engine and wraps it with optional LLM evaluation. After the refactor, it becomes:

```python
class Evaluator:
    def __init__(self, scoring_engine: ScoringEngine, llm: LLMClient | None):
        ...

    def score(self, job_text: str, profile: dict) -> ScoreResult:
        deterministic = self.scoring_engine.score(...)
        if self.llm and self.should_use_llm(deterministic):
            return self.blend_with_llm(deterministic, ...)
        return deterministic
```

### Task 4.5 — Move `semantic.py` into `ranking/semantic.py`

Vector similarity matching. Currently accesses LanceDB directly via `from db.client import vec`. Should receive a `VectorStore` interface instead.

### Task 4.6 — Move `feedback_ranker.py` into `ranking/feedback_ranker.py`

User feedback learning. Should receive training examples from the repository instead of querying SQLite directly.

### Task 4.7 — Create `ranking/service.py`

```python
class RankingService:
    def __init__(self, repo: Repository, scoring: ScoringEngine, evaluator: Evaluator,
                 semantic: SemanticMatcher, feedback: FeedbackRanker, event_bus: EventBus):
        ...

    async def evaluate_lead(self, lead: Lead, profile: Profile) -> ScoreResult: ...
    async def reevaluate_all(self, stop_event: asyncio.Event) -> ReevaluationResult: ...
    async def cleanup_bad_leads(self, limit: int = 1000) -> CleanupResult: ...
```

---

## 8. Phase 5 — Extract the Generation Domain <a name="8-phase-5"></a>

**Duration estimate:** 3–4 days  
**Risk:** Low-Medium — generator.py is large but self-contained  
**Goal:** Split the 51 KB generator into individual document generators behind a common protocol.

### Task 5.1 — Define the Generator protocol

```python
# generation/generators/base.py
from typing import Protocol

class Generator(Protocol):
    name: str

    async def generate(self, lead: Lead, profile: Profile, config: dict) -> GeneratedAsset: ...
```

### Task 5.2 — Split `generator.py` into individual generators

| File | What it generates |
|---|---|
| `generators/resume.py` | Tailored resume PDF |
| `generators/cover_letter.py` | Cover letter PDF |
| `generators/outreach_email.py` | Cold outreach email draft |
| `generators/linkedin_message.py` | LinkedIn connection message |
| `generators/founder_message.py` | Direct executive contact message |
| `generators/keywords.py` | Keyword coverage analysis |

### Task 5.3 — Extract `pdf_renderer.py`

Shared PDF rendering utilities (ReportLab/WeasyPrint calls) currently duplicated between resume and cover letter generation. Extract into a single utility module.

### Task 5.4 — Move `contact_lookup.py` into `generation/contact_lookup.py`

Contact discovery service. Should receive an `LLMClient` and `Repository` via DI.

### Task 5.5 — Create `generation/service.py`

```python
class GenerationService:
    def __init__(self, repo: Repository, llm: LLMClient, generators: list[Generator],
                 contact_lookup: ContactLookup, event_bus: EventBus):
        ...

    async def generate_package(self, lead: Lead) -> AssetPackage: ...
    async def generate_single(self, lead: Lead, asset_type: str) -> GeneratedAsset: ...
    async def regenerate_with_template(self, lead: Lead, template: str) -> AssetPackage: ...
```

---

## 9. Phase 6 — Slim Down the Orchestration Layer (main.py) <a name="9-phase-6"></a>

**Duration estimate:** 3–4 days  
**Risk:** Medium — this is where all the wiring happens  
**Goal:** Replace the 1,900-line `main.py` with a thin `api/` layer of ~200 lines total across router files.

### Task 6.1 — Create `api/app.py`

```python
# api/app.py
from fastapi import FastAPI
from api.auth import auth_middleware
from api.routers import leads, profile, discovery, generation, ingestion, settings, events, automation, health

def create_app() -> FastAPI:
    app = FastAPI(title="JustHireMe", version="0.2.0", lifespan=lifespan)
    # Register middleware
    app.add_middleware(...)
    app.middleware("http")(auth_middleware)
    # Register routers
    app.include_router(leads.router, prefix="/api/v1")
    app.include_router(profile.router, prefix="/api/v1")
    # ... etc
    return app
```

### Task 6.2 — Create `api/auth.py`

Extract authentication logic:
- `_API_TOKEN` generation
- `require_http_token` middleware
- `_require_ws_token` guard
- CORS configuration

### Task 6.3 — Create `api/websocket.py`

Extract the `_CM` (connection manager) class and WebSocket endpoint:
- `ConnectionManager.add()`, `.remove()`, `.broadcast()`
- The `/ws` endpoint handler
- Heartbeat logic

### Task 6.4 — Create `api/scheduler.py`

Extract ghost mode scheduling:
- `_ghost_tick()` function (lines 474–605 in `main.py`)
- APScheduler configuration
- This becomes a thin wrapper that calls `DiscoveryService.scan()`, `RankingService.evaluate_lead()`, and `GenerationService.generate_package()` in sequence

### Task 6.5 — Create router files

Each router file is a thin adapter — it receives HTTP requests, calls the appropriate domain service, and returns the response. Example:

```python
# api/routers/leads.py
from fastapi import APIRouter, HTTPException
from core.types import StatusBody, FeedbackBody

router = APIRouter(tags=["leads"])

@router.get("/leads")
async def list_leads(beginner_only: bool = False, seniority: str | None = None):
    return await leads_service.list(beginner_only=beginner_only, seniority=seniority)

@router.put("/leads/{job_id}/status")
async def update_status(job_id: str, body: StatusBody):
    try:
        return await leads_service.update_status(job_id, body.status)
    except LeadNotFoundError:
        raise HTTPException(status_code=404, detail="lead not found")
```

Create these routers:
- `routers/leads.py` — 15 endpoints (GET/DELETE/PUT for leads, feedback, followups, export, versions, PDF)
- `routers/profile.py` — 10 endpoints (GET/PUT/POST/DELETE for candidate, skills, experiences, projects)
- `routers/discovery.py` — 4 endpoints (POST scan, stop scan, free-source scan)
- `routers/generation.py` — 4 endpoints (generate, pipeline/run, template GET/POST)
- `routers/ingestion.py` — 6 endpoints (ingest resume, LinkedIn, GitHub, portfolio, manual profile, template)
- `routers/settings.py` — 3 endpoints (GET, POST, validate)
- `routers/events.py` — 1 endpoint (GET events)
- `routers/automation.py` — 4 endpoints (fire, form/read, apply/preview, selectors/refresh)
- `routers/health.py` — 1 endpoint (GET /health)

### Task 6.6 — Create dependency injection wiring

```python
# api/dependencies.py
from functools import lru_cache

@lru_cache
def get_repository() -> Repository: ...

@lru_cache
def get_llm_client() -> LLMClient: ...

@lru_cache
def get_discovery_service() -> DiscoveryService: ...

# ... etc
```

FastAPI's `Depends()` system makes this clean and testable.

---

## 10. Phase 7 — Frontend Modularization <a name="10-phase-7"></a>

**Duration estimate:** 3–4 days  
**Risk:** Low — React already encourages component isolation  
**Goal:** Introduce feature-based folder structure, a proper API client layer, and state management.

### Task 7.1 — Create an API client layer

Replace the raw `fetch()` calls scattered across components with a typed API client:

```
src/
├── api/
│   ├── client.ts        # Base fetch wrapper with auth
│   ├── leads.ts         # Lead API methods
│   ├── profile.ts       # Profile API methods
│   ├── discovery.ts     # Scan API methods
│   ├── generation.ts    # Generation API methods
│   ├── settings.ts      # Settings API methods
│   └── types.ts         # API response types (mirrors backend core/types.py)
```

### Task 7.2 — Restructure into feature folders

```
src/
├── features/
│   ├── dashboard/
│   │   ├── DashboardView.tsx
│   │   └── components/
│   ├── pipeline/
│   │   ├── PipelineView.tsx
│   │   ├── components/
│   │   └── hooks/
│   ├── inbox/
│   │   ├── LeadInboxView.tsx
│   │   └── components/
│   ├── apply/
│   │   ├── ApplyJobView.tsx
│   │   └── components/
│   ├── profile/
│   │   ├── ProfileView.tsx
│   │   ├── IngestionView.tsx
│   │   └── components/
│   ├── graph/
│   │   ├── GraphView.tsx
│   │   └── components/
│   ├── activity/
│   │   └── ActivityView.tsx
│   └── settings/
│       ├── SettingsModal.tsx
│       └── panels/
├── shared/
│   ├── components/        # Sidebar, Topbar, ErrorBoundary, Icon
│   ├── hooks/             # useWS, useKeyboardShortcuts
│   └── lib/               # leadUtils, formatters
```

### Task 7.3 — Extract state management from App.tsx

`App.tsx` currently manages scanning state, reevaluation state, cleaning state, selected lead, view navigation, and onboarding — all via `useState`. Extract into a lightweight context or reducer:

```typescript
// shared/context/AppContext.tsx
interface AppState {
  scanning: boolean;
  reevaluating: boolean;
  cleaning: boolean;
  selectedLead: Lead | null;
  view: View;
}
```

### Task 7.4 — Type the WebSocket messages

Currently WebSocket messages are untyped `dict`/`object`. Define a discriminated union:

```typescript
type WSMessage =
  | { type: "heartbeat"; uptime: number }
  | { type: "agent"; event: string; msg: string }
  | { type: "LEAD_UPDATED"; data: Lead }
  | { type: "HOT_X_LEAD"; data: Lead };
```

---

## 11. Phase 8 — Build, Test, and CI Overhaul <a name="11-phase-8"></a>

**Duration estimate:** 2–3 days  
**Risk:** Low — infrastructure changes, no behavior changes  
**Goal:** Make builds fast and tests reliable.

### Task 8.1 — Modular test fixtures

Replace the 50 KB `test_regressions.py` with:
- Fixture files per domain: `ranking/tests/fixtures/`, `discovery/tests/fixtures/`
- Shared test utilities in `tests/conftest.py`
- Each domain has its own `conftest.py` with domain-specific fakes

### Task 8.2 — Add per-module test commands

```toml
# pyproject.toml
[tool.pytest.ini_options]
markers = [
    "unit: unit tests (fast, no I/O)",
    "integration: integration tests (may use real DB)",
    "regression: regression tests",
]
```

Developers can run `pytest -m unit` in seconds, `pytest -m integration` before committing, `pytest -m regression` in CI.

### Task 8.3 — Incremental sidecar builds

Currently the entire Python backend is bundled into a single sidecar binary. Investigate:
- PyInstaller with `--collect-submodules` per domain
- Nuitka for faster compilation
- Or: ship Python as a venv with `uv` instead of compiling — dramatically faster "build" time

### Task 8.4 — CI pipeline per domain

```yaml
# .github/workflows/test-ranking.yml
on:
  push:
    paths: ["backend/ranking/**", "backend/core/**"]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pytest backend/ranking/tests/ -v
```

Each domain runs its own CI job. Changes to `ranking/` don't trigger `discovery/` tests.

### Task 8.5 — Add type checking

```bash
# pyproject.toml
[tool.mypy]
strict = true
```

With proper TypedDicts and Protocols, mypy catches the "wrong dict key" bugs that currently only surface at runtime.

---

## 12. Phase 9 — Operational Readiness <a name="12-phase-9"></a>

**Duration estimate:** 2–3 days  
**Risk:** Low  
**Goal:** Production hygiene for a product with 200+ real users.

### Task 9.1 — Structured logging

Replace `_log.info(f"...")` with structured logging that includes:
- Request ID (for tracing a scan through multiple agents)
- Domain name (which module produced the log)
- Duration (how long each operation took)

### Task 9.2 — Error telemetry (opt-in)

Users with 200+ downloads will hit bugs you never see locally. Add opt-in crash reporting:
- Catch unhandled exceptions in each domain service
- Write them to a local `errors.jsonl` file
- Optionally send to a telemetry endpoint (with user consent)

### Task 9.3 — Health check enhancements

Current `/health` only reports uptime. Add:
- Database connectivity (SQLite, Kuzu, LanceDB)
- LLM provider reachability
- Last scan timestamp
- Lead count, profile status

### Task 9.4 — Configuration validation at startup

Currently misconfigured API keys silently fail during scans. Add a startup validation pass that warns about:
- Missing API keys for enabled features
- Invalid job target URLs
- Unreachable LLM providers

---

## 13. Migration Strategy — How to Ship Without Breaking Users <a name="13-migration-strategy"></a>

This is the most important section. You have 200+ active users. You cannot break their installations.

### Principle: Strangle the monolith, don't rewrite it

Never delete old code until the new code is proven. The migration follows the "strangler fig" pattern:

1. **Create the new module** alongside the old code
2. **Route one endpoint** to the new module, keep the rest on the old code
3. **Test in production** (your own machine + beta users)
4. **Migrate the next endpoint** once the first is stable
5. **Delete old code** only after all endpoints are migrated

### Suggested migration order

| Order | Module | Why this order |
|---|---|---|
| 1 | `core/` | Foundation — everything else imports from it |
| 2 | `data/` | Database layer — most other modules depend on it |
| 3 | `llm/` | Small, self-contained, used by many domains |
| 4 | `profile/` | Low coupling, easy to verify (ingest a resume, check the graph) |
| 5 | `ranking/` | High complexity but great test coverage opportunity |
| 6 | `discovery/` | Medium complexity, most cross-dependencies |
| 7 | `generation/` | Large but self-contained |
| 8 | `api/` | Last — this is the wiring that connects everything |
| 9 | Frontend | Can happen in parallel with backend phases 4–7 |

### Version compatibility

- Keep the same API contract (`/api/v1/...`). The frontend doesn't care about backend internals.
- Keep the same SQLite schema. Migrations only add columns, never remove.
- Keep the same Kuzu graph schema.
- The refactor is invisible to users — their data, settings, and workflows continue working.

### Branch strategy

- Work on a `refactor/modularize` branch
- Merge to `main` after each phase (not after all phases)
- Each phase should be a PR that passes all existing tests
- Tag releases: `v0.2.0-alpha.1` (Phase 0+1), `v0.2.0-alpha.2` (Phase 2+3), etc.

---

## 14. Dependency Graph — Before and After <a name="14-dependency-graph"></a>

### Before (current state)

```
main.py ──→ scout.py ──→ quality_gate.py ──→ lead_intel.py
   │    ──→ free_scout.py ──→ scout.py (private fns!)
   │                     ──→ quality_gate.py
   │                     ──→ lead_intel.py
   │                     ──→ db.client
   │    ──→ evaluator.py ──→ scoring_engine.py
   │    ──→ generator.py ──→ evaluator.py
   │                     ──→ semantic.py
   │                     ──→ scoring_engine.py
   │                     ──→ db.client
   │    ──→ ingestor.py ──→ db.client (vec global)
   │    ──→ x_scout.py ──→ lead_intel.py
   │    ──→ db.client (god module: SQLite + Kuzu + LanceDB)
   │    ──→ llm.py ──→ db.client
   
   Everything imports db.client.
   free_scout imports scout's private functions.
   generator imports evaluator + scoring_engine + semantic.
   main.py has 1,900 lines of inline orchestration.
```

### After (target state)

```
api/routers ──→ domain services (via DI)
                    │
     ┌──────────────┼──────────────┐
     │              │              │
 ProfileService  DiscoveryService  RankingService  GenerationService
     │              │              │              │
     └──────────────┴──────────────┴──────────────┘
                    │
              Repository (facade)
              ┌─────┼─────┐
         SQLiteStore  GraphStore  VectorStore
              
     core/types ← imported by everyone
     core/events ← EventBus for cross-domain communication
     llm/client ← injected into services that need it

     No domain imports another domain.
     All cross-domain communication goes through the EventBus or the API layer.
```

---

## 15. Risk Register <a name="15-risk-register"></a>

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Regression during data layer refactor | High | High | Write integration tests for every `db.client` function BEFORE refactoring. Run them after every change. |
| Import cycles between new modules | Medium | Medium | Enforce the dependency rule with a linter (import-linter or custom check). CI fails if a domain imports another domain. |
| Build time doesn't improve | Medium | Low | The real win is test time and dev velocity. Build time improvement requires switching from PyInstaller to venv-based distribution. |
| Users hit bugs in partial migration | Medium | High | Ship each phase as a tagged release. Keep a `stable` branch that users can roll back to. |
| Scope creep — "while I'm here" syndrome | High | Medium | Each PR does ONE phase. No feature work during refactoring. |
| Frontend refactor conflicts with backend refactor | Low | Medium | Frontend changes are independent — the API contract stays the same. Can be done in parallel. |

---

## Summary — The Critical Path

```
Phase 0: core/ types, errors, config, events (2-3 days)
    ↓
Phase 1: data/ layer extraction (4-5 days)
    ↓
Phase 2: profile/ domain (2-3 days)     ←── can start frontend (Phase 7) here
    ↓
Phase 3: discovery/ domain (4-5 days)
    ↓
Phase 4: ranking/ domain (3-4 days)
    ↓
Phase 5: generation/ domain (3-4 days)
    ↓
Phase 6: api/ layer (3-4 days)
    ↓
Phase 8: build/test/CI (2-3 days)
    ↓
Phase 9: operational readiness (2-3 days)

Total estimate: 25-34 working days (~5-7 weeks)
```

This is not a rewrite. It's a systematic, phase-by-phase extraction where every intermediate state is shippable, testable, and backward-compatible. After each phase, the codebase is strictly better than before, and you never have a "big bang" moment where everything breaks.
