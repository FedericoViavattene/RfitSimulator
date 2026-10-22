<#
.SYNOPSIS
    Rebuilds the phone app's starting data from the PC's files:
    docs/decks.json from the Decks\*.csv files and docs/journal.json from
    Journal\Games.csv. Bumps the service worker's CACHE_NAME in docs/sw.js
    when either snapshot changed, so installed phones fetch the new copy.

.NOTES
    PushToGitHub.bat runs this before every push. Run it by hand with:
        powershell -NoProfile -ExecutionPolicy Bypass -File UpdatePhoneDecks.ps1
    The phone merges both snapshots into what it already has on every start
    (see mergeSeedDecks / mergeSeedJournal in docs/engine.js), so nothing
    added or changed on the phone is lost.
#>

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DeckFiles.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'JournalFile.psm1') -Force

$swPath = Join-Path $PSScriptRoot 'docs\sw.js'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

# Writes $Json to $Path if it differs; returns $true when it did.
function Update-Snapshot {
    param([string]$Path, [string]$Json)
    $current = if (Test-Path $Path) { [System.IO.File]::ReadAllText($Path, $utf8NoBom) } else { '' }
    if ($Json -eq $current) { return $false }
    [System.IO.File]::WriteAllText($Path, $Json, $utf8NoBom)
    return $true
}

$records = Get-DeckRecords -DecksRoot (Join-Path $PSScriptRoot 'Decks')
$decksChanged = Update-Snapshot -Path (Join-Path $PSScriptRoot 'docs\decks.json') -Json (ConvertTo-Json -InputObject $records -Depth 5 -Compress)

$entries = Get-JournalEntries -Path (Join-Path $PSScriptRoot 'Journal\Games.csv')
$journalJson = if ($entries.Count) { ConvertTo-Json -InputObject $entries -Depth 3 -Compress } else { '[]' }
$journalChanged = Update-Snapshot -Path (Join-Path $PSScriptRoot 'docs\journal.json') -Json $journalJson

$status = "$($records.Count) decks, $($entries.Count) journal games"
if (-not ($decksChanged -or $journalChanged)) {
    Write-Host "docs/decks.json and docs/journal.json are already up to date ($status)."
    return
}

$sw = [System.IO.File]::ReadAllText($swPath, $utf8NoBom)
$match = [regex]::Match($sw, "CACHE_NAME = 'riftbound-sim-v(\d+)'")
if (-not $match.Success) { throw "Couldn't find CACHE_NAME in docs/sw.js - bump it by hand." }
$nextVersion = [int]$match.Groups[1].Value + 1
$sw = $sw.Replace($match.Value, "CACHE_NAME = 'riftbound-sim-v$nextVersion'")
[System.IO.File]::WriteAllText($swPath, $sw, $utf8NoBom)

Write-Host "Phone data updated ($status); docs/sw.js cache bumped to riftbound-sim-v$nextVersion."
