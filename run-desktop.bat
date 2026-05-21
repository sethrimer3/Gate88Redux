@echo off
setlocal

pushd "%~dp0"

if not exist "package.json" (
  echo Missing package.json. Run this launcher from the Gate88Redux repository root.
  goto error
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto error
)

echo Starting Gate88Redux desktop build...
call npm run desktop
if errorlevel 1 goto error

popd
exit /b 0

:error
echo.
echo Gate88Redux desktop launch failed. Check the error above.
popd
pause
exit /b 1
