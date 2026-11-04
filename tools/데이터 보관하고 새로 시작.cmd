@echo off
chcp 65001 >nul
rem 시연 전에: 지금 데이터를 RecallerData\보관\<날짜-이름>\ 으로 옮기고 빈 데이터로 시작해요. Recaller 앱을 끈 뒤에 쓰세요.
cd /d "%~dp0.."
node scripts\recaller-data.mjs list
echo.
set /p NAME=보관본 이름(그냥 Enter면 날짜만): 
node scripts\recaller-data.mjs archive %NAME%
pause
