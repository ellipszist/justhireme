!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running JustHireMe processes before upgrade..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM justhireme.exe /T /F'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM jhm-sidecar-next.exe /T /F'
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM backend.exe /T /F'
  Sleep 2000

  ClearErrors
  Delete "$INSTDIR\jhm-sidecar-next.exe"
  Delete "$INSTDIR\jhm-sidecar-next*.exe"
  Delete "$INSTDIR\backend.exe"
  RMDir /r "$INSTDIR\_internal"
  RMDir /r "$INSTDIR\resources\sidecar-internal"
  RMDir /r "$INSTDIR\resources\backend\_internal"
  DetailPrint "Retrying bundled backend cleanup..."
  Sleep 1500
  ClearErrors
  Delete "$INSTDIR\jhm-sidecar-next.exe"
  Delete "$INSTDIR\jhm-sidecar-next*.exe"
  Delete "$INSTDIR\backend.exe"
  RMDir /r "$INSTDIR\_internal"
  RMDir /r "$INSTDIR\resources\sidecar-internal"
  RMDir /r "$INSTDIR\resources\backend\_internal"
  Sleep 2500
  ClearErrors
  Delete "$INSTDIR\jhm-sidecar-next.exe"
  Delete "$INSTDIR\jhm-sidecar-next*.exe"
  Delete "$INSTDIR\backend.exe"
  RMDir /r "$INSTDIR\_internal"
  RMDir /r "$INSTDIR\resources\sidecar-internal"
  RMDir /r "$INSTDIR\resources\backend\_internal"
  DetailPrint "Bundled backend cleanup complete."
!macroend
