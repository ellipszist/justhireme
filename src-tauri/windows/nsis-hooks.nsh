!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running JustHireMe processes before upgrade..."
  nsExec::ExecToLog 'taskkill /IM justhireme.exe /T /F'
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process backend -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"$INSTDIR\*\" } | Stop-Process -Force"'
  Sleep 1000
!macroend
