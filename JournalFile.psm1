<#
    Journal\Games.csv <-> real-game journal entries.

    The journal is the list of real games the user logs in the app's Journal
    tab. On the PC this CSV is its source of truth:
    - WebServer.ps1 serves it to the browser through api/journal
    - UpdatePhoneDecks.ps1 snapshots it into docs/journal.json for the phone
      (it's published with the repo, which is public)

    An entry is one game: { id, date, myDeck, myLegend, opponentLegend,
    opponentDeck, result, wentFirst, myScore, opponentScore, myBattlefield,
    opponentBattlefield, event, notes, updated } - all strings, the same
    shape the phone keeps in IndexedDB.
#>

$Script:JournalColumns = @('id', 'date', 'myDeck', 'myLegend', 'opponentLegend', 'opponentDeck', 'result', 'wentFirst',
    'myScore', 'opponentScore', 'myBattlefield', 'opponentBattlefield', 'event', 'notes', 'updated')

function Get-JournalEntries {
    <# Every entry in the journal CSV (none yet if the file doesn't exist). #>
    param([string]$Path)

    if (-not (Test-Path $Path)) { return , @() }
    return , @(Import-Csv -Path $Path -Encoding UTF8 | Select-Object -Property $Script:JournalColumns)
}

function Save-JournalEntry {
    <#
        Adds an entry, or replaces the one with the same id. Returns $true
        when it replaced one.
    #>
    param([string]$Path, [object]$Entry)

    $id = [string]$Entry.id
    if ($id -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw "Invalid journal entry id '$id'." }

    $clean = [ordered]@{}
    foreach ($column in $Script:JournalColumns) {
        $value = if ($null -eq $Entry.$column) { '' } else { [string]$Entry.$column }
        if ($value.Length -gt 4000) { $value = $value.Substring(0, 4000) }
        $clean[$column] = $value
    }

    $entries = New-Object 'System.Collections.Generic.List[object]'
    $replaced = $false
    foreach ($existing in (Get-JournalEntries -Path $Path)) {
        if ($existing.id -eq $id) {
            $entries.Add([PSCustomObject]$clean)
            $replaced = $true
        } else {
            $entries.Add($existing)
        }
    }
    if (-not $replaced) { $entries.Add([PSCustomObject]$clean) }

    $folder = Split-Path $Path -Parent
    if (-not (Test-Path $folder)) { New-Item -Path $folder -ItemType Directory -Force | Out-Null }
    $entries | Select-Object -Property $Script:JournalColumns | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    return $replaced
}

function Remove-JournalEntry {
    <# Deletes the entry with this id. Returns $true if there was one. #>
    param([string]$Path, [string]$Id)

    # Get-JournalEntries returns the array as one object: no @() around it.
    $entries = Get-JournalEntries -Path $Path
    $kept = @($entries | Where-Object { $_.id -ne $Id })
    if ($kept.Count -eq $entries.Count) { return $false }
    if ($kept.Count -eq 0) {
        # Export-Csv writes nothing for an empty list - keep the header.
        $header = ($Script:JournalColumns | ForEach-Object { '"' + $_ + '"' }) -join ','
        [System.IO.File]::WriteAllText($Path, $header + "`r`n", (New-Object System.Text.UTF8Encoding $true))
    } else {
        $kept | Select-Object -Property $Script:JournalColumns | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    }
    return $true
}

Export-ModuleMember -Function Get-JournalEntries, Save-JournalEntry, Remove-JournalEntry
