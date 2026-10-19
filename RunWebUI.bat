@echo off
REM Riftbound Deck Simulator - PC launcher.
REM Starts a small local web server (your computer only, nothing public) that
REM serves the same app as the phone, using the deck CSVs under Decks\.
REM The server opens your default browser on the right port by itself.

cd /d "%~dp0"

REM Start the server in its own window (so you can see its log / stop it with
REM Ctrl+C independently).
start "Riftbound Web Server" powershell -NoProfile -ExecutionPolicy Bypass -File "WebServer.ps1"
