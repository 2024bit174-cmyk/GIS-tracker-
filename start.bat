@echo off
title GeoTrack - GIS Tracking App
echo.
echo   Starting GeoTrack server...
echo   When you see the address below, open it in your browser:
echo.
"%LOCALAPPDATA%\node\node.exe" "%~dp0server.js"
echo.
echo   Server stopped. You can close this window.
pause
