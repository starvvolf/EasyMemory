@echo off
chcp 65001 >nul
rem Recaller 켜기: 처음 한 번 필요한 것을 설치하고, 데스크톱 창으로 앱 서버(3000)와 실습 서버(4100)를 같이 켠다.
rem 데이터는 이 폴더의 data 에만 저장한다. 어디로 올리거나 받지 않는다.
cd /d "%~dp0"
title Recaller

where node >nul 2>nul
if errorlevel 1 goto nonode
set NODEMAJOR=0
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEMAJOR=%%v"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% LSS 22 goto oldnode

if not exist "node_modules\next" (
  echo [1/3] 앱 패키지 설치 중이에요. 처음 한 번, 몇 분 걸려요.
  call npm install --no-audit --no-fund
  if errorlevel 1 goto failed
)
if not exist "desktop\node_modules\electron\dist\electron.exe" (
  echo [2/3] 데스크톱 창 Electron 설치 중이에요. 처음 한 번, 1~2분.
  pushd desktop
  call npm install --no-audit --no-fund
  popd
  rem 받다가 끊기면 창 파일만 한 번 더 받는다
  if not exist "desktop\node_modules\electron\dist\electron.exe" if exist "desktop\node_modules\electron\install.js" node "desktop\node_modules\electron\install.js"
  if not exist "desktop\node_modules\electron\dist\electron.exe" goto failed
)
if not exist "experiments\project-course\node_modules\@opencode\sdk" (
  echo [3/3] 실습 튜터 OpenCode 설치 중이에요. 처음 한 번.
  pushd experiments\project-course
  call npm install --no-audit --no-fund >install-sdk.log 2>&1
  popd
)
rem 실습 튜터는 Node 24가 필요하다: 이 PC의 Node가 22·23이면 이 폴더에만 Node 24를 따로 받는다(약 180MB)
if %NODEMAJOR% LSS 24 if not exist "experiments\project-course\.node24\node_modules\.bin\node.cmd" (
  echo 실습 튜터용 Node 24를 받는 중이에요. 처음 한 번.
  call npm install --prefix experiments\project-course\.node24 --no-audit --no-fund node@24 >nul 2>&1
)
echo Recaller 창을 켜요. 처음 한 번은 화면을 만드느라 1분쯤 더 걸려요.
start "" "desktop\node_modules\electron\dist\electron.exe" desktop
exit /b 0

:nonode
echo Node.js가 없어요. https://nodejs.org 에서 Node.js 24 LTS를 설치한 뒤 다시 켜 주세요.
pause
exit /b 1

:oldnode
echo Node.js가 너무 옛 버전이에요(지금 v%NODEMAJOR%). https://nodejs.org 에서 Node.js 24 LTS를 설치해 주세요.
pause
exit /b 1

:failed
echo 설치하지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.
pause
exit /b 1
