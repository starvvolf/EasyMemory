@echo off
rem 실험 자료 비우기: 실습 자료(대화 · 목표 · 학습자 메모리)와, 앱이 꺼져 있으면 앱 자료(기억)도 보관으로 옮긴다. 지우지 않는다.
cd /d "%~dp0"
node tools\reset-data.mjs %*
pause
