# JustHireMe — Production Readiness Roadmap

**Date:** May 10, 2026  
**Context:** The modularization is structurally complete. This roadmap addresses every issue found in the system audit to make the product rock-solid for 200+ active users.  
**Philosophy:** Fix stability first, then performance, then polish. Each sprint is independently shippable.

---

## Table of Contents

1. [Sprint 1 — Kill the Duplication (days 1-3)](#sprint-1)
2. [Sprint 2 — Concurrency & Data Safety (days 4-7)](#sprint-2)
3. [Sprint 3 — Frontend Stability (days 8-11)](#sprint-3)
4. [Sprint 4 — EventBus Wiring & Decoupling (days 12-15)](#sprint-4)
5. [Sprint 5 — Test Coverage & CI Hardening (days 16-20)](#sprint-5)
6. [Sprint 6 — API Hardening & Security (days 21-24)](#sprint-6)
7. [Sprint 7 — Performance & Scalability (days 25-28)](#sprint-7)
8. [Sprint 8 — Observability & Operational Readiness (days 29-32)](#sprint-8)
9. [Sprint 9 — Polish & Developer Experience (days 33-36)](#sprint-9)
10. [Dependency Map Between Sprints](#dependency-map)
11. [Validation Checklist — How to Know You're Done](#validation-checklist)

---

## Sprint 1 — Kill the Duplication (days 1-3) <a name="sprint-1"></a>

**Goal:** Eliminate the `agents/` directory entirely. One canonical location for every file.  
**Fixes:** C1, H1, H2, L1  
**Risk:** High (touches import paths everywhere)  
**Strategy:** Do this as one atomic PR. Run `test_import_boundaries.py` after every move.

---

### Task 1.1 — Decide canonical homes for live `agents/` files

| File | Lines | Current homes | Decision | Rationale |
|---|---|---|---|---|
| `scout.py` | 590 | `agents/`, `automation/` | **Keep in `automation/`** | It's a scraping runner, not a "discovery domain" concept. Discovery defines sources; automation orchestrates them. |
| `free_scout.py` | 419 | `agents/`, `automation/` | **Keep in `automation/`** | Same as above |
| `x_scout.py` | 471 | `agents/`, `automation/` | **Keep in `automation/`** | Same as above |
| `actuator.py` | 454 | `agents/`, `automation/` | **Keep in `automation/`** | Browser automation |
| `browser_runtime.py` | 131 | `agents/`, `automation/` | **Keep in `automation/`** | Playwright wrapper |
| `selectors.py` | 84 | `agents/`, `automation/` | **Keep in `automation/`** | CSS selectors |
| `help_agent.py` | 466 | `agents/` only | **Create `help/` module** | Distinct domain — not automation, not discovery |

### Task 1.2 — Create the `help/` domain module

```
backend/help/
├── __init__.py
├── agent.py          ← moved from agents/help_agent.py
└── service.py        ← thin async wrapper (like other services)
```

**Steps:**
1. Create `backend/help/__init__.py`
2. Move `agents/help_agent.py` → `help/agent.py`
3. Create `help/service.py` with a `HelpService` class wrapping the agent's `answer()` function
4. Update `api/routers/` (whichever router handles `/api/v1/help/chat`) to import from `help.service`
5. Add `"help": {"help", "llm"}` to `ALLOWED_IMPORTS` in `test_import_boundaries.py` (already present from audit)

### Task 1.3 — Delete all shim files in `agents/`

Delete these files (they're 1-5 line redirects):
- `agents/evaluator.py`
- `agents/scoring_engine.py`
- `agents/ingestor.py`
- `agents/linkedin_parser.py`
- `agents/github_ingestor.py`
- `agents/portfolio_ingestor.py`
- `agents/lead_intel.py`
- `agents/quality_gate.py`
- `agents/feedback_ranker.py`
- `agents/semantic.py`
- `agents/contact_lookup.py`
- `agents/generator.py`
- `agents/query_gen.py`

### Task 1.4 — Delete duplicate live files in `agents/`

Now that `automation/` has the canonical copies:
- Delete `agents/scout.py`
- Delete `agents/free_scout.py`
- Delete `agents/x_scout.py`
- Delete `agents/actuator.py`
- Delete `agents/browser_runtime.py`
- Delete `agents/selectors.py`
- Delete `agents/help_agent.py` (moved to `help/`)

### Task 1.5 — Delete the `agents/` directory

- Delete `agents/__init__.py`
- Remove `agents/` from any `sys.path` manipulation
- Remove `"agents"` from `PROJECT_PACKAGES` in `test_import_boundaries.py`

### Task 1.6 — Update `db/client.py` facade to not import from `agents/`

Currently `db/client.py` line 6: `from automation.service import get_lead_for_fire_sync`

Verify all remaining references to `agents.*` in:
- `db/client.py`
- `api/routers/*.py`
- `api/scheduler.py`

Replace any remaining `from agents.X import Y` with the canonical path (`from automation.X`, `from help.agent`, etc.).

### Task 1.7 — Run validation

```bash
# Must all pass:
uv run python -m pytest tests/test_import_boundaries.py -v
uv run python -m pytest tests/ -q
# Verify no "agents" references remain:
grep -r "from agents" --include="*.py" | grep -v __pycache__
# Should return NOTHING
```

---

## Sprint 2 — Concurrency & Data Safety (days 4-7) <a name="sprint-2"></a>

**Goal:** Eliminate race conditions, thread safety issues, and database locking problems.  
**Fixes:** C2 (partial), C3, C4, H4, H5, M5  
**Risk:** Medium (behavioral changes, need careful testing)

---

### Task 2.1 — Add asyncio.Lock to scan/reevaluate task management

**File:** `api/routers/discovery.py`

**Current state (broken):**
```python
SCAN_TASK: asyncio.Task | None = None  # global, unprotected

@router.post("/scan")
async def start_scan(...):
    global SCAN_TASK
    if SCAN_TASK and not SCAN_TASK.done():
        raise HTTPException(409, "Scan already running")
    SCAN_TASK = asyncio.create_task(run_scan(...))
```

**Fix:**
```python
_scan_lock = asyncio.Lock()
_reevaluate_lock = asyncio.Lock()

@router.post("/scan")
async def start_scan(...):
    global SCAN_TASK
    async with _scan_lock:
        if SCAN_TASK and not SCAN_TASK.done():
            raise HTTPException(409, "Scan already running")
        SCAN_STOP.clear()
        SCAN_TASK = asyncio.create_task(run_scan(...))
    return {"status": "started"}
```

**Apply the same pattern to:**
- `/api/v1/scan/stop`
- `/api/v1/leads/reevaluate`
- `/api/v1/leads/reevaluate/stop`

**Micro-tasks:**
1. Add `_scan_lock = asyncio.Lock()` at module level
2. Wrap `start_scan` endpoint body in `async with _scan_lock`
3. Wrap `stop_scan` endpoint body in `async with _scan_lock`
4. Add `_reevaluate_lock = asyncio.Lock()`
5. Wrap `start_reevaluate` endpoint in `async with _reevaluate_lock`
6. Wrap `stop_reevaluate` endpoint in `async with _reevaluate_lock`
7. Add a test: two concurrent POST /scan requests → one returns 409

---

### Task 2.2 — Enable SQLite WAL mode

**File:** `data/sqlite/connection.py`

**Current state:**
```python
def connect(db_path: str = DEFAULT_DB_PATH):
    return sqlite3.connect(db_path)
```

**Fix:**
```python
def connect(db_path: str = DEFAULT_DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")  # Wait 5s on lock instead of failing
    return conn
```

**Why WAL:** Write-Ahead Logging allows concurrent readers and one writer. Without it, even a read during a write causes "database is locked". With `busy_timeout`, SQLite retries for 5 seconds before failing.

**Micro-tasks:**
1. Add WAL and busy_timeout pragmas to `connect()`
2. Add `PRAGMA synchronous=NORMAL` (WAL is already durable with NORMAL)
3. Verify migration function still works with WAL
4. Test: concurrent reads and writes don't error

---

### Task 2.3 — Add migration locking

**File:** `data/sqlite/connection.py`

**Current state:** `run_migrations()` has no locking — two processes could run migrations simultaneously.

**Fix:**
```python
import fcntl  # Unix-only; on Windows use msvcrt or a lockfile

def run_migrations(db_path: str = DEFAULT_DB_PATH) -> None:
    _ensure_parent(db_path)
    lock_path = db_path + ".migration.lock"
    
    with open(lock_path, "w") as lock_file:
        try:
            # Exclusive lock (blocks until acquired)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
            else:
                fcntl.flock(lock_file, fcntl.LOCK_EX)
            
            _run_migrations_inner(db_path)
        finally:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
```

**Micro-tasks:**
1. Extract `_run_migrations_inner()` from current `run_migrations()` body
2. Wrap with platform-appropriate file locking
3. Test: two concurrent `init_sql()` calls don't duplicate migrations

---

### Task 2.4 — Make Kuzu graph access thread-safe

**File:** `data/graph/connection.py`

**Current state:** A single `kuzu.Connection(db)` is used from multiple `asyncio.to_thread()` calls. Kuzu's Python binding documentation says connections are NOT thread-safe.

**Fix:** Use a connection-per-operation pattern with a threading.Lock:

```python
import threading

_graph_lock = threading.Lock()

def execute_query(query: str, params: dict | None = None):
    """Thread-safe Kuzu query execution."""
    if conn is None:
        return None
    with _graph_lock:
        if params:
            return conn.execute(query, params)
        return conn.execute(query)
```

**Micro-tasks:**
1. Add `_graph_lock = threading.Lock()` to `data/graph/connection.py`
2. Create `execute_query()` wrapper that acquires the lock
3. Update `data/graph/profile.py` to use `execute_query()` instead of `conn.execute()` directly
4. Audit all `conn.execute()` calls — must all go through the locked wrapper
5. Test: concurrent profile reads and writes don't corrupt

---

### Task 2.5 — Fix WebSocket broadcast backpressure

**File:** `api/websocket.py`

**Current state:** `broadcast()` sends sequentially to all clients. A slow client blocks everyone.

**Fix:** Send with a per-client timeout and use `asyncio.gather`:

```python
async def broadcast(self, msg: dict):
    # ... event recording ...
    
    text = json.dumps(msg)
    dead = []
    
    async def _send(ws: WebSocket):
        try:
            await asyncio.wait_for(ws.send_text(text), timeout=2.0)
        except Exception:
            dead.append(ws)
    
    await asyncio.gather(*[_send(ws) for ws in self._ws])
    
    for ws in dead:
        self.remove(ws)
```

**Micro-tasks:**
1. Serialize `msg` once before the loop (avoid N serializations)
2. Use `asyncio.gather()` for parallel sends
3. Add 2-second per-client timeout
4. Remove dead clients after gather completes
5. Test: slow client doesn't block fast clients

---

### Task 2.6 — Add connection state check to WebSocket reconnect

**File:** `api/websocket.py` — the `register_websocket` function

The current WebSocket endpoint doesn't properly handle the case where `token_guard` rejects and the WS was never accepted. Add explicit state management:

```python
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if not await token_guard(ws):
        # token_guard closes the WS internally
        return
    await websocket_loop(ws, manager=manager, started_at=started_at, logger=logger)
```

Verify that `token_guard` (in `api/auth.py`) calls `await ws.close(code=4401)` BEFORE returning False, and that it does NOT call `await ws.accept()` first.

---

## Sprint 3 — Frontend Stability (days 8-11) <a name="sprint-3"></a>

**Goal:** Fix all React race conditions, memory leaks, and UX reliability issues.  
**Fixes:** H6, H7, H8 + frontend audit findings  
**Risk:** Low-Medium (React changes are isolated)

---

### Task 3.1 — Add exponential backoff to WebSocket reconnection

**File:** `src/shared/hooks/useWS.ts`, line 60

**Current state:**
```typescript
ws.onclose = () => { setConn("disconnected"); wsRef.current = null; setTimeout(() => connect(p, token), 3000); };
```

**Fix:**
```typescript
const retryRef = useRef(0);
const MAX_RETRY_DELAY = 30000; // 30 seconds max

// Inside connect():
ws.onopen = () => {
  setConn("connected");
  retryRef.current = 0; // Reset on successful connection
  addLog("WebSocket connected", "system", "ws");
};

ws.onclose = () => {
  setConn("disconnected");
  wsRef.current = null;
  const delay = Math.min(1000 * Math.pow(2, retryRef.current), MAX_RETRY_DELAY);
  const jitter = delay * (0.5 + Math.random() * 0.5); // 50-100% of delay
  retryRef.current++;
  setTimeout(() => connect(p, token), jitter);
};
```

**Micro-tasks:**
1. Add `retryRef = useRef(0)` for retry count
2. Add `MAX_RETRY_DELAY = 30000` constant
3. Calculate delay with exponential backoff: `1000 * 2^retryCount`
4. Add random jitter (50-100% of delay)
5. Reset retry count on successful `onopen`
6. Cap at 30 seconds
7. Add a max retry count (e.g., 20) after which stop retrying and show "Backend unreachable" permanently

---

### Task 3.2 — Fix duplicate WebSocket creation race

**File:** `src/shared/hooks/useWS.ts`, line 25

**Current state:**
```typescript
const connect = useCallback((p: number, token: string) => {
  if (wsRef.current?.readyState === WebSocket.OPEN) return;
  // BUG: doesn't check CONNECTING state!
```

**Fix:**
```typescript
const connect = useCallback((p: number, token: string) => {
  const current = wsRef.current;
  if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
    return; // Already connected or connecting
  }
  // Close any lingering connection in CLOSING state
  if (current) {
    current.onclose = null; // Prevent reconnect loop
    current.close();
  }
  setConn("connecting");
  const ws = new WebSocket(...);
  wsRef.current = ws;
```

**Micro-tasks:**
1. Check both `OPEN` and `CONNECTING` states
2. Clean up existing connection before creating new one
3. Null out `onclose` before manual close to prevent recursive reconnect

---

### Task 3.3 — Fix useLeads race between HTTP and WebSocket

**File:** `src/shared/hooks/useLeads.ts`

**Current state:** A 5-second polling interval can overwrite fresh WebSocket updates with stale HTTP data.

**Fix:** Track a version counter that increments on WebSocket updates. Skip HTTP responses that arrive after a WS update:

```typescript
const wsVersionRef = useRef(0);
const fetchVersionRef = useRef(0);

// In the WebSocket handler:
const onLeadUpdated = (e: Event) => {
  wsVersionRef.current++;
  // ... existing merge logic
};

// In the HTTP loader:
const load = async (background = false) => {
  const fetchVersion = ++fetchVersionRef.current;
  // ... fetch ...
  if (!alive) return;
  // Skip if a WS update arrived after this fetch started
  if (background && wsVersionRef.current > 0 && fetchVersion < fetchVersionRef.current) return;
  setLeads(jobLeads);
};
```

**Alternative simpler fix:** Remove the 5-second polling entirely. WebSocket + explicit refresh events (`leads-refresh`) already cover all cases:

```typescript
// Remove:
// const t = setInterval(() => load(true), 5000);

// Keep only the event-driven refresh:
window.addEventListener("leads-refresh", onRefresh);
```

**Recommendation:** Go with the simpler fix. The 5-second poll is redundant given WebSocket push updates and explicit refresh events. It only causes race conditions.

**Micro-tasks:**
1. Remove the `setInterval(() => load(true), 5000)` line
2. Keep the `leads-refresh` event listener for explicit refreshes
3. Add a "Refresh" button in the UI that dispatches `leads-refresh` for manual use
4. Test: update a lead via API, verify it appears immediately via WS without polling

---

### Task 3.4 — Add AbortController to all long-running API calls

**Files affected:**
- `src/features/pipeline/components/ApprovalDrawer.tsx` — `generatePdf()`, `fire()`, `submitFeedback()`
- `src/features/apply/ApplyJobView.tsx` — polling loop
- `src/shared/components/OnboardingWizard.tsx` — `saveResume()`
- `src/features/settings/panels/GlobalSettings.tsx` — `validate()`

**Pattern to apply everywhere:**

```typescript
const abortRef = useRef<AbortController | null>(null);

const generatePdf = async () => {
  abortRef.current?.abort(); // Cancel any previous request
  const controller = new AbortController();
  abortRef.current = controller;
  
  setGenerating(true);
  try {
    const r = await api(`/api/v1/leads/${j.job_id}/generate`, {
      method: "POST",
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    // ... handle response
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    // ... handle real error
  } finally {
    setGenerating(false);
  }
};

// Cleanup on unmount:
useEffect(() => {
  return () => { abortRef.current?.abort(); };
}, []);
```

**Micro-tasks:**
1. Add AbortController to `ApprovalDrawer` — 3 async functions
2. Add AbortController to `ApplyJobView` — polling loop
3. Add AbortController to `OnboardingWizard` — resume save
4. Add AbortController to `GlobalSettings` — validation
5. Add cleanup `useEffect` to each component
6. Filter `AbortError` from error state displays

---

### Task 3.5 — Add fetch timeout to API client

**File:** `src/api/client.ts`

**Current state:** No timeout — fetch hangs indefinitely if backend stops responding.

**Fix:**
```typescript
export function createApiFetch(port: number, token: string): ApiFetch {
  return (path, opts) => {
    const headers = new Headers(opts?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    
    // Add 30-second timeout unless caller provides their own signal
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const signal = opts?.signal
      ? opts.signal  // Caller's signal takes priority
      : controller.signal;
    
    return fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers, signal })
      .finally(() => clearTimeout(timeoutId));
  };
}
```

**Micro-tasks:**
1. Add default 30-second timeout via AbortController
2. Allow callers to override with their own signal
3. Clear timeout on response (prevent memory leak)

---

### Task 3.6 — Fix ApprovalDrawer state-update-on-unmount

**File:** `src/features/pipeline/components/ApprovalDrawer.tsx`

Beyond AbortController (Task 3.4), add an `alive` ref pattern:

```typescript
const aliveRef = useRef(true);
useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

const fire = async () => {
  // ...
  try {
    const r = await api(...);
    if (!aliveRef.current) return;
    setDone(true);
  } catch (err) {
    if (!aliveRef.current) return;
    setFireErr(...);
  }
};
```

---

### Task 3.7 — Fix PipelineView bulk delete error handling

**File:** `src/features/pipeline/PipelineView.tsx`

**Current state:** Serial deletion, no error tracking, no abort.

**Fix:**
```typescript
const bulkDelete = async () => {
  if (!window.confirm(`Delete ${selected.size} leads?`)) return;
  const results = await Promise.allSettled(
    [...selected].map(id => deleteLead(id))
  );
  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) {
    alert(`${failed} of ${selected.size} deletions failed. Refreshing list.`);
  }
  setSelected(new Set());
  setBulkSelecting(false);
  window.dispatchEvent(new CustomEvent("leads-refresh"));
};
```

---

## Sprint 4 — EventBus Wiring & Decoupling (days 12-15) <a name="sprint-4"></a>

**Goal:** Wire the existing `core/events.py` EventBus so domain services publish events instead of routers manually calling `cm.broadcast()`.  
**Fixes:** H3, reduces coupling between api/ and domain services  
**Risk:** Medium (changes event flow, but behavior stays the same)

---

### Task 4.1 — Create a global EventBus singleton

**File:** `api/dependencies.py` (add to existing)

```python
from core.events import InProcessEventBus

_event_bus = InProcessEventBus()

def get_event_bus() -> InProcessEventBus:
    return _event_bus
```

### Task 4.2 — Subscribe WebSocket broadcaster to EventBus

**File:** `api/app.py` (in the app factory or lifespan)

```python
from api.dependencies import get_event_bus

def _wire_event_bus(event_bus: InProcessEventBus, cm: ConnectionManager):
    """Bridge: domain events → WebSocket broadcasts."""
    
    async def _forward_to_ws(event_type: str, data: dict):
        await cm.broadcast(data)
    
    event_bus.subscribe("*", _forward_to_ws)  # Forward ALL domain events to WS
```

Call `_wire_event_bus(get_event_bus(), connection_manager)` during app startup.

### Task 4.3 — Inject EventBus into DiscoveryService

**File:** `discovery/service.py`

```python
class DiscoveryService:
    def __init__(self, event_bus: EventBus | None = None):
        self.events = event_bus
    
    async def scan_x(self, cfg, *, kind_filter="job", profile=None) -> DiscoveryRunResult:
        if self.events:
            await self.events.publish("agent", {"type": "agent", "event": "x_scout_start", "msg": "Scanning X for job leads..."})
        result = await ...
        if self.events:
            await self.events.publish("agent", {"type": "agent", "event": "x_scout_done", "msg": f"X scout - {len(result.leads)} leads found"})
        return result
```

### Task 4.4 — Inject EventBus into RankingService

Publish events when scoring/evaluation starts and completes. This removes the need for routers to manually broadcast progress.

### Task 4.5 — Inject EventBus into GenerationService

Publish events when generation starts and for each asset generated.

### Task 4.6 — Migrate router-level broadcasts to service-level events

**File:** `api/routers/discovery.py`

Remove explicit `manager.broadcast(...)` calls that duplicate what the service now publishes. Keep only broadcasts that are API-layer concerns (like "scan started" acknowledgment).

**Approach:** Do this incrementally. Start with the X scan route as a pilot, verify events still reach the frontend, then do free-source scan, then main scan, then reevaluation.

### Task 4.7 — Add typed event constants

**File:** `core/events.py`

```python
# Event type constants — prevents typos
SCAN_STARTED = "scan_started"
SCAN_PROGRESS = "scan_progress"
SCAN_DONE = "scan_done"
LEAD_SCORED = "lead_scored"
LEAD_UPDATED = "lead_updated"
GENERATION_STARTED = "generation_started"
GENERATION_DONE = "generation_done"
# ... etc
```

---

## Sprint 5 — Test Coverage & CI Hardening (days 16-20) <a name="sprint-5"></a>

**Goal:** Get meaningful test coverage on the frontend, clean up legacy test files, add concurrency tests.  
**Fixes:** M6, L4  
**Risk:** Low (additive, no behavior changes)

---

### Task 5.1 — Delete legacy `tests/test_regressions.py`

**Steps:**
1. Read `test_regressions.py` — identify any tests NOT covered by the new per-domain regression files
2. Move any unique tests to their appropriate domain test file
3. Delete `test_regressions.py`
4. Verify `pytest tests/ -q` still passes with the same or higher test count

### Task 5.2 — Delete `test_ingestion.py` and `test_live_fire.py` from root

These are ad-hoc test files at `backend/test_ingestion.py` and `backend/test_live_fire.py`. They should either:
- Move to `tests/` with proper fixtures, or
- Be deleted if covered by `test_profile_service.py` and `test_automation_service.py`

### Task 5.3 — Add frontend test infrastructure

**Files to create:**
```
src/shared/hooks/useWS.test.ts
src/shared/hooks/useLeads.test.ts
src/features/pipeline/PipelineView.test.tsx
src/features/pipeline/components/ApprovalDrawer.test.tsx
src/api/client.test.ts
```

**Setup:**
```bash
npm install -D @testing-library/react @testing-library/jest-dom jsdom
```

Update `vite.config.ts`:
```typescript
test: {
  environment: 'jsdom',
  setupFiles: ['./src/test-setup.ts'],
}
```

### Task 5.4 — Write `useWS.test.ts`

Test cases:
1. Connects to WebSocket with correct URL and token
2. Reconnects with exponential backoff on close
3. Doesn't create duplicate connections when called twice
4. Parses heartbeat messages correctly
5. Dispatches `lead-updated` custom events
6. Dispatches `scan-done` on `eval_done` event
7. Cleans up on unmount

### Task 5.5 — Write `useLeads.test.ts`

Test cases:
1. Fetches leads on mount
2. Merges WebSocket updates into lead list (new lead)
3. Merges WebSocket updates into lead list (updated lead)
4. Handles API errors gracefully
5. Cleans up interval and event listeners on unmount
6. Doesn't set state after unmount

### Task 5.6 — Write `client.test.ts`

Test cases:
1. Adds Authorization header
2. Respects 30-second timeout
3. Handles network errors

### Task 5.7 — Add backend concurrency tests

**File:** `tests/test_concurrency.py`

```python
import asyncio
import pytest

@pytest.mark.integration
async def test_concurrent_scans_return_409():
    """Second scan request should return 409 while first is running."""
    ...

@pytest.mark.integration
async def test_concurrent_sqlite_writes_dont_lock():
    """Multiple writers with WAL mode should not raise 'database is locked'."""
    ...

@pytest.mark.integration
async def test_concurrent_profile_graph_access():
    """Concurrent reads/writes to Kuzu graph with lock should not corrupt."""
    ...
```

### Task 5.8 — Add CI coverage reporting

**File:** `.github/workflows/ci.yml`

```yaml
- run: cd backend && uv run python -m pytest tests/ -q --cov=. --cov-report=xml
- uses: codecov/codecov-action@v4
  with:
    files: backend/coverage.xml
```

### Task 5.9 — Add linting to CI

**File:** `.github/workflows/ci.yml`

```yaml
# Backend
- run: cd backend && uv run ruff check .
- run: cd backend && uv run ruff format --check .

# Frontend
- run: npx eslint src/ --max-warnings=0
```

Add `ruff` to dev dependencies in `pyproject.toml`. Add `eslint` + `eslint-config-prettier` to `package.json` devDependencies.

---

## Sprint 6 — API Hardening & Security (days 21-24) <a name="sprint-6"></a>

**Goal:** Close security gaps, add rate limiting, validate inputs properly, prevent path traversal.  
**Fixes:** M2, M3, M7, H5 (from audit)  
**Risk:** Low-Medium

---

### Task 6.1 — Add rate limiting to expensive endpoints

**Approach:** Use a simple in-memory rate limiter (no Redis needed for a local-first app):

**File:** `api/rate_limit.py` (new)

```python
from collections import defaultdict
import time

class RateLimiter:
    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls = max_calls
        self.window = window_seconds
        self._calls: dict[str, list[float]] = defaultdict(list)
    
    def allow(self, key: str = "global") -> bool:
        now = time.monotonic()
        calls = self._calls[key]
        # Remove expired entries
        self._calls[key] = [t for t in calls if now - t < self.window]
        if len(self._calls[key]) >= self.max_calls:
            return False
        self._calls[key].append(now)
        return True
```

**Apply to these endpoints:**
| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/v1/leads/manual` | 10 | 60s |
| `POST /api/v1/scan` | 3 | 60s |
| `POST /api/v1/leads/{id}/generate` | 5 | 60s |
| `POST /api/v1/help/chat` | 20 | 60s |
| `POST /api/v1/ingest` | 5 | 60s |

### Task 6.2 — Sanitize job_id in file path construction

**File:** `api/routers/leads.py` — `get_lead_pdf` endpoint

**Fix:** Validate that `job_id` doesn't contain path traversal characters:

```python
import re

def _safe_job_id(job_id: str) -> str:
    """Validate job_id contains only safe characters."""
    if not re.match(r'^[a-zA-Z0-9_\-]{1,128}$', job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format")
    return job_id

@router.get("/leads/{job_id}/pdf")
async def get_lead_pdf(job_id: str, ...):
    job_id = _safe_job_id(job_id)
    # ... rest of handler
```

Apply `_safe_job_id()` to ALL endpoints that take `job_id` as a path parameter and use it in file operations.

### Task 6.3 — Fix temp file cleanup in ingestion

**File:** `api/routers/ingestion.py`

**Fix:** Use a context manager pattern that guarantees cleanup:

```python
import contextlib
import tempfile

@contextlib.contextmanager
def _temp_upload(file: UploadFile | None):
    """Safely write upload to temp file, guarantee cleanup."""
    if not file or not file.filename:
        yield None
        return
    
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    try:
        shutil.copyfileobj(file.file, tmp)
        tmp.close()
        yield tmp.name
    finally:
        with contextlib.suppress(OSError):
            os.unlink(tmp.name)

@router.post("/ingest")
async def ingest(raw: str = Form(""), file: UploadFile | None = File(None)):
    with _temp_upload(file) as pdf_path:
        profile = await _profile_service().ingest_resume(raw, pdf_path)
        # ...
```

### Task 6.4 — Validate file upload size

**File:** `api/routers/ingestion.py`

Add a file size check before writing to disk:

```python
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

@router.post("/ingest")
async def ingest(raw: str = Form(""), file: UploadFile | None = File(None)):
    if file and file.size and file.size > MAX_UPLOAD_SIZE:
        raise HTTPException(413, f"File too large (max {MAX_UPLOAD_SIZE // 1024 // 1024} MB)")
```

### Task 6.5 — Add SSRF protection for custom LLM base URLs

**File:** `llm/client.py`

Validate that `custom_base_url` doesn't point to internal addresses:

```python
from urllib.parse import urlparse
import ipaddress

_BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}

def _validate_base_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Invalid base URL: {url}")
    host = parsed.hostname or ""
    if host in _BLOCKED_HOSTS:
        raise ValueError(f"Cannot use localhost as LLM base URL: {url}")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback:
            raise ValueError(f"Cannot use private/loopback IP as LLM base URL: {url}")
    except ValueError:
        pass  # Not an IP, it's a hostname — OK
    return url
```

### Task 6.6 — Add input length validation to ManualLeadBody

**File:** `core/types.py`

The `text` field already has `max_length=20000`. But add a minimum content check:

```python
class ManualLeadBody(StrictBody):
    text: str = Field(default="", max_length=20000)
    url: str = Field(default="", max_length=2000)
    kind: Literal["job"] = "job"
    
    @model_validator(mode="after")
    def _validate_content(self):
        if not self.text.strip() and not self.url.strip():
            raise ValueError("Provide either text or a URL")
        return self
```

---

## Sprint 7 — Performance & Scalability (days 25-28) <a name="sprint-7"></a>

**Goal:** Handle 10,000+ leads without UI lag, reduce ghost mode broadcast noise, add pagination.  
**Fixes:** M4, L6 + performance findings  
**Risk:** Low-Medium

---

### Task 7.1 — Add pagination to lead list API

**File:** `api/routers/leads.py`

```python
@router.get("/leads")
async def list_leads(
    page: int = 1,
    limit: int = 200,
    beginner_only: bool = False,
    seniority: str | None = None,
    status: str | None = None,
    min_score: int | None = None,
):
    # ... existing filtering ...
    
    # Paginate
    total = len(jobs)
    start = (page - 1) * limit
    end = start + limit
    paginated = jobs[start:end]
    
    return {
        "items": paginated,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
    }
```

**IMPORTANT:** This is a BREAKING CHANGE for the frontend. Update `useLeads.ts` to expect the new response shape:

```typescript
const data = await r.json();
const items = Array.isArray(data) ? data : data.items; // Backward compatible
```

**Or:** Add a query parameter `?paginated=true` to opt into the new format while keeping the old format as default. Migrate frontend, then remove the old format.

### Task 7.2 — Batch ghost mode broadcasts

**File:** `api/scheduler.py`

Instead of broadcasting per-lead, batch progress updates:

```python
async def _ghost_tick(self):
    # ... scout phase ...
    
    # Evaluate in batches, broadcast progress every 10 leads
    batch_size = 10
    for i in range(0, len(discovered), batch_size):
        batch = discovered[i:i+batch_size]
        for lead in batch:
            # ... evaluate ...
            pass
        await cm.broadcast({
            "type": "agent",
            "event": "ghost_eval_progress",
            "msg": f"Evaluated {min(i+batch_size, len(discovered))}/{len(discovered)} leads",
        })
```

### Task 7.3 — Add virtual scrolling to PipelineView

**File:** `src/features/pipeline/PipelineView.tsx`

The current approach (`slice(0, visibleCount)` with "Show next 80" button) is functional but could be improved with `react-window`:

```bash
npm install react-window
```

```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={containerHeight}
  itemCount={activeTab.leads.length}
  itemSize={80}  // JobCard height
  width="100%"
>
  {({ index, style }) => (
    <div style={style}>
      <JobCard lead={activeTab.leads[index]} ... />
    </div>
  )}
</FixedSizeList>
```

**Alternative:** Keep the current pagination if users prefer it. Only switch to virtual scrolling if users report lag with 1000+ leads.

### Task 7.4 — Debounce search filter in PipelineView

**File:** `src/features/pipeline/PipelineView.tsx`

Add a 200ms debounce to the search input:

```typescript
const [searchInput, setSearchInput] = useState("");
const [search, setSearch] = useState("");

useEffect(() => {
  const timer = setTimeout(() => setSearch(searchInput), 200);
  return () => clearTimeout(timer);
}, [searchInput]);
```

### Task 7.5 — Memoize sorting in PipelineView

If sorting is expensive with 10K+ leads, memoize the sorted arrays independently:

```typescript
const sortedLeads = useMemo(
  () => sortLeads(leads.filter(keep), sort),
  [leads, sort, /* only the filters that affect this tab */]
);
```

Ensure each tab's leads are computed only when its specific filters change, not when any filter changes.

---

## Sprint 8 — Observability & Operational Readiness (days 29-32) <a name="sprint-8"></a>

**Goal:** Add structured logging, error tracking, health check enhancements, and startup diagnostics.  
**Fixes:** L3, M1 + operational readiness items  
**Risk:** Low

---

### Task 8.1 — Add structured logging

**File:** `core/logging.py`

Replace the basic logger with structured JSON logging:

```python
import json
import logging
import sys
import time


class StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "module": record.name,
            "msg": record.getMessage(),
        }
        # Add extra structured fields
        if hasattr(record, "domain"):
            entry["domain"] = record.domain
        if hasattr(record, "duration_ms"):
            entry["duration_ms"] = record.duration_ms
        if hasattr(record, "job_id"):
            entry["job_id"] = record.job_id
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(StructuredFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger
```

**Usage in domain services:**
```python
_log.info("Lead scored", extra={"domain": "ranking", "job_id": lead["job_id"], "duration_ms": elapsed_ms})
```

### Task 8.2 — Add timing decorator for service methods

**File:** `core/logging.py`

```python
import functools
import time

def timed(func):
    """Log execution time for service methods."""
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            result = await func(*args, **kwargs)
            elapsed = (time.perf_counter() - start) * 1000
            _log.info(f"{func.__qualname__} completed", extra={"duration_ms": round(elapsed, 1)})
            return result
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            _log.error(f"{func.__qualname__} failed: {exc}", extra={"duration_ms": round(elapsed, 1)})
            raise
    return wrapper
```

Apply to key service methods:
- `DiscoveryService.scan_job_boards()`
- `RankingService.evaluate_lead()`
- `GenerationService.generate_package()`
- `ProfileService.ingest_resume()`

### Task 8.3 — Enhance health check endpoint

**File:** `api/routers/health.py`

Add component health to the existing health endpoint:

```python
@router.get("/health")
async def health():
    from data.graph.connection import graph_available, graph_error
    from data.vector.connection import vec
    from data.sqlite.connection import connect, DEFAULT_DB_PATH
    
    # SQLite check
    sqlite_ok = True
    try:
        conn = connect(DEFAULT_DB_PATH)
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        sqlite_ok = False
    
    # Graph check
    graph_ok = graph_available()
    
    # Vector check
    vector_ok = hasattr(vec, "list_tables")
    
    return {
        "status": "alive" if (sqlite_ok and graph_ok) else "degraded",
        "uptime_seconds": round(time.monotonic() - started_at, 2),
        "components": {
            "sqlite": "ok" if sqlite_ok else "error",
            "graph": "ok" if graph_ok else f"error: {graph_error()}",
            "vector": "ok" if vector_ok else "unavailable",
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
```

### Task 8.4 — Make semantic scoring failure visible

**File:** `ranking/scoring_engine.py`

Instead of silently returning `None` when vector store fails, return a score with a note:

```python
def _semantic_criterion(jd: str, candidate_data: dict, weight: int) -> CriterionScore:
    try:
        from ranking.semantic import semantic_fit
        result = semantic_fit(jd, candidate_data=candidate_data)
    except Exception as exc:
        _log.warning("semantic scoring unavailable: %s", exc)
        return CriterionScore(
            name="semantic_match",
            score=0,
            weight=weight,
            reason="Semantic matching unavailable (vector store issue)",
        )
    # ... existing logic
```

This makes the scoring deterministic (always returns a score) and the issue visible in the score breakdown.

### Task 8.5 — Add local error log file

**File:** `core/telemetry.py` (already exists — enhance it)

Write unhandled exceptions to a local JSON file that users can share when reporting bugs:

```python
import json
import os
import traceback
from datetime import datetime, timezone

ERROR_LOG_PATH = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "JustHireMe",
    "errors.jsonl",
)

def log_error(exc: Exception, context: dict | None = None):
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "type": type(exc).__name__,
        "message": str(exc),
        "traceback": traceback.format_exc(),
        "context": context or {},
    }
    try:
        os.makedirs(os.path.dirname(ERROR_LOG_PATH), exist_ok=True)
        with open(ERROR_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
        # Rotate: keep last 500 errors
        _rotate_error_log()
    except Exception:
        pass  # Don't crash because of error logging

def _rotate_error_log(max_lines: int = 500):
    try:
        with open(ERROR_LOG_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) > max_lines:
            with open(ERROR_LOG_PATH, "w", encoding="utf-8") as f:
                f.writelines(lines[-max_lines:])
    except Exception:
        pass
```

### Task 8.6 — Add error boundary reporting to frontend

**File:** `src/shared/components/ErrorBoundary.tsx`

When an error is caught, POST it to a local error endpoint:

```typescript
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  // Send to local backend error log
  if (this.props.api) {
    this.props.api("/api/v1/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack,
        component: errorInfo.componentStack,
      }),
    }).catch(() => {});
  }
}
```

Add a corresponding `/api/v1/errors` endpoint that writes to the error log.

---

## Sprint 9 — Polish & Developer Experience (days 33-36) <a name="sprint-9"></a>

**Goal:** Deprecate `db/client.py`, complete TypedDicts, standardize errors, improve DX.  
**Fixes:** L2, M8, L5, L7 + DX improvements  
**Risk:** Low

---

### Task 9.1 — Add deprecation warning to `db/client.py`

**File:** `db/client.py` (top of file)

```python
import warnings

warnings.warn(
    "db.client is deprecated. Import from data.sqlite.leads, data.graph.profile, "
    "data.vector.embeddings, or data.repository instead.",
    DeprecationWarning,
    stacklevel=2,
)
```

This makes it visible in logs whenever old code imports from the facade.

### Task 9.2 — Update import boundary test to flag `db` imports from domain modules

**File:** `tests/test_import_boundaries.py`

Change `ALLOWED_IMPORTS` to remove `"db"` from domain packages:

```python
ALLOWED_IMPORTS = {
    "api": {"api", "automation", "core", "data", "discovery", "help", "llm", "profile", "ranking", "generation"},
    # Remove "db" from these:
    "automation": {"automation", "core", "data", "discovery", "llm"},
    "profile": {"automation", "core", "data", "llm", "profile"},
    "discovery": {"automation", "core", "data", "discovery", "llm"},
    "ranking": {"core", "data", "llm", "ranking"},
    "generation": {"core", "data", "generation", "llm"},
    # Only allow db from these legacy paths:
    "db": {"core", "data", "automation"},  # db/client.py itself can import from data/
}
```

This will fail if any domain module still imports from `db.client`. Fix those imports first.

### Task 9.3 — Complete the Lead TypedDict

**File:** `core/types.py`

Add all 39 columns from the SQLite schema:

```python
class Lead(TypedDict, total=False):
    # Identity
    job_id: str
    title: str
    company: str
    url: str
    platform: str
    kind: str
    
    # Status & scoring
    status: LeadStatus
    score: int
    reason: str
    match_points: list[str]
    gaps: list[str]
    
    # Signal intelligence
    signal_score: int
    signal_reason: str
    signal_tags: list[str]
    base_signal_score: int
    learning_delta: int
    learning_reason: str
    
    # Content
    description: str
    location: str
    urgency: str
    budget: str
    tech_stack: list[str]
    seniority_level: str
    
    # Outreach
    outreach_reply: str
    outreach_dm: str
    outreach_email: str
    proposal_draft: str
    fit_bullets: list[str]
    followup_sequence: list[str]
    proof_snippet: str
    
    # Assets
    asset_path: str
    resume_asset: str
    cover_letter_asset: str
    cover_letter_path: str
    selected_projects: list[str]
    keyword_coverage: dict
    resume_version: int
    
    # User interaction
    feedback: str
    feedback_note: str
    followup_due_at: str
    last_contacted_at: str
    contact_lookup: dict
    
    # Metadata
    source_meta: dict
    created_at: str
```

### Task 9.4 — Standardize frontend error messages

**File:** `src/shared/lib/errors.ts` (new)

```typescript
export function userFriendlyError(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof DOMException && err.name === "AbortError") return "";
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Cannot reach the backend. Is JustHireMe running?";
  }
  if (err instanceof Error) {
    if (err.message.includes("401")) return "Authentication failed. Restart JustHireMe.";
    if (err.message.includes("404")) return "Not found.";
    if (err.message.includes("409")) return "Operation already in progress.";
    if (err.message.includes("413")) return "File too large.";
    if (err.message.includes("429")) return "Too many requests. Please wait.";
    if (err.message.includes("500")) return "Server error. Check the activity log.";
    return err.message;
  }
  return fallback;
}
```

Use this in all `catch` blocks across the frontend.

### Task 9.5 — Move remaining target logic to `discovery/targets.py`

**File:** `discovery/targets.py` (currently 883 bytes)

Pull in the target-related functions that are currently in `core/config.py` or re-exported from there:
- `DEFAULT_JOB_TARGETS`
- `INDIA_JOB_TARGETS`
- `_BLOCKED_JOB_TARGET_MARKERS`
- `split_configured_targets()`
- `dedupe_targets()`
- `job_market_focus()`

If they're already properly accessible via `discovery.targets` (the router imports them from there), then `core/config.py` just needs a deprecation path.

### Task 9.6 — Add `CONTRIBUTING.md` with module guide

Create a contributor guide that explains:
- The module structure and dependency rule
- How to add a new feature (which module, how to wire it)
- How to run tests per-domain
- How the EventBus works
- How to add a new discovery source

---

## Dependency Map Between Sprints <a name="dependency-map"></a>

```
Sprint 1 (Kill Duplication)
    ↓
Sprint 2 (Concurrency & Data Safety)     Sprint 3 (Frontend Stability)
    ↓                                         ↓
Sprint 4 (EventBus Wiring)  ←───────────────┘
    ↓
Sprint 5 (Test Coverage)
    ↓
Sprint 6 (API Hardening)    Sprint 7 (Performance)
    ↓                            ↓
Sprint 8 (Observability) ←──────┘
    ↓
Sprint 9 (Polish & DX)
```

- **Sprint 1 MUST come first** — everything else assumes `agents/` is gone
- **Sprints 2 and 3 can run in parallel** — backend concurrency and frontend fixes are independent
- **Sprint 4 depends on Sprint 2** — EventBus wiring needs stable concurrency
- **Sprint 5 depends on Sprints 1-4** — tests should cover the new structure
- **Sprints 6 and 7 can run in parallel** — security and performance are independent
- **Sprint 8 depends on Sprint 6** — observability should cover the hardened API
- **Sprint 9 is last** — polish comes after stability

---

## Validation Checklist — How to Know You're Done <a name="validation-checklist"></a>

### After Sprint 1
- [ ] `find backend/agents -name "*.py"` returns nothing (directory deleted)
- [ ] `grep -r "from agents" backend/ --include="*.py"` returns nothing
- [ ] `pytest tests/test_import_boundaries.py` passes
- [ ] `pytest tests/ -q` — all tests pass, same or higher count

### After Sprint 2
- [ ] Two concurrent `POST /api/v1/scan` → one returns 409
- [ ] `PRAGMA journal_mode` returns `wal` after connection
- [ ] Profile ingest + lead evaluation running simultaneously doesn't crash
- [ ] Migration runs cleanly even if app starts twice simultaneously

### After Sprint 3
- [ ] WebSocket reconnects with increasing delay (visible in console)
- [ ] Close ApprovalDrawer during generation → no React warnings in console
- [ ] Update a lead via API → UI reflects immediately without 5-second delay
- [ ] Backend down for 30 seconds → frontend doesn't spam connection attempts

### After Sprint 4
- [ ] Domain services emit events without knowing about WebSocket
- [ ] Frontend still receives all real-time updates
- [ ] `cm.broadcast()` calls in routers reduced by 70%+

### After Sprint 5
- [ ] Frontend: `npm test` runs 20+ tests
- [ ] Backend: `pytest tests/ -q` runs 100+ tests
- [ ] CI reports coverage percentage
- [ ] CI runs linting (ruff, eslint)
- [ ] `test_regressions.py` deleted

### After Sprint 6
- [ ] Rate limiter rejects 11th manual lead in 60 seconds
- [ ] Job ID with `../` returns 400
- [ ] 15 MB file upload returns 413
- [ ] Custom LLM URL pointing to 127.0.0.1 is rejected
- [ ] Temp files are cleaned up even on crash (verify with exception injection)

### After Sprint 7
- [ ] `GET /api/v1/leads?page=1&limit=50` returns paginated response
- [ ] Ghost mode with 1000 leads produces <50 broadcasts (batched)
- [ ] PipelineView with 5000 leads renders without visible lag
- [ ] Search filter doesn't re-render on every keystroke

### After Sprint 8
- [ ] Logs are JSON-formatted with timestamps and modules
- [ ] `/health` reports component status (sqlite, graph, vector)
- [ ] Service method durations appear in logs
- [ ] Errors are written to `errors.jsonl`

### After Sprint 9
- [ ] Importing `db.client` produces a DeprecationWarning
- [ ] `test_import_boundaries.py` fails if a domain imports `db`
- [ ] Error messages in UI are consistent and user-friendly
- [ ] `CONTRIBUTING.md` exists and is accurate

---

## Timeline Summary

| Sprint | Days | Focus | Deliverable |
|---|---|---|---|
| 1 | 1-3 | Kill duplication | Clean module tree, no agents/ |
| 2 | 4-7 | Concurrency | Thread-safe data, locked scans |
| 3 | 8-11 | Frontend stability | No race conditions, proper cleanup |
| 4 | 12-15 | EventBus | Decoupled event flow |
| 5 | 16-20 | Tests | 100+ backend tests, 20+ frontend |
| 6 | 21-24 | Security | Rate limits, path safety, SSRF |
| 7 | 25-28 | Performance | Pagination, batching, debounce |
| 8 | 29-32 | Observability | Structured logs, health, error log |
| 9 | 33-36 | Polish | Deprecations, types, DX |

**Total: ~36 working days (~7-8 weeks)**

Each sprint produces a tagged release. Users benefit from every merged sprint — they don't have to wait for all 9.
