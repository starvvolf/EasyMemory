@echo off
chcp 65001 >nul
rem Recaller 켜기: 처음 한 번 필요한 것을 설치하고, 데스크톱 창으로 앱 서버(3000)와 실습 서버(4100)를 같이 켠다.
rem 데이터는 이 폴더의 data 에만 저장한다. 어디로 올리거나 받지 않는다.
cd /d "%~dp0"
title Recaller

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules\next" (
  echo [1/4] 앱 패키지 설치 중이에요. 처음 한 번, 몇 분 걸려요.
  call npm install --no-audit --no-fund
  if errorlevel 1 goto failed
)
if not exist "desktop\node_modules\electron\dist\electron.exe" (
  echo [2/4] 데스크톱 창 Electron 설치 중이에요. 처음 한 번, 1~2분.
  pushd desktop
  call npm install --no-audit --no-fund
  popd
  if not exist "desktop\node_modules\electron\dist\electron.exe" goto failed
)
if not exist "experiments\project-course\node_modules\@opencode\sdk" (
  echo [3/4] 실습 튜터 설치 중이에요. 처음 한 번.
  pushd experiments\project-course
  call npm install --no-audit --no-fund >install-sdk.log 2>&1
  if not exist ".node24\node_modules\.bin\node.cmd" call npm install --prefix .node24 --no-audit --no-fund node@24 >install-node.log 2>&1
  popd
)
echo [4/4] Recaller 창을 켜요. 처음 한 번은 화면을 만드느라 1분쯤 더 걸려요.
start "" "desktop\node_modules\electron\dist\electron.exe" desktop
exit /b 0

:nonode
echo Node.js가 없어요. https://nodejs.org 에서 Node.js 24를 설치한 뒤 다시 켜 주세요.
pause
exit /b 1

:failed
echo 설치하지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.
pause
exit /b 1
