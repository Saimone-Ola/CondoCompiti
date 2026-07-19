@echo off
rem CondoCompiti - autorizza il programma nel firewall di Windows.
rem Da eseguire UNA VOLTA sul computer principale, come amministratore:
rem clic DESTRO su questo file -> "Esegui come amministratore".
title CondoCompiti - Autorizzazione firewall
net session >nul 2>&1
if not %errorlevel%==0 (
  echo.
  echo  Questo file va eseguito come AMMINISTRATORE:
  echo    1. chiudi questa finestra
  echo    2. clic DESTRO su "Ripara-Firewall.bat"
  echo    3. scegli "Esegui come amministratore"
  echo.
  pause
  exit /b
)
netsh advfirewall firewall delete rule name="CondoCompiti" >nul 2>&1
netsh advfirewall firewall add rule name="CondoCompiti" dir=in action=allow protocol=TCP localport=8420-8430 profile=any
echo.
echo  Fatto! Il firewall ora lascia passare CondoCompiti.
echo  Dagli altri computer l'indirizzo (es. http://192.168.1.25:8420)
echo  dovrebbe aprirsi. Se ancora non va, controlla che entrambi i
echo  computer siano sulla STESSA rete dello studio.
echo.
pause
