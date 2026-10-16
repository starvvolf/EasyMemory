@echo off
cd /d "%~dp0"
node scripts\open-study-forge-local.mjs
if errorlevel 1 (
  echo Could not open Study Forge. Check the message above.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3000/mcp-runs"
