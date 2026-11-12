@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title Recaller 시연 준비
echo [1/2] 알고리즘 · 기억을 시연 전 상태로 되돌려요
node scripts\demo-state.mjs restore algo
echo.
echo [2/2] 실습(FPS) 시연용 실습을 처음 상태로 되돌려요
curl -s -X POST http://127.0.0.1:4100/api/dev/demo/reset -H "Content-Type: application/json" -d "{\"name\":\"fps\"}"
echo.
echo.
echo 끝났어요. 앱 화면에서 F5(새로고침)를 한 번 눌러 주세요.
pause
