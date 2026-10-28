@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller 엔진 실험 서버 (3002)
node scripts\run-engine-lab.mjs
if errorlevel 1 pause
