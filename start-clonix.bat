@echo off
chcp 65001 >nul
title Clonix Server Manager
echo.
echo ========================================
echo 🚀 Avvio Clonix Servers
echo ========================================
echo.

REM Check if node is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js non trovato! Installa Node.js da https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js trovato
echo.
echo 📡 Avvio server in corso...
echo    Backend:  http://localhost:3001/api
echo    Frontend: http://localhost:8081/auth
echo.
echo ⏹️  Premi Ctrl+C per fermare i server
echo.

REM Avvia entrambi i server con Node
node start-servers.js

pause
