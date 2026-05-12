# Maintainer Release Checklist

Use this before cutting a public release or sharing a build link.

For the full production release plan, see [Production Release Roadmap](PRODUCTION_RELEASE_ROADMAP.md).

## Required Checks

- [ ] `npm ci`
- [ ] `npm run version:check`
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
- [ ] Release notes include SHA256 checksums for uploaded installer assets.
- [ ] Tauri capabilities remain narrow; frontend code should not receive broad shell execution permissions.
- [ ] The bundled sidecar listens on `127.0.0.1` and requires the runtime token for HTTP and WebSocket access.

## Release Flow

1. Update versions with `npm run version:bump -- X.Y.Z`.
2. Run the required checks above.
3. Create a tag like `v0.1.0`.
4. For a quick local smoke test, run `npm run release:smoke` and launch `src-tauri/target/release/justhireme.exe`.
5. For the standard Windows installer, run `npm run release:windows`.
6. Push the tag and let the release workflow build and publish the GitHub Release from CI.
7. Download and smoke-test the GitHub-built installer before sharing the release link widely.
