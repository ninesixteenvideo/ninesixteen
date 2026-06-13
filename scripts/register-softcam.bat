@echo off
setlocal

REM One-time setup: register softcam.dll as a DirectShow camera so other
REM apps can see "ninesixteen.video" in their camera device lists.
REM Right-click this file → Run as administrator.

set "ROOT=%~dp0.."
set "DLL=%ROOT%\apps\desktop\src-tauri\resources\softcam\softcam.dll"
set "INSTALLER=%ROOT%\third_party\softcam\examples\softcam_installer\x64\Release\softcam_installer.exe"

if not exist "%DLL%" (
  echo softcam.dll not found. Run: node scripts/fetch-softcam.mjs
  exit /b 1
)

if not exist "%INSTALLER%" (
  echo softcam_installer.exe not found. Run: node scripts/fetch-softcam.mjs
  exit /b 1
)

echo Registering ninesixteen.video virtual camera...
echo DLL: %DLL%
echo.

"%INSTALLER%" register "%DLL%"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Registration failed. Make sure you ran this batch file as Administrator.
  exit /b 1
)

echo.
echo Done. Restart ninesixteen, then choose ninesixteen.video wherever you pick a camera device.
pause
