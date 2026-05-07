# Windows Release Checklist

The first public release target is a Windows desktop installer.

## Build

```powershell
npm install
cd backend
uv sync --dev
cd ..
.\scripts\build-sidecar.ps1
npm run package:windows
```

The standard Windows release build now produces only the NSIS installer. This keeps local release testing fast enough to use regularly.

| Artifact | Use |
| --- | --- |
| `src-tauri/target/release/bundle/nsis/JustHireMe_0.1.5_x64-setup.exe` | Recommended public download for testers |
| `src-tauri/target/release/justhireme.exe` | Unbundled release executable for local smoke tests |

For the fastest release smoke test, skip installer generation:

```powershell
npm run package:fast
.\src-tauri\target\release\justhireme.exe
```

Build MSI only when you specifically need managed Windows deployment:

```powershell
npm run package:windows:msi
```

Build both NSIS and MSI only for a full compatibility release:

```powershell
npm run package:windows:all
```

For the alpha installer, the bundled Python sidecar intentionally excludes the experimental browser automation stack and heavyweight local embedding model packages. The supported release smoke path is app launch, settings, profile/lead workflows, deterministic ranking, and document/outreach generation. Semantic matching should fail soft when local embedding packages are unavailable.

## Smoke Test

- Install on a clean Windows machine or VM.
- Open the app without developer tools.
- Enter a local/Ollama or API provider setting.
- Import a profile or resume.
- Run a scan.
- Verify leads show signal, fit, and quality explanations.
- Generate resume PDF, cover letter PDF, and outreach drafts.
- Confirm experimental browser automation is not presented as the primary workflow.

## Release Notes

Mention that browser automation is experimental. The supported workflow is scraper, ranker, vector matching, and customization.
Mention whether the build is the alpha slim installer or a future full-ML installer.
