@echo off
title Clonix - Avvio Server
echo.
echo ========================================
echo CLONIX - AVVIO COMPLETO
echo ========================================
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato!
    echo Installa da: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js trovato
echo.

REM Change to script directory
cd /d "%~dp0\scripts"

REM Check files exist
if not exist "server.js" (
    echo [ERRORE] server.js non trovato in scripts/
    pause
    exit /b 1
)

if not exist "static-server.js" (
    echo [ERRORE] static-server.js non trovato in scripts/
    pause
    exit /b 1
)

echo [OK] File server trovati
echo.
echo ========================================
echo AVVIO SERVER IN CORSO...
echo ========================================
echo.
echo Backend API:  http://localhost:3001/api
echo Frontend:    http://localhost:8081
echo.
echo Premi Ctrl+C per fermare TUTTO
echo.

REM Start both servers in parallel using start command (con /k per mantenere finestre aperte)
start "Clonix Backend" cmd /k "node server.js & echo. & echo Backend stopped. Premi un tasto per chiudere... & pause >nul"
timeout /t 2 /nobreak >nul
start "Clonix Frontend" cmd /k "node static-server.js & echo. & echo Frontend stopped. Premi un tasto per chiudere... & pause >nul"

REM Keep this window open
echo [INFO] Server avviati in finestre separate
echo [INFO] Controlla le finestre "Clonix Backend" e "Clonix Frontend"
echo [INFO] Chiudi questa finestra quando hai finito
echo.
pause
