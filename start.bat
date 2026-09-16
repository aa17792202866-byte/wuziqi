@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js and try again.
  pause
  exit /b 1
)
node server.js
pause
