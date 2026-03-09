@echo off
setlocal

set "PSExecutionPolicyPreference=Bypass"

cd /d "%~dp0"

echo Installing dependencies...
npm install

if %ERRORLEVEL% NEQ 0 (
    echo npm install failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Dependencies installed successfully!
echo.
echo To run in development mode:
echo   npm start
echo.
echo To build portable exe:
echo   npm run build
echo.
pause
