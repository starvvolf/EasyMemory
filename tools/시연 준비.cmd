@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title Recaller 시연 준비
echo [1/2] 알고리즘 · 기억을 시연 전 상태로 되돌려요
node scripts\demo-state.mjs restore algo
echo.
echo [2/2] 실습(FPS) 시연용 실습을 처음 상태로 되돌려요
rem 11/13: 실습 서버가 꺼져 있거나 켜지는 중이면 되돌리기가 조용히 안 됐다 — 켜질 때까지 기다리고, 안 되면 크게 알린다
set TRY=0
:wait
curl -s -o nul http://127.0.0.1:4100/api/dev/demo && goto reset
set /a TRY+=1
if %TRY% GEQ 30 goto fail
echo    실습 서버가 켜지기를 기다려요... (%TRY%/30)
timeout /t 2 /nobreak >nul
goto wait
:reset
curl -s -f -X POST http://127.0.0.1:4100/api/dev/demo/reset -H "Content-Type: application/json" -d "{\"name\":\"fps\"}" || goto fail
echo.
echo    실습 되돌리기 완료
goto done
:fail
echo.
echo    !!! 실습을 되돌리지 못했어요. Recaller 앱(실습 서버 4100)이 켜져 있는지 보고 이 파일을 다시 실행해 주세요.
:done
echo.
echo.
echo 끝났어요. 앱 화면에서 F5(새로고침)를 한 번 눌러 주세요.
pause
