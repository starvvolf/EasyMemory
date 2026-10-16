@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\recaller-stop.mjs
if errorlevel 1 (pause) else (timeout /t 5)
