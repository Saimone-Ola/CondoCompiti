@echo off
title CondoCompiti - Gestione compiti dello studio
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py avvia_server.py
) else (
  python avvia_server.py
)
echo.
echo Se qui sopra compare un errore su "python": installa Python da python.org
echo (una sola volta, spuntando "Add python.exe to PATH") e riprova.
pause
