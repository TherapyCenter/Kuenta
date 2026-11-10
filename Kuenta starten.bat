@echo off
chcp 65001 >nul
title Kuenta
cd /d "%~dp0"
rem prefer the bundled Node.js (installer), otherwise the system-wide one
set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if "%NODE%"=="node" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js wurde nicht gefunden. Bitte Node.js LTS installieren: https://nodejs.org/de
    pause
    exit /b 1
  )
)
if /i "%~1"=="netzwerk" (
  set HOST=0.0.0.0
  title Kuenta ^(Netzwerk^)
  echo Kuenta wird im Netzwerk freigegeben. Andere Arbeitsplaetze/Tablets oeffnen die unten angezeigte Adresse im Browser.
  echo Tipp: Unter Einstellungen - Vorgabewerte die Anmeldung aktivieren.
)
echo Kuenta wird gestartet ... Dieses Fenster bitte geoeffnet lassen. Beenden: Fenster schliessen.
"%NODE%" server\index.js --open
rem keep the window open only on errors (a clean stop, e.g. during an update, closes it)
if errorlevel 1 pause
