@echo off
REM Riftbound Deck Simulator launcher.
REM Double-click this file to run the simulator - no need to fix PowerShell's
REM execution policy yourself, this launches it with the policy bypassed just
REM for this one run.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "RiftboundSim.ps1"

if errorlevel 1 (
    echo.
    echo PowerShell could not run the simulator. Make sure RiftboundSim.ps1 is in this same folder.
    pause
)
