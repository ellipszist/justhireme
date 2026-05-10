# Parallel Build Roadmap

**Goal:** Fastest possible end-to-end build from source to distributable installer.

---

## Current Pipeline (Mostly Sequential)

```
tauri build
  ├─ beforeBuildCommand: "npm run build"
  │    └─ build-frontend.mjs runs tsc + vite in parallel  ✓ already parallel
  │
  ├─ cargo build --release (Rust shell)                    ← BOTTLENECK #1
  │    waits for frontend to finish first
  │
  └─ NSIS/MSI bundler                                      ← sequential, after Rust

PyInstaller (backend sidecar)                              ← BOTTLENECK #2
  must be run manually, completely separate
  not wired into tauri build at all
```

**The problem:** Rust compilation and PyInstaller are the two slowest steps, and nothing runs them in parallel. The frontend is already parallelized (tsc ‖ vite) but it's the fastest step anyway. NSIS bundling is inherently sequential (needs the Rust binary), so it can't be moved earlier.

---

## Target Pipeline (Maximum Parallelism)

```
Time ──────────────────────────────────────────────────────►

Lane 1:  [tsc --noEmit]──┐
                          ├─ (both ~3-5s)
Lane 2:  [vite build]────┘

Lane 3:  [cargo build --release]────────────────────┐
         (starts IMMEDIATELY, no frontend dep)       │
                                                     ├─► [NSIS bundle]
Lane 4:  [PyInstaller --onefile]────────────────────┘
         (starts IMMEDIATELY, fully independent)     │
                                                     └─► copies sidecar into
                                                         src-tauri/resources/
```

All four lanes start at t=0. The final bundle step waits for lanes 2 + 3 + 4. Total wall time = max(Rust compile, PyInstaller) + NSIS packaging.

---

## Phase 1: Wire PyInstaller into the Parallel Pipeline

**Why:** Right now building the sidecar is a manual step outside the build system. This is the single biggest structural gap — you can't parallelize what isn't automated.

**What to do:**

1. Create `scripts/build-sidecar.mjs` (or `.ps1`) that runs PyInstaller:

```js
// scripts/build-sidecar.mjs
import { execSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const backendDir = join(import.meta.dirname, "..", "backend");
const targetDir = join(import.meta.dirname, "..", "src-tauri", "resources", "backend");

execSync(
  `${process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python"} -m PyInstaller backend.spec --noconfirm`,
  { cwd: backendDir, stdio: "inherit" }
);

mkdirSync(targetDir, { recursive: true });
cpSync(
  join(backendDir, "dist", "backend.exe"),
  join(targetDir, "jhm-sidecar-x86_64-pc-windows-msvc.exe")
);
```

2. Add a `"build:sidecar"` script to `package.json`:

```json
"build:sidecar": "node scripts/build-sidecar.mjs"
```

3. Update `scripts/run-parallel.mjs` with a new `"release"` group that runs everything:

```js
"release": [
  ["frontend build", npm, ["run", "build"]],
  ["sidecar build", npm, ["run", "build:sidecar"]],
  ["rust build", "cargo", ["build", "--release"], { cwd: "src-tauri" }],
],
```

4. After the parallel step completes, run `tauri build --no-bundle` (skip re-compilation) followed by the bundler, or just run the NSIS bundler directly.

**Expected gain:** PyInstaller and Rust now overlap. If both take ~60s, you save ~60s of wall time.

---

## Phase 2: Decouple Frontend from Rust Compilation

**Why:** Tauri's `beforeBuildCommand` runs `npm run build` and blocks the entire Rust compilation until the frontend finishes. But `cargo build` doesn't need the frontend assets until the final link step — it only needs the Rust source code.

**What to do:**

1. Remove `beforeBuildCommand` from `tauri.conf.json` (or set it to an empty string / `"echo skip"`):

```json
"build": {
  "beforeBuildCommand": "",
  "frontendDist": "../dist"
}
```

2. In your release script, start all three in parallel and only invoke the NSIS bundler after all finish:

```
[parallel]
  ├─ npm run build          (tsc ‖ vite → produces dist/)
  ├─ cargo build --release  (produces target/release/justhireme.exe)
  └─ npm run build:sidecar  (produces jhm-sidecar.exe)

[sequential, after all above]
  └─ tauri build --no-bundle   ← or just run the NSIS bundler directly
```

The key insight: `cargo build --release` compiles all Rust crates and only needs `dist/` at the very end when it embeds the frontend assets. By starting cargo early, it compiles dependencies while vite runs.

**Expected gain:** ~3-5 seconds saved (frontend build time no longer blocks Rust start). Small but free.

---

## Phase 3: Speed Up Rust Compilation

**Why:** Even with parallelism, Rust release builds are the likely critical path. Optimizing the Rust compile itself directly reduces total wall time.

**What to do (in order of impact):**

### 3a. Use a faster linker

The default MSVC linker is slow. Switch to `lld`:

Create or update `.cargo/config.toml` at the repo root:

```toml
[target.x86_64-pc-windows-msvc]
linker = "lld-link"
```

Install it: `cargo install -f cargo-binutils` and `rustup component add llvm-tools`. Or use `mold` on Linux.

**Expected gain:** 20–40% faster link step.

### 3b. Tune release profile for build speed

In `src-tauri/Cargo.toml`, add:

```toml
[profile.release]
codegen-units = 4        # default is 1 for release (max optimization)
                         # 4 parallelizes codegen with slight size tradeoff
lto = "thin"             # much faster than fat LTO, nearly as good
incremental = true       # enables incremental even in release mode
```

**Tradeoff:** Binary may be ~5-10% larger. Runtime perf difference is negligible for a Tauri shell that mostly spawns a sidecar.

**Expected gain:** 30-50% faster release builds, especially incremental rebuilds.

### 3c. Cache Rust dependencies with `sccache`

```bash
cargo install sccache
```

Add to `.cargo/config.toml`:

```toml
[build]
rustc-wrapper = "sccache"
```

Caches compiled crates across builds. Massive win for CI and fresh rebuilds where dependencies haven't changed.

**Expected gain:** Near-instant dependency compilation on cache hit (saves 50-80% on full rebuild).

---

## Phase 4: Speed Up PyInstaller

**Why:** PyInstaller's `--onefile` mode is notoriously slow because it compresses everything into a single executable then extracts at runtime. It's likely the other bottleneck on your critical path.

**What to do (pick one or combine):**

### 4a. Use `--onedir` mode instead of `--onefile`

Change the spec file to produce a directory bundle instead of a single file. Bundle the entire directory into the NSIS installer (Tauri supports `externalBin` pointing to a directory).

**Expected gain:** 2-3x faster PyInstaller build (skips the expensive UPX compression + archive step). Also faster app startup since the sidecar doesn't need to self-extract.

### 4b. Aggressive exclusions

Your spec already excludes torch, sklearn, etc. Add more:

```python
excludes=[
    # already excluded
    'torch', 'sklearn', 'scipy', 'transformers', 'sentence_transformers',
    'tkinter', 'matplotlib', 'PIL', 'cv2', 'pytest', 'tensorboard',
    # add these
    'IPython', 'notebook', 'jupyter', 'docutils', 'sphinx',
    'setuptools', 'pip', 'wheel', 'pkg_resources',
    'unittest', 'pydoc', 'xmlrpc', 'lib2to3',
]
```

**Expected gain:** Smaller binary, faster compression, fewer files to analyze.

### 4c. Pre-warm PyInstaller cache

PyInstaller caches analysis results in `__pycache__` and its own cache dir. On incremental builds, ensure the cache dir (`--workpath`) persists between builds:

```bash
pyinstaller backend.spec --noconfirm --workpath=build_cache
```

**Expected gain:** 50%+ faster on incremental rebuilds.

---

## Phase 5: Orchestrate the Full Release Build

**Why:** Phases 1-4 optimize individual steps. This phase wires them into a single `npm run release` command.

**What to do:**

1. Add to `scripts/run-parallel.mjs`:

```js
"release": [
  ["frontend",  npm, ["run", "build"]],
  ["sidecar",   npm, ["run", "build:sidecar"]],
  ["rust",      "cargo", ["build", "--release"], { cwd: "src-tauri" }],
],
```

2. Add to `package.json`:

```json
"release": "node scripts/run-parallel.mjs release && npm run tauri build --no-bundle -- --bundles nsis",
"release:fast": "node scripts/run-parallel.mjs release"
```

3. `release:fast` gives you the compiled artifacts without NSIS packaging (good for testing). `release` produces the installer.

**Final pipeline timing estimate:**

| Step | Current (sequential) | After optimization |
|---|---|---|
| tsc + vite | ~5s | ~5s (parallel, overlapped) |
| Rust release build (cold) | ~90-120s | ~45-60s (thin LTO + codegen-units + lld) |
| Rust release build (warm) | ~90-120s | ~10-20s (incremental + sccache) |
| PyInstaller | ~60-90s | ~30-45s (onedir + exclusions + cache) |
| NSIS packaging | ~15s | ~15s (can't parallelize) |
| **Total (cold)** | **~180-250s** | **~60-80s** |
| **Total (warm/incremental)** | **~180-250s** | **~30-40s** |

The cold build goes from ~4 minutes sequential to ~1 minute parallel. Warm/incremental builds drop to under a minute because sccache + incremental Rust + PyInstaller cache make the two bottlenecks near-instant.

---

## Phase 6: CI/CD Pipeline (When You Add GitHub Actions)

**Why:** You don't have CI yet. When you add it, the same parallelism principles apply but with matrix builds across platforms.

**What to do:**

```yaml
# .github/workflows/release.yml  (sketch)
jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4

      # Cache everything
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
            backend/build_cache
          key: ${{ runner.os }}-build-${{ hashFiles('**/Cargo.lock', '**/pyproject.toml') }}

      # All three build steps in parallel using your existing script
      - run: npm ci
      - run: npm run release

      # Upload artifacts
      - uses: actions/upload-artifact@v4
```

**Key wins for CI:**
- Matrix builds give you Windows/Linux/macOS in parallel (3 machines, same wall time as 1)
- Cargo + PyInstaller caches persist across CI runs
- sccache can be backed by GitHub Actions cache or S3

---

## Quick Reference: Priority Order

| Priority | Phase | Effort | Wall-time Saved |
|---|---|---|---|
| 1 | Phase 1 — Wire PyInstaller into parallel pipeline | ~1 hour | ~60s |
| 2 | Phase 3b — Release profile tuning (thin LTO, codegen-units) | ~5 min | ~30-40s |
| 3 | Phase 2 — Decouple frontend from Rust | ~15 min | ~5s |
| 4 | Phase 3a — Faster linker (lld) | ~15 min | ~10-20s |
| 5 | Phase 4a — PyInstaller onedir mode | ~30 min | ~30s |
| 6 | Phase 3c — sccache | ~10 min | ~50-80s on cache hit |
| 7 | Phase 5 — Orchestration script | ~30 min | Ergonomics, not speed |
| 8 | Phase 6 — CI/CD | ~2 hours | Platform parallelism |

Phases 1 + 3b alone (< 1.5 hours of work) get you the majority of the speedup.

---

*Roadmap drafted May 10, 2026. No code changes made.*
