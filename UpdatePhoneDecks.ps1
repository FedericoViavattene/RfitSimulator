<#
.SYNOPSIS
    Rebuilds docs/decks.json - the decks the phone app starts with - from the
    Decks\*.csv files, and bumps the service worker's CACHE_NAME in docs/sw.js
    when that snapshot changed, so installed phones fetch the new copy.

.NOTES
    PushToGitHub.bat runs this before every push. Run it by hand with:
        powershell -NoProfile -ExecutionPolicy Bypass -File UpdatePhoneDecks.ps1
    The phone only seeds its decks from decks.json the first time the app
    opens on that device, so a phone that already has decks keeps them.
#>

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DeckFiles.psm1') -Force

$decksJsonPath = Join-Path $PSScriptRoot 'docs\decks.json'
$swPath = Join-Path $PSScriptRoot 'docs\sw.js'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$records = Get-DeckRecords -DecksRoot (Join-Path $PSScriptRoot 'Decks')
$json = ConvertTo-Json -InputObject $records -Depth 5 -Compress

$current = if (Test-Path $decksJsonPath) { [System.IO.File]::ReadAllText($decksJsonPath, $utf8NoBom) } else { '' }
if ($json -eq $current) {
    Write-Host "docs/decks.json is already up to date ($($records.Count) decks)."
    return
}

[System.IO.File]::WriteAllText($decksJsonPath, $json, $utf8NoBom)

$sw = [System.IO.File]::ReadAllText($swPath, $utf8NoBom)
$match = [regex]::Match($sw, "CACHE_NAME = 'riftbound-sim-v(\d+)'")
if (-not $match.Success) { throw "Couldn't find CACHE_NAME in docs/sw.js - bump it by hand." }
$nextVersion = [int]$match.Groups[1].Value + 1
$sw = $sw.Replace($match.Value, "CACHE_NAME = 'riftbound-sim-v$nextVersion'")
[System.IO.File]::WriteAllText($swPath, $sw, $utf8NoBom)

Write-Host "docs/decks.json updated ($($records.Count) decks); docs/sw.js cache bumped to riftbound-sim-v$nextVersion."
