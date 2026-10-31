@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller 토큰 사용량
node tools\usage-report\build.mjs --open
if errorlevel 1 pause
