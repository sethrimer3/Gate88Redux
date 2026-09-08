@echo off
setlocal

pushd "%~dp0"

if not exist "package.json" (
  echo Missing package.json. Run this launcher from the Sign99RTS repository root.
  goto error
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto error
)

echo Starting Sign99RTS browser dev server...
call npm run dev
if errorlevel 1 goto error

popd
exit /b 0

:error
echo.
echo Sign99RTS browser dev server failed. Check the error above.
popd
pause
exit /b 1
