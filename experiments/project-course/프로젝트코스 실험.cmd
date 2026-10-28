@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller 프로젝트 코스 실험 (4100)
node -e "const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js 22.13 이상이 필요해요. 지금 버전:
  node -v
  pause
  exit /b 1
)
rem 이 실험 전용 포트(4100 코스, 4101 실습, 4102 검사)에 남은 이전 서버만 끈다. 3000·3002 앱 서버는 건드리지 않는다.
rem netstat는 한국어 Windows에서 상태가 "수신 대기"로 나와서, 언어와 상관없는 PowerShell로 찾는다.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort 4100,4101,4102 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('stop old course server, PID ' + $_); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 1 >nul
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4100"
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON server\main.ts
if errorlevel 1 pause
