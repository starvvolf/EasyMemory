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
for %%P in (4100 4101 4102) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%%P  *[0-9.:*]*  *LISTENING"') do (
    echo %%P번 포트에 남아 있던 이전 서버^(PID %%a^)를 끕니다.
    taskkill /PID %%a /F >nul 2>&1
  )
)
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4100"
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON server\main.ts
if errorlevel 1 pause
