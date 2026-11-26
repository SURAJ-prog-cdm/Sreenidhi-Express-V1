@echo off
title Sreenidhi TransitPulse - Local Server
echo ========================================================
echo   Starting Sreenidhi TransitPulse Local Server
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/3] Checking dependencies...
if not exist "node_modules" (
    echo Installing node dependencies...
    call npm.cmd install
)

echo [2/3] Building production web assets...
call npm.cmd run build

echo.
echo [3/3] Starting Unified Server (Frontend + Excel Backend)...
echo ========================================================
echo Local Access:      http://localhost:3001
echo Wi-Fi / Mobile:    http://10.117.237.152:3001 (or your local IP)
echo Excel Master File: server\data\sreenidhi_transit_master.xlsx
echo ========================================================
echo.
echo Launching server background worker...
start "TransitPulse Server (Port 3001)" cmd /k "node server/index.js"
echo Waiting for server to initialize...
timeout /t 3 /nobreak >nul
echo Opening Sreenidhi TransitPulse in default browser...
start http://localhost:3001
echo.
echo ========================================================
echo   TransitPulse Server is active on port 3001!
echo   Close the server window when you want to stop it.
echo ========================================================
pause
