@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller PS 실험 서버 (3003)
node scripts\run-lab.mjs --name ps --port 3003 --seed --env RECALLER_PS_TRAIN=1 --env RECALLER_PS_WATCH=1
echo.
echo PS 실험 서버가 끝났어요. 이유는 tmp\lab-ps.log 에 있어요.
pause
