@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto failed
)

echo Starting Gate88Redux...
set GATE88_DISABLE_GPU=1
call npm run desktop
if errorlevel 1 goto failed

exit /b 0

:failed
echo.
echo Gate88Redux failed to start. Check the error above.
pause
exit /b 1
