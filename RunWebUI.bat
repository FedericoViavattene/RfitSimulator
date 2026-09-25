@echo off
REM Riftbound Deck Simulator - local web UI launcher.
REM Starts a small local web server (your computer only, nothing public) and
REM opens the simulator in your default browser.

cd /d "%~dp0"

REM Start the server in its own window (so you can see its log / stop it with
REM Ctrl+C independently), give it a moment to bind the port, then open the
REM browser to it.
start "Riftbound Web Server" powershell -NoProfile -ExecutionPolicy Bypass -File "WebServer.ps1"
timeout /t 2 /nobreak >nul
start "" http://localhost:8787/

