@echo off
chcp 65001 >nul
title Kuenta
cd /d "%~dp0"
rem language of the messages: KUENTA_LANG (de, en, es), otherwise the Windows display language
set "KL=%KUENTA_LANG%"
if not defined KL for /f "tokens=3" %%a in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do set "KL=%%a"
set "KL=%KL:~0,2%"
if /i not "%KL%"=="de" if /i not "%KL%"=="es" set "KL=en"
rem Kuenta itself (console, first start) uses the same language
if not defined KUENTA_LANG set "KUENTA_LANG=%KL%"
rem prefer the bundled Node.js (installer), otherwise the system-wide one
set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not "%NODE%"=="node" goto nodeok
where node >nul 2>nul
if not errorlevel 1 goto nodeok
if /i "%KL%"=="de" echo Node.js wurde nicht gefunden. Bitte Node.js LTS installieren: https://nodejs.org/de
if /i "%KL%"=="es" echo No se encontro Node.js. Instale Node.js LTS: https://nodejs.org/es
if /i "%KL%"=="en" echo Node.js was not found. Please install Node.js LTS: https://nodejs.org/en
pause
exit /b 1
:nodeok
if /i not "%~1"=="netzwerk" goto start
set HOST=0.0.0.0
title Kuenta ^(Netzwerk^)
if /i "%KL%"=="de" echo Kuenta wird im Netzwerk freigegeben. Andere Arbeitsplaetze/Tablets oeffnen die unten angezeigte Adresse im Browser.
if /i "%KL%"=="de" echo Tipp: Unter Einstellungen - Vorgabewerte die Anmeldung aktivieren.
if /i "%KL%"=="es" echo Kuenta se comparte en la red. Los demas puestos y tabletas abren en el navegador la direccion que aparece abajo.
if /i "%KL%"=="es" echo Consejo: active el inicio de sesion en Ajustes - Valores predeterminados.
if /i "%KL%"=="en" echo Kuenta is shared in the network. Other workstations/tablets open the address shown below in the browser.
if /i "%KL%"=="en" echo Tip: enable login under Settings - Defaults.
:start
if /i "%KL%"=="de" echo Kuenta wird gestartet ... Dieses Fenster bitte geoeffnet lassen. Beenden: Fenster schliessen.
if /i "%KL%"=="es" echo Iniciando Kuenta ... Deje esta ventana abierta. Para detener Kuenta, cierre la ventana.
if /i "%KL%"=="en" echo Starting Kuenta ... Please keep this window open. To stop Kuenta, close the window.
"%NODE%" server\index.js --open
rem keep the window open only on errors (a clean stop, e.g. during an update, closes it)
if errorlevel 1 pause
