@echo off
cd /d "%~dp0"
echo Starting Soccer Chess...
node server.js
if errorlevel 1 (
  echo.
  echo Could not start. Make sure Node.js is installed, then double-click start.bat again.
  pause
)
