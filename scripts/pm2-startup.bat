@echo off
REM PM2 startup script for Windows
REM This script is called by Windows Task Scheduler on system startup

cd /d "%~dp0\.."
call npm run pm2:start
call npm run pm2:save

