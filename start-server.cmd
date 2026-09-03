@echo off
rem Marble Roulette dev server launcher. Double-click to start the server and open the browser.
cd /d "%~dp0"
start "Marble Roulette server (close this window to stop)" cmd /k corepack yarn dev
timeout /t 5 /nobreak >nul
start "" http://localhost:1235
