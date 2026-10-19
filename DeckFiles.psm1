<#
    Deck CSV files <-> deck records.

    The simulator engine is docs/engine.js (shared by the PC and the phone).
    This module only reads and writes the Decks\*.csv files for it:
    - WebServer.ps1 serves them to the browser through api/decks
    - UpdatePhoneDecks.ps1 snapshots them into docs/decks.json for the phone

    A record is { id, name, category, isMyDeck, rows } - the same shape the
    phone keeps in IndexedDB. Its id is the file's path under Decks\ without
    ".csv": "MyDeck/Rengar_Pridestalker" or "Opponents/Aggro/Sett_The_Boss".
#>

$Script:CsvColumns = @('Quantity', 'Name', 'Type', 'Energy', 'Power', 'Might', 'Domain', 'Tag')

function Resolve-DeckPath {
    <#
        Turns a deck id back into a real file path under Decks\, refusing
        anything that isn't MyDeck/<name> or Opponents/<category>/<name> - so a
        request can never read or write outside the Decks folder.
    #>
    param([string]$DecksRoot, [string]$Id)

    if ($Id -notmatch "^(MyDeck|Opponents/[A-Za-z0-9_-]+)/[A-Za-z0-9 ,'_-]+$") {
        throw "Invalid deck id '$Id'."
    }
    $root = [System.IO.Path]::GetFullPath($DecksRoot).TrimEnd('\')
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root (($Id -replace '/', '\') + '.csv')))
    if (-not $fullPath.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Invalid deck id '$Id'."
    }
    return $fullPath
}

function Get-DeckRecords {
    <#
        Every deck CSV directly under Decks\MyDeck and Decks\Opponents\<category>,
        sorted by path. Row values stay the strings the CSV holds.
    #>
    param([string]$DecksRoot)

    $root = [System.IO.Path]::GetFullPath($DecksRoot).TrimEnd('\')
    $records = New-Object 'System.Collections.Generic.List[object]'
    $files = Get-ChildItem -Path $root -Filter '*.csv' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName

    foreach ($file in $files) {
        $id = ($file.FullName.Substring($root.Length).TrimStart('\') -replace '\\', '/') -replace '\.csv$', ''
        $parts = @($id -split '/')
        $isMyDeck = ($parts[0] -eq 'MyDeck' -and $parts.Count -eq 2)
        $isOpponent = ($parts[0] -eq 'Opponents' -and $parts.Count -eq 3)
        if (-not ($isMyDeck -or $isOpponent)) { continue }

        $records.Add([PSCustomObject]@{
            id       = $id
            name     = ($file.BaseName -replace '_', ' ')
            category = if ($isMyDeck) { $null } else { $parts[1] }
            isMyDeck = $isMyDeck
            rows     = @(Import-Csv -Path $file.FullName -Encoding UTF8 | Select-Object -Property $Script:CsvColumns)
        })
    }
    return , $records.ToArray()
}

function Save-DeckRecord {
    <#
        Writes a record's rows to its CSV (creating the category folder if
        needed). Returns $true when it replaced an existing file.
    #>
    param([string]$DecksRoot, [object]$Record)

    $path = Resolve-DeckPath -DecksRoot $DecksRoot -Id ([string]$Record.id)
    $rows = @($Record.rows)
    if ($rows.Count -eq 0) { throw "Deck '$($Record.id)' has no card rows to save." }

    $folder = Split-Path $path -Parent
    if (-not (Test-Path $folder)) { New-Item -Path $folder -ItemType Directory -Force | Out-Null }
    $overwritten = Test-Path $path
    $rows | Select-Object -Property $Script:CsvColumns | Export-Csv -Path $path -NoTypeInformation -Encoding UTF8
    return $overwritten
}

function Remove-DeckRecord {
    <# Deletes a deck's CSV. Returns $true if there was one to delete. #>
    param([string]$DecksRoot, [string]$Id)

    $path = Resolve-DeckPath -DecksRoot $DecksRoot -Id $Id
    if (-not (Test-Path $path)) { return $false }
    Remove-Item -Path $path
    return $true
}

Export-ModuleMember -Function Resolve-DeckPath, Get-DeckRecords, Save-DeckRecord, Remove-DeckRecord
