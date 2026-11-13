@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title Recaller 시연 데이터 넣기
rem 11/13: 다른 컴퓨터에서 만든 시연 틀(알고리즘 algo · 실습 fps)을 이 컴퓨터에 넣는다.
rem 시연데이터.zip을 Recaller 폴더 옆(coding 폴더)에 풀면 coding\시연데이터 폴더가 생긴다. 다른 곳이면 이 파일 위에 폴더를 끌어다 놓는다.
set SRC=%~1
if "%SRC%"=="" set SRC=..\시연데이터
if not exist "%SRC%\algo" (
  echo 시연데이터 폴더를 못 찾았어요: %SRC%
  echo 시연데이터.zip을 Recaller 폴더 옆에 풀거나, 풀린 폴더를 이 파일 위에 끌어다 놓아 주세요.
  pause
  exit /b 1
)
node scripts\demo-state.mjs import "%SRC%"
echo.
echo 이어서 시연 준비를 해요.
call "tools\시연 준비.cmd"
