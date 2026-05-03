$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Building Python sidecar..."
Set-Location backend
uv run pyinstaller backend.spec --distpath ..\src-tauri\resources --noconfirm
Set-Location ..

$triple = (rustc -vV | Select-String "host:").ToString().Split()[1].Trim()
$src = "src-tauri\resources\backend\backend.exe"
$dst = "src-tauri\resources\backend\backend-$triple.exe"
Copy-Item $src $dst -Force
Write-Host "Sidecar ready: $dst"
