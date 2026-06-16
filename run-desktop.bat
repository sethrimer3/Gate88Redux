@echo off
setlocal

pushd "%~dp0"

if not exist "package.json" (
  echo Missing package.json. Run this launcher from the Gate88Redux repository root.
  goto error
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  echo Install Node.js 18 or newer from https://nodejs.org/ and run this file again.
  goto error
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not installed or is not on PATH.
  echo Reinstall Node.js 18 or newer with npm enabled, then run this file again.
  goto error
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%A"
if %NODE_MAJOR% LSS 18 (
  echo Node.js 18 or newer is required. Detected:
  node --version
  echo Install a current Node.js LTS from https://nodejs.org/ and run this file again.
  goto error
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto error
)

if not exist "node_modules\.bin\electron.cmd" (
  echo Electron is missing. Repairing dependencies...
  call npm install
  if errorlevel 1 goto error
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo LAN helper runtime is missing. Repairing dependencies...
  call npm install
  if errorlevel 1 goto error
)

echo Starting Gate88Redux desktop build...
call npm run build
if errorlevel 1 goto error

echo Launching Gate88Redux desktop with LAN helper auto-start enabled...
set "GATE88_AUTO_START_LAN_HELPER=1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%CD%\node_modules\.bin\electron.cmd' -ArgumentList @('electron\main.cjs') -WorkingDirectory '%CD%' -WindowStyle Hidden"
if errorlevel 1 goto error

timeout /t 1 /nobreak >nul
popd
exit /b 0

:error
echo.
echo Gate88Redux desktop launch failed. Check the error above.
popd
pause
exit /b 1
