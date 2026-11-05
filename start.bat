@echo off
title ScreenCast WebRTC Server
cd /d "%~dp0"
echo ========================================================
echo   ScreenCast - WebRTC Screen Sharing (Zero-Install)
echo ========================================================
echo.
echo Memulai server...
start http://localhost:3000
node server.js
pause
