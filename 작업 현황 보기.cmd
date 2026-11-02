@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller 작업 현황
echo 작업 현황: 누가 어느 파일을 고치는 중인지 구조도 위에 보여 줍니다. (토큰 사용량 보기와 같은 창, 탭만 다름)
node tools\usage-report\build.mjs --serve --open --tab work
if errorlevel 1 pause
