; NSIS installer hooks for ninesixteen.video
;
; Auto-register the softcam DirectShow filter at install time so the
; "ninesixteen.video" virtual camera shows up in other apps (Zoom, Meet, OBS,
; Chrome) with zero manual setup, and unregister it on uninstall.
;
; softcam.dll is 64-bit, but the NSIS process is 32-bit, so we must invoke the
; native 64-bit regsvr32 via $WINDIR\Sysnative (not $SYSDIR, which would be
; redirected to the 32-bit SysWOW64\regsvr32 and fail to register a 64-bit DLL).
;
; Registration writes to HKEY_CLASSES_ROOT, which requires elevation — provided
; by the perMachine install mode configured in tauri.conf.json.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the ninesixteen.video virtual camera..."
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /s "$INSTDIR\softcam\softcam.dll"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the ninesixteen.video virtual camera..."
  ExecWait '"$WINDIR\Sysnative\regsvr32.exe" /s /u "$INSTDIR\softcam\softcam.dll"'
!macroend
