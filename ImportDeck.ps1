<#
.SYNOPSIS
    Imports a plain-text decklist (dropped as a .txt file into Decks\Import\)
    into a proper deck CSV, resolving every card's real Type/Energy/Power/
    Might/Domain from CardDatabase.json instead of you having to type them.

.DESCRIPTION
    Drop a .txt file into Decks\Import\ - one card per line, e.g.:
        1 Jinx, Loose Cannon
        1 Grand Plaza
        8 Fury Rune
        4 Chaos Rune
        3 Rabble Rouser
        ...
    "3x Card Name", "Card Name x3" and section labels like "Legend:" or
    "Battlefields:" are all fine too - see Decks\Import\_example.txt for a
    full sample. Every card's Type/Energy/Power/Might/Domain always comes
    from the card database, never from the text, so the only things that
    need to be right are the card name and the quantity.

.NOTES
    Run via ImportDeck.bat, or manually with:
        cd "C:\path\to\RiftboundSimulator"
        .\ImportDeck.ps1
    The same import is also available from the web UI (RunWebUI.bat) as a
    "Import a deck from a text list" panel, if you'd rather paste directly
    instead of saving a .txt file first.
#>

$Script:RootPath        = $PSScriptRoot
$Script:ImportFolder    = Join-Path $RootPath 'Decks\Import'
$Script:MyDeckFolder    = Join-Path $RootPath 'Decks\MyDeck'
$Script:OpponentFolder  = Join-Path $RootPath 'Decks\Opponents'
$Script:CardDatabaseFile = Join-Path $RootPath 'CardDatabase.json'

Import-Module (Join-Path $PSScriptRoot 'RiftboundEngine.psm1') -Force

function Write-Title {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host ("  {0}" -f $Text) -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
}

try {
    Write-Title "IMPORT A DECK FROM A TEXT LIST"

    if (-not (Test-Path $Script:ImportFolder)) {
        New-Item -Path $Script:ImportFolder -ItemType Directory -Force | Out-Null
    }

    $files = @(Get-ChildItem -Path $Script:ImportFolder -Filter '*.txt' -File -ErrorAction SilentlyContinue | Sort-Object Name)
    if ($files.Count -eq 0) {
        Write-Host ""
        Write-Host "No .txt files found in:" -ForegroundColor Yellow
        Write-Host "  $Script:ImportFolder" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Save a decklist there first - one card per line, e.g.:"
        Write-Host "  1 Jinx, Loose Cannon"
        Write-Host "  1 Grand Plaza"
        Write-Host "  8 Fury Rune"
        Write-Host "  4 Chaos Rune"
        Write-Host "  3 Rabble Rouser"
        Write-Host ""
        Write-Host "See Decks\Import\_example.txt for a full sample, then run this again." -ForegroundColor DarkGray
        Read-Host "Press Enter to close this window"
        exit 0
    }

    Write-Host ""
    Write-Host "Text files found in Decks\Import\:"
    for ($i = 0; $i -lt $files.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $files[$i].Name)
    }
    Write-Host ""
    $choice = Read-Host "Which one do you want to import? (number)"
    $choiceInt = 0
    if (-not [int]::TryParse($choice, [ref]$choiceInt) -or $choiceInt -lt 1 -or $choiceInt -gt $files.Count) {
        throw "Invalid selection."
    }
    $sourceFile = $files[$choiceInt - 1]

    Write-Host ""
    Write-Host "Add this deck to:"
    Write-Host "  1) Your decks (Decks\MyDeck)"
    Write-Host "  2) Opponents - Aggro"
    Write-Host "  3) Opponents - Midrange"
    Write-Host "  4) Opponents - Control"
    $destChoice = Read-Host "Choose an option (1-4)"
    $targetFolder = switch ($destChoice) {
        '1' { $Script:MyDeckFolder }
        '2' { Join-Path $Script:OpponentFolder 'Aggro' }
        '3' { Join-Path $Script:OpponentFolder 'Midrange' }
        '4' { Join-Path $Script:OpponentFolder 'Control' }
        default { throw "Invalid selection." }
    }
    if (-not (Test-Path $targetFolder)) { New-Item -Path $targetFolder -ItemType Directory -Force | Out-Null }

    $defaultName = [System.IO.Path]::GetFileNameWithoutExtension($sourceFile.Name)
    $deckName = Read-Host "Deck name for the file (Enter to use '$defaultName')"
    if ([string]::IsNullOrWhiteSpace($deckName)) { $deckName = $defaultName }
    $safeName = ($deckName -replace "[^A-Za-z0-9 ,'-]", '') -replace '\s+', '_'
    $safeName = $safeName.Trim('_')
    if (-not $safeName) { $safeName = 'Imported_Deck_' + (Get-Date -Format 'yyyyMMdd_HHmmss') }
    $targetPath = Join-Path $targetFolder ($safeName + '.csv')
    $overwriting = Test-Path $targetPath

    Write-Host ""
    Write-Host "Loading card database..." -ForegroundColor DarkGray
    $cardDb = Import-CardDatabase -Path $Script:CardDatabaseFile

    # @() forces an array even when the file has exactly one non-blank line -
    # otherwise Get-Content returns a bare string, which used to crash the parser.
    $lines = @(Get-Content -Path $sourceFile.FullName -Encoding UTF8)
    $parsed = ConvertFrom-DeckText -Lines $lines
    if ($parsed.Count -eq 0) {
        throw "Couldn't find any card lines in $($sourceFile.Name) - expected one card per line, like '1 Rengar, Pridestalker' or '3x Inferna'."
    }

    $resolved = Resolve-DeckList -Parsed $parsed -CardDatabase $cardDb
    if ($resolved.Rows.Count -eq 0) {
        throw "None of the lines matched a real card - check the spelling against the official card gallery."
    }

    Export-DeckCsv -Rows $resolved.Rows -Path $targetPath

    Write-Title "IMPORT COMPLETE"
    Write-Host ""
    $verb = if ($overwriting) { "Replaced" } else { "Created" }
    Write-Host ("{0}: {1}" -f $verb, $targetPath) -ForegroundColor Green
    Write-Host ""
    Write-Host ("Matched {0} card row(s): {1} Legend, {2} Battlefield(s), {3} Rune(s), {4} Main Deck card(s)." -f `
        $resolved.Rows.Count, $resolved.LegendCount, $resolved.BattlefieldCount, $resolved.RuneTotal, $resolved.MainDeckTotal)

    if ($resolved.Warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "Warnings:" -ForegroundColor Yellow
        foreach ($w in $resolved.Warnings) {
            Write-Host ("  - {0}" -f $w) -ForegroundColor Yellow
        }
    } else {
        Write-Host ""
        Write-Host "No warnings - this deck is ready to simulate." -ForegroundColor Green
    }

    Write-Host ""
    Read-Host "Press Enter to close this window"
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close this window"
}
