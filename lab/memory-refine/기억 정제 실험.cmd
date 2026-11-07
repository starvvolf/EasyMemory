@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
title Recaller 기억 정제 실험
echo 기억 정제 실험: AI 힌트·설명 예시 8개를 배운 것 카드로 정리하고 코드로 점검합니다. (terra low 8번, 약 20초)
echo 앱 데이터와 3000 서버는 건드리지 않습니다. 결과는 lab\memory-refine\out\ 에 남습니다.
echo.
node --experimental-strip-types --no-warnings lab\memory-refine\run.ts
echo.
pause
