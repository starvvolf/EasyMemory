@echo off
chcp 65001 >nul
rem 코스 서버를 계속 켜 둔다(11/3). 꺼지면 다시 켜고, 원격 세션이 .data\control\restart를 건드리면 새 코드로 다시 켠다.
rem VS Code는 열지 않는다. 이 창을 닫으면 지킴이와 코스 서버가 같이 꺼진다. 3000 앱은 건드리지 않는다.
cd /d "%~dp0"
if not "%~1"=="min" (
  start "Recaller 코스 지킴이" /min cmd /c ""%~f0" min"
  exit /b
)
title Recaller 코스 지킴이 - 닫으면 코스 서버도 꺼져요 (4100)
node tools\keeper.mjs
pause
