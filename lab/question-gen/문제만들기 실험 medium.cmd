@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
title Recaller 문제 만들기 실험 (luna medium)
echo 문제 만들기 실험 P3, luna 추론 강도 medium. 결과는 lab\question-gen\out\ 에 남습니다.
echo.
set QG_EFFORT=medium
node --experimental-strip-types --no-warnings lab\question-gen\run.ts
echo.
pause
