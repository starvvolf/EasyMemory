@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller 엔진 실험 서버 (3002)
node scripts\run-engine-lab.mjs
echo.
echo 엔진 실험 서버가 끝났어요. 이유는 tmp\engine-lab.log 에 있어요.
pause
