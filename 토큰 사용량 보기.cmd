@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller 토큰 사용량 (자동 갱신)
echo 이 창을 닫으면 자동 갱신이 멈춥니다.
node tools\usage-report\build.mjs --serve --open
if errorlevel 1 pause
