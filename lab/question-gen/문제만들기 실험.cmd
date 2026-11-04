@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
title Recaller 문제 만들기 실험
echo 문제 만들기 실험: 지난 실행의 카드로 OX·객관식·빈칸을 만들고 비교합니다. (모두 luna, 만들기만 호출 약 190번, 3~5분)
echo 3000·3002 서버와 엔진 파일은 건드리지 않습니다. 결과는 lab\question-gen\out\ 에 남습니다.
echo.
node --experimental-strip-types --no-warnings lab\question-gen\run.ts
echo.
pause
