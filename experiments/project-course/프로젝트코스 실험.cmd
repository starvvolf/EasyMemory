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
start "" cmd /c "timeout /t 2 >/dev/null & start http://127.0.0.1:4100"
node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON server\main.ts
if errorlevel 1 pause
