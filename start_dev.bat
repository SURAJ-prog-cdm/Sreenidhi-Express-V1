@echo off
title Sreenidhi TransitPulse - Live Dev Mode
echo ========================================================
echo   Starting Sreenidhi TransitPulse (Dev Mode + Hot Reload)
echo ========================================================
echo.
cd /d "%~dp0"

echo Starting Excel Backend API on port 3001 in background...
start "TransitPulse Backend API (Port 3001)" cmd /k "npm.cmd run server"

timeout /t 2 /nobreak >nul

echo Starting Vite Frontend on port 5173 with LAN access...
start "TransitPulse Vite Frontend (Port 5173)" cmd /k "npm.cmd run host"

timeout /t 3 /nobreak >nul
start http://localhost:5173
echo.
echo Both servers are running!
echo Frontend: http://localhost:5173 (Network: http://10.117.237.152:5173)
echo Backend:  http://localhost:3001
echo.
