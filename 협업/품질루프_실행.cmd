@echo off
rem 품질 루프 실행기 (작업지시 19). Codex가 한 바퀴 하고 끝나면 30분 쉬고 다시 돈다.
rem 멈추기: RecallerData\품질루프\STOP 파일을 만들거나 이 창을 닫는다.
rem 처음 한 번: 작업지시 19의 "0. 준비"를 Codex에게 먼저 시킨다. codex exec 옵션은 이 PC의 Codex CLI에 맞게 0단계에서 확인한다.
chcp 65001 >nul
cd /d "%~dp0.."
if "%STUDY_FORGE_DATA_DIR%"=="" set "STUDY_FORGE_DATA_DIR=%~dp0..\..\RecallerData"
:loop
if exist "%STUDY_FORGE_DATA_DIR%\품질루프\STOP" goto stop
echo [%date% %time%] 한 바퀴 시작
codex exec --full-auto "협업/작업지시_19_출제품질_자동루프.md 의 '한 바퀴'를 정확히 한 번 수행하고 끝내라. 상태 파일은 %STUDY_FORGE_DATA_DIR%\품질루프\ 에 있다."
echo [%date% %time%] 한 바퀴 끝 · 30분 쉼
timeout /t 1800 /nobreak >nul
goto loop
:stop
echo STOP 파일이 있어 멈췄어요.
pause
