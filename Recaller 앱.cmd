@echo off
chcp 65001 >nul
cd /d "%~dp0desktop"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Recaller 앱을 처음 준비해요. 1~2분 걸려요.
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo 준비하지 못했어요. 인터넷 연결을 확인해 주세요. & pause & exit /b 1 )
)
if not exist "%USERPROFILE%\Desktop\Recaller.lnk" (
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Recaller.lnk');$s.TargetPath='%~dp0Recaller 앱.cmd';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.IconLocation='%~dp0desktop\node_modules\electron\dist\electron.exe,0';$s.Save()" >nul 2>&1
)
start "" "node_modules\electron\dist\electron.exe" .
