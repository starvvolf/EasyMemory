@echo off
rem 품질 루프 실행기 (작업지시 19). Codex가 한 바퀴 하고 끝나면 30분 쉬고 다시 돈다.
rem 멈추기: RecallerData\품질루프\STOP 파일을 만들거나 이 창을 닫는다.
rem 처음 한 번: 작업지시 19의 "0. 준비"를 Codex에게 먼저 시킨다. codex exec 옵션은 이 PC의 Codex CLI에 맞게 0단계에서 확인한다.
chcp 65001 >nul
cd /d "%~dp0.."
for %%I in ("%CD%") do set "QUALITY_WORKSPACE=%%~nxI"
if /i not "%QUALITY_WORKSPACE%"=="EasyMemory-quality" (
  echo EasyMemory-quality 작업 폴더에서만 실행할 수 있어요.
  exit /b 1
)
set "PORT=3100"
if "%STUDY_FORGE_DATA_DIR%"=="" set "STUDY_FORGE_DATA_DIR=%~dp0..\..\RecallerData"
:loop
if exist "%STUDY_FORGE_DATA_DIR%\품질루프\STOP" goto stop
echo [%date% %time%] 한 바퀴 시작
codex exec --approve-for-me --add-dir "%STUDY_FORGE_DATA_DIR%" "협업/작업지시_19_출제품질_자동루프.md 의 '한 바퀴'를 정확히 한 번 수행하고 끝내라. 상태 파일은 %STUDY_FORGE_DATA_DIR%\품질루프\ 에 있다. 사용자 서버 3000은 건드리지 말고 이 폴더에서 PORT=3100으로 서버를 켜라."
if errorlevel 1 goto failed
echo [%date% %time%] 한 바퀴 끝 · 30분 쉼
timeout /t 1800 /nobreak >nul
goto loop
:stop
echo STOP 파일이 있어 멈췄어요.
pause
exit /b 0
:failed
echo Codex 실행에 실패해 반복을 중지했어요. 오류를 확인해 주세요.
pause
exit /b 1
