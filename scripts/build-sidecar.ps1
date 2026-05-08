$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$repoRoot = (Get-Location).Path
$env:UV_CACHE_DIR = Join-Path $repoRoot "backend\.uv-cache"
$env:PYTHONNOUSERSITE = "1"
$env:PYINSTALLER_CONFIG_DIR = Join-Path $repoRoot "backend\.pyinstaller-cache"
$env:HF_HOME = Join-Path $repoRoot "backend\.hf-cache"

Write-Host "Building Python sidecar..."
Remove-Item -Path (Join-Path $repoRoot "src-tauri\resources\backend") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $repoRoot "src-tauri\resources\backend.exe") -Force -ErrorAction SilentlyContinue
Set-Location backend
uv run pyinstaller backend.spec --distpath ..\src-tauri\resources\backend --noconfirm --clean
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}
Set-Location ..

$triple = (rustc -vV | Select-String "host:").ToString().Split()[1].Trim()
if ($LASTEXITCODE -ne 0) {
  throw "rustc failed with exit code $LASTEXITCODE"
}
$src = "src-tauri\resources\backend\backend.exe"
$dst = "src-tauri\resources\backend\jhm-sidecar-$triple.exe"
if (-not (Test-Path $src)) {
  throw "Expected sidecar was not created: $src"
}
Copy-Item $src $dst -Force
Write-Host "Sidecar ready: $dst"
