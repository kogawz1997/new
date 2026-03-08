@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-easy.ps1"
if errorlevel 1 (
  echo.
  echo [setup] Failed. Please check the error above.
  exit /b 1
)
echo.
echo [setup] Done.
exit /b 0

