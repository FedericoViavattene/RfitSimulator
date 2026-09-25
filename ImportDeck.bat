@echo off
REM Riftbound Deck Simulator - text-list deck importer.
REM Drop a .txt decklist into Decks\Import\ first (see Decks\Import\_example.txt
REM for the format), then run this to turn it into a real deck CSV.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "ImportDeck.ps1"
if errorlevel 1 (
    echo.
    echo PowerShell could not run the importer. Make sure ImportDeck.ps1 is in this same folder.
    pause
)
