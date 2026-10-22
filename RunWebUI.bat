@echo off
REM Riftbound Deck Simulator - PC launcher.
REM Starts a small local web server (your computer only, nothing public) that
REM serves the same app as the phone, using the deck CSVs under Decks\.
REM The server opens your default browser on the right port by itself.

cd /d "%~dp0"

REM Pick up the weekly card and tournament data refresh from GitHub, if this
REM PC is online and has nothing in the way (otherwise just carry on).
git pull --ff-only --quiet origin main >nul 2>&1

REM Start the server in its own window (so you can see its log / stop it with
REM Ctrl+C independently).
start "Riftbound Web Server" powershell -NoProfile -ExecutionPolicy Bypass -File "WebServer.ps1"
