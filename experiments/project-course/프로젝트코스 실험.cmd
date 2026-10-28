@echo off
chcp 65001 >nul
rem 검은 창은 작업 표시줄로 내려 둔다(닫으면 코스가 꺼지니까 눈앞에서 치움). 공부는 VS Code에서 한다.
if not "%~1"=="min" ( start "Recaller course" /min cmd /c ""%~f0" min" & exit /b )
cd /d "%~dp0"
title Recaller 코스 - 이 창을 닫으면 꺼져요 (4100)
node -e "const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  start "Recaller" cmd /c "echo Node.js 22.13 이상이 필요해요. & node -v & pause"
  exit /b 1
)
rem 이 실험 전용 포트(4100 코스, 4101 실습, 4102 검사)에 남은 이전 서버만 끈다. 3000·3002 앱 서버는 건드리지 않는다.
rem netstat는 한국어 Windows에서 상태가 "수신 대기"로 나와서, 언어와 상관없는 PowerShell로 찾는다.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort 4100,4101,4102 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('stop old course server, PID ' + $_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 1 >nul
rem 서버가 켜지면 VS Code를 연다(하던 코스가 있으면 그 폴더, 없으면 코스 정하기). VS Code가 없으면 브라우저로.
set PC_OPEN=1
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON server\main.ts
if errorlevel 1 (
  start "Recaller" cmd /c "echo 코스 프로그램이 켜지지 않았어요. 작업 표시줄의 Recaller 창을 눌러 내용을 확인해 주세요. & pause"
  pause
)
