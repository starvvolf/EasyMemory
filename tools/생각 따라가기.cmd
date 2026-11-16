@echo off
chcp 65001 >nul
cd /d "%~dp0.."
rem 알고리즘 풀이 기록 하나를 ChatGPT에 한 번 보내, 질문 · 제출한 순간마다 그때 생각을 따라가며 추론하게 해요(AI 1번 사용).
rem 문제 id를 주지 않으면 바이러스(cp_20ef08b5115a). 결과: tools\thought-trace\out\
node --experimental-strip-types --disable-warning=ExperimentalWarning tools\thought-trace\run.ts %*
pause
