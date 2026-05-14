!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running JustHireMe processes before upgrade..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM justhireme.exe /T /F'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM backend.exe /T /F'
  Sleep 2000

  ClearErrors
  Delete "$INSTDIR\backend.exe"
  IfErrors 0 jhm_backend_unlocked
  DetailPrint "backend.exe is still locked; retrying..."
  Sleep 1500
  ClearErrors
  Delete "$INSTDIR\backend.exe"
  IfErrors 0 jhm_backend_unlocked
  Sleep 2500
  ClearErrors
  Delete "$INSTDIR\backend.exe"
  IfErrors 0 jhm_backend_unlocked
  DetailPrint "backend.exe could not be removed before copy; installer will report the remaining lock."

  jhm_backend_unlocked:
!macroend
