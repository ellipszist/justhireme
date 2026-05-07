# Maintainer Release Checklist

Use this before cutting a public release or sharing a build link.

## Required Checks

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd backend && uv sync --dev`
- [ ] `cd backend && uv run python -m pytest tests/test_regressions.py tests/test_api.py::TestAuthGate`
- [ ] `cd src-tauri && cargo check`

## Privacy And Safety

- [ ] No `.env`, API keys, cookies, bearer tokens, private resumes, generated PDFs, local databases, graph stores, vector stores, or packaged sidecar binaries are committed.
- [ ] Browser automation and auto-apply behavior is documented as experimental and opt-in.
- [ ] Release notes describe JustHireMe as local-first and do not imply a hosted backend.
- [ ] Tauri capabilities remain narrow; frontend code should not receive broad shell execution permissions.
- [ ] The bundled sidecar listens on `127.0.0.1` and requires the runtime token for HTTP and WebSocket access.

## Release Flow

1. Update versions in `package.json`, `backend/pyproject.toml`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run the required checks above.
3. Create a tag like `v0.1.0`.
4. For a quick local smoke test, run `npm run package:fast` and launch `src-tauri/target/release/justhireme.exe`.
5. For the standard Windows installer, run `npm run package:windows`.
6. Push the tag and let the release workflow build a draft release.
7. Download and smoke-test the installer before publishing the draft.
