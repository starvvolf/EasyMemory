@echo off
chcp 65001 >nul
rem 토론방: Recaller 서버가 켜져 있으면 바로 열고, 아니면 먼저 켜요.
cd /d "%~dp0"
curl -s -o nul http://127.0.0.1:3000/room || node scripts\recaller-start.mjs --no-open
start "" http://127.0.0.1:3000/room
