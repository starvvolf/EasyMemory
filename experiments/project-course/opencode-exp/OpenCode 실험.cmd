@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Recaller - OpenCode 실험
echo.
echo OpenCode를 튜터 엔진으로 쓸 수 있는지 시험해요.
echo 진행 중인 코스 작업 폴더를 복사해서 쓰고, 원래 폴더는 건드리지 않아요.
echo AI는 Recaller 앱과 같은 ChatGPT 로그인으로 몇 번(약 6~10번) 불러요.
echo.
rem OpenCode는 Node 24 이상이 필요하다. PC의 Node는 그대로 두고, 이 폴더 안에만 Node 24를 따로 받는다.
if not exist ".node24\node_modules\.bin\node.cmd" (
  echo [1/2] 실험용 Node 24 받는 중... 처음 한 번만, 1~2분
  call npm install --prefix .node24 --no-audit --no-fund node@24 >install-node.log 2>&1
  if errorlevel 1 ( echo Node 24를 받지 못했어요. install-node.log를 확인해 주세요. & pause & exit /b 1 )
)
if not exist "node_modules\@opencode\sdk" (
  echo [2/2] OpenCode 받는 중... 처음 한 번만, 몇 분 걸릴 수 있어요
  call npm install --ignore-scripts --no-audit --no-fund >install-opencode.log 2>&1
  if errorlevel 1 ( echo OpenCode를 받지 못했어요. install-opencode.log를 확인해 주세요. & pause & exit /b 1 )
)
echo.
echo 시험 시작...
call ".node24\node_modules\.bin\node.cmd" run.mjs
echo.
echo 끝났어요. 이 창을 닫아도 돼요. 결과는 Claude가 읽어요.
pause
