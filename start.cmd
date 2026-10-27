@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\cli.js" (
  echo Please run npm ci in this folder first.
  pause
  exit /b 1
)
call npm.cmd start -- %*
