@echo off
REM Pushes this folder to your GitHub repo:
REM   https://github.com/FedericoViavattene/RfitSimulator
REM
REM Requirements:
REM   - Git for Windows installed (https://git-scm.com/download/win)
REM   - You are logged into your FedericoViavattene GitHub account (the
REM     first time you push, Git may open a browser window asking you to
REM     sign in - just do it once and it will remember you after that)
REM
REM You can re-run this any time after adding/changing decks to sync your
REM latest changes up to GitHub.

cd /d "%~dp0"

if not exist ".git" (
    echo Setting up the local repo for the first time...
    git init
)

REM Set the commit identity for this repo only (doesn't touch any other
REM project's Git settings) - safe to run every time.
git config user.name "Federico Viavattene"
git config user.email "federico.viavattene@gmail.com"

git branch -M main

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin https://github.com/FedericoViavattene/RfitSimulator.git
)

REM Bring in what GitHub already has that this PC doesn't - the weekly data
REM refresh (new cards, tournament results) commits straight to GitHub - so
REM this PC's changes go on top of it.
git pull --rebase --autostash origin main
if errorlevel 1 (
    echo.
    echo Could not bring in the latest changes from GitHub, so nothing was pushed.
    echo Run "git status" to see what's going on, or ask Claude Code for help.
    pause
    exit /b 1
)

REM Refresh the phone app's starting data (docs\decks.json, docs\journal.json)
REM from Decks\*.csv and Journal\Games.csv.
powershell -NoProfile -ExecutionPolicy Bypass -File "UpdatePhoneDecks.ps1"

git add -A
git commit -m "Update RiftboundSimulator - %date% %time%"
git push -u origin main

echo.
echo Done - check https://github.com/FedericoViavattene/RfitSimulator
pause
