@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto failed
)

echo Starting Sign99RTS...
set SIGN99_DISABLE_GPU=1
call npm run desktop
if errorlevel 1 goto failed

exit /b 0

:failed
echo.
echo Sign99RTS failed to start. Check the error above.
pause
exit /b 1
