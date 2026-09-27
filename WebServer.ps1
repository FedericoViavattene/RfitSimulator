<#
.SYNOPSIS
    Local web UI for the Riftbound Deck Simulator. Runs a small HTTP server on
    your own machine (nothing leaves your computer) and serves a browser page
    that drives the exact same simulation engine as RiftboundSim.ps1.

.DESCRIPTION
    This does NOT make the simulator reachable from the internet or from
    other devices - it only listens on http://localhost, which only your own
    computer can reach. Think of it as a nicer-looking replacement for the
    console UI, not a hosted website.

    Uses .NET's built-in HttpListener - no extra software (Python, Node, IIS)
    needs to be installed. Binding to "localhost" specifically (rather than a
    wildcard address) avoids needing Administrator rights on Windows.

.NOTES
    Run this via RunWebUI.bat (recommended - it also opens your browser for
    you), or manually with:
        cd "C:\path\to\RiftboundSimulator"
        .\WebServer.ps1
    Then open http://localhost:8787 in your browser. Press Ctrl+C in this
    window (or just close it) to stop the server.
#>

# ============================================================================
#  SETUP
# ============================================================================
$Script:Port            = 8787
$Script:RootPath        = $PSScriptRoot
$Script:WebRoot         = Join-Path $RootPath 'web'
$Script:MyDeckFolder    = Join-Path $RootPath 'Decks\MyDeck'
$Script:OpponentFolder  = Join-Path $RootPath 'Decks\Opponents'
$Script:BannedFile      = Join-Path $RootPath 'Banned.csv'
$Script:CardDatabaseFile = Join-Path $RootPath 'CardDatabase.json'
$Script:GamesToSimulate = 50
$Script:MatchesToSimulate = 20   # for the "best-of-3 match" mode
$Script:BestOf            = 3

Import-Module (Join-Path $PSScriptRoot 'RiftboundEngine.psm1') -Force

# Loaded once at startup and reused for every /api/import-deck request -
# it's a ~1000-card lookup table, no reason to re-parse the JSON per request.
$Script:CardDatabase = Import-CardDatabase -Path $Script:CardDatabaseFile

# ============================================================================
#  DECK ID <-> PATH HELPERS
#  (the browser only ever sees a relative "id" like "Decks/MyDeck/Foo.csv",
#  never a real filesystem path - Resolve-DeckId turns that back into a real
#  path and refuses anything that would escape the simulator's own folder)
# ============================================================================
function Get-DeckId {
    param([string]$FullPath)
    $resolvedRoot = [System.IO.Path]::GetFullPath($Script:RootPath)
    $rel = $FullPath.Substring($resolvedRoot.Length).TrimStart('\', '/')
    return ($rel -replace '\\', '/')
}

function Resolve-DeckId {
    param([string]$Id)
    if (-not $Id) { throw "Missing deck id." }
    $normalized = $Id -replace '/', '\'
    $resolvedRoot = [System.IO.Path]::GetFullPath($Script:RootPath)
    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot $normalized))
    if (-not $fullPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Invalid deck id."
    }
    if (-not (Test-Path $fullPath)) {
        throw "Deck file not found: $Id"
    }
    return $fullPath
}

# ============================================================================
#  API: GET /api/decks
# ============================================================================
function Get-DecksPayload {
    $myDecks = @(Get-DeckFileList -FolderPath $Script:MyDeckFolder | ForEach-Object {
        [PSCustomObject]@{ id = (Get-DeckId $_.Path); name = $_.Name }
    })

    $opponentFiles = Get-DeckFileList -FolderPath $Script:OpponentFolder -Recurse
    $opponents = [ordered]@{}
    foreach ($cat in @('Aggro', 'Midrange', 'Control')) {
        $inCat = @($opponentFiles | Where-Object { $_.Category -eq $cat } | ForEach-Object {
            [PSCustomObject]@{ id = (Get-DeckId $_.Path); name = $_.Name }
        })
        if ($inCat.Count -gt 0) { $opponents[$cat] = $inCat }
    }
    # Any category outside the three known ones still gets listed, so a new
    # subfolder doesn't silently disappear from the web UI.
    $otherCats = $opponentFiles | Select-Object -ExpandProperty Category -Unique | Where-Object { $_ -notin @('Aggro', 'Midrange', 'Control') }
    foreach ($cat in $otherCats) {
        $inCat = @($opponentFiles | Where-Object { $_.Category -eq $cat } | ForEach-Object {
            [PSCustomObject]@{ id = (Get-DeckId $_.Path); name = $_.Name }
        })
        $opponents[$cat] = $inCat
    }

    return [PSCustomObject]@{
        myDecks   = $myDecks
        opponents = $opponents
    }
}

# ============================================================================
#  SHARED PAYLOAD HELPERS
#  (used by /api/simulate, /api/simulate-match and /api/matchup-matrix so the
#  camelCase JSON shape - and the CSV-loading path - only lives in one place)
# ============================================================================
function Get-OptimizationPayload {
    param([object]$Deck, [object[]]$GameResults)

    $rawStats = Get-OptimizationStats -Deck $Deck -GameResults $GameResults
    # Get-OptimizationStats (shared with the console UI) returns PascalCase
    # property names (MostPlayed, NeverPlayed, ...). The web front-end's
    # JSON API is camelCase everywhere else, and JSON property access in
    # JavaScript is case-sensitive, so this maps it to camelCase here rather
    # than changing the shared engine (which would break the console script's
    # own PascalCase usage in Show-OptimizationReport).
    return [PSCustomObject]@{
        mostPlayed      = @($rawStats.MostPlayed | ForEach-Object { [PSCustomObject]@{ name = $_.Name; count = $_.Count } })
        neverPlayed     = $rawStats.NeverPlayed
        averageEnergy   = $rawStats.AverageEnergy
        curveSuggestion = $rawStats.CurveSuggestion
    }
}

function Get-DecklistPayload {
    param([object]$Deck)

    # Same grouping/order as the console's Show-Decklist, for the "view
    # opponent decklist" panel.
    $typeOrder = @('Legend', 'Battlefield', 'Rune', 'Unit', 'Spell', 'Gear')
    $grouped = $Deck.DisplayRows | Group-Object Type
    $decklistGroups = [ordered]@{}
    foreach ($t in $typeOrder) {
        $group = $grouped | Where-Object { $_.Name -eq $t }
        if (-not $group) { continue }
        $decklistGroups[$t] = @($group.Group | Sort-Object Name | ForEach-Object {
            [PSCustomObject]@{
                quantity = $_.Quantity
                name     = $_.Name
                energy   = $_.Energy
                power    = $_.Power
                might    = $_.Might
                domain   = $_.Domain
                tag      = $_.Tag
            }
        })
    }

    return [PSCustomObject]@{
        name   = ($Deck.Name -replace '_', ' ')
        groups = $decklistGroups
    }
}

function Import-DeckForRequest {
    <#
        Resolves a browser-supplied deck id to a real path and loads it with
        the card database + banned list already wired in - the same three
        lines were repeated at the top of every request handler below.
    #>
    param([string]$DeckId, [System.Collections.Generic.HashSet[string]]$BannedList)

    $path = Resolve-DeckId -Id $DeckId
    return Import-Deck -Path $path -BannedList $BannedList -CardDatabase $Script:CardDatabase
}

# ============================================================================
#  API: POST /api/simulate
# ============================================================================
function Invoke-SimulationRequest {
    param([object]$Body)

    $bannedList = Get-BannedList -Path $Script:BannedFile
    $myDeck = Import-DeckForRequest -DeckId $Body.myDeckId -BannedList $bannedList
    $opponentDeck = Import-DeckForRequest -DeckId $Body.opponentDeckId -BannedList $bannedList

    $batch = Invoke-GameBatch -DeckA $myDeck -DeckB $opponentDeck -GameCount $Script:GamesToSimulate

    $games = @()
    $gameNum = 0
    foreach ($r in $batch.Results) {
        $gameNum++
        $games += [PSCustomObject]@{
            n          = $gameNum
            win        = ($r.Winner -eq "You")
            scoreA     = $r.ScoreA
            scoreB     = $r.ScoreB
            lossReason = $r.LossReason
        }
    }

    return [PSCustomObject]@{
        myDeckName             = ($myDeck.Name -replace '_', ' ')
        opponentDeckName       = ($opponentDeck.Name -replace '_', ' ')
        bannedExcludedMy       = $myDeck.BannedExcluded
        bannedExcludedOpponent = $opponentDeck.BannedExcluded
        wins                   = $batch.Wins
        totalGames             = $batch.GameCount
        winrate                = $batch.Winrate
        games                  = $games
        optimization           = (Get-OptimizationPayload -Deck $myDeck -GameResults $batch.Results)
        opponentDecklist       = (Get-DecklistPayload -Deck $opponentDeck)
    }
}

# ============================================================================
#  API: POST /api/simulate-match
#  Best-of-BestOf match simulation (see Invoke-MatchBatch in the engine) -
#  reports the match-level winrate, not just the per-game winrate.
# ============================================================================
function Invoke-MatchSimulationRequest {
    param([object]$Body)

    $bannedList = Get-BannedList -Path $Script:BannedFile
    $myDeck = Import-DeckForRequest -DeckId $Body.myDeckId -BannedList $bannedList
    $opponentDeck = Import-DeckForRequest -DeckId $Body.opponentDeckId -BannedList $bannedList

    $matchBatch = Invoke-MatchBatch -DeckA $myDeck -DeckB $opponentDeck -MatchCount $Script:MatchesToSimulate -BestOf $Script:BestOf

    $matches = @()
    $matchNum = 0
    $allGames = New-Object 'System.Collections.Generic.List[object]'
    foreach ($match in $matchBatch.Matches) {
        $matchNum++
        $matches += [PSCustomObject]@{
            n          = $matchNum
            win        = ($match.Winner -eq "You")
            gamesWonA  = $match.GamesWonA
            gamesWonB  = $match.GamesWonB
        }
        foreach ($g in $match.Games) { $allGames.Add($g) }
    }

    return [PSCustomObject]@{
        myDeckName             = ($myDeck.Name -replace '_', ' ')
        opponentDeckName       = ($opponentDeck.Name -replace '_', ' ')
        bannedExcludedMy       = $myDeck.BannedExcluded
        bannedExcludedOpponent = $opponentDeck.BannedExcluded
        bestOf                 = $matchBatch.BestOf
        matchWins              = $matchBatch.MatchWins
        matchCount             = $matchBatch.MatchCount
        matchWinrate           = $matchBatch.MatchWinrate
        matches                = $matches
        optimization           = (Get-OptimizationPayload -Deck $myDeck -GameResults $allGames)
        opponentDecklist       = (Get-DecklistPayload -Deck $opponentDeck)
    }
}

# ============================================================================
#  API: POST /api/matchup-matrix
#  Runs MyDeck against every saved opponent deck at once (see
#  Get-MatchupMatrix in the engine) - a "how do I stack up against the whole
#  meta" view instead of one matchup at a time.
# ============================================================================
function Invoke-MatchupMatrixRequest {
    param([object]$Body)

    $bannedList = Get-BannedList -Path $Script:BannedFile
    $myDeck = Import-DeckForRequest -DeckId $Body.myDeckId -BannedList $bannedList

    $rows = Get-MatchupMatrix -MyDeck $myDeck -OpponentFolderPath $Script:OpponentFolder -BannedList $bannedList -CardDatabase $Script:CardDatabase -GameCount $Script:GamesToSimulate

    $averageWinrate = 0
    if ($rows.Count -gt 0) {
        $averageWinrate = [Math]::Round((($rows | Measure-Object -Property Winrate -Average).Average), 1)
    }

    return [PSCustomObject]@{
        myDeckName      = ($myDeck.Name -replace '_', ' ')
        bannedExcludedMy = $myDeck.BannedExcluded
        rows            = @($rows | ForEach-Object {
            [PSCustomObject]@{
                name     = $_.Name
                category = $_.Category
                winrate  = $_.Winrate
                wins     = $_.Wins
                total    = $_.Total
            }
        })
        averageWinrate  = $averageWinrate
    }
}

# ============================================================================
#  API: POST /api/import-deck
#  Turns a pasted plain-text decklist into a real CSV under Decks\MyDeck or
#  Decks\Opponents\<category>, using CardDatabase.json to look up every
#  card's real Type/Energy/Power/Might/Domain - see Resolve-DeckList in
#  RiftboundEngine.psm1 for the actual parsing/lookup/legality-check logic.
# ============================================================================
function Invoke-ImportDeckRequest {
    param([object]$Body)

    $text = [string]$Body.text
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw "No decklist text was provided."
    }

    $category = [string]$Body.category
    $validCategories = @('MyDeck', 'Aggro', 'Midrange', 'Control')
    if ($category -notin $validCategories) {
        throw "Invalid destination '$category'. Must be one of: $($validCategories -join ', ')."
    }

    $rawName = [string]$Body.deckName
    if ([string]::IsNullOrWhiteSpace($rawName)) { $rawName = 'Imported Deck' }
    $safeName = ($rawName -replace "[^A-Za-z0-9 ,'-]", '') -replace '\s+', '_'
    $safeName = $safeName.Trim('_')
    if (-not $safeName) { $safeName = 'Imported_Deck_' + (Get-Date -Format 'yyyyMMdd_HHmmss') }

    $targetFolder = if ($category -eq 'MyDeck') { $Script:MyDeckFolder } else { Join-Path $Script:OpponentFolder $category }
    if (-not (Test-Path $targetFolder)) { New-Item -Path $targetFolder -ItemType Directory -Force | Out-Null }
    $targetPath = Join-Path $targetFolder ($safeName + '.csv')
    $overwritten = Test-Path $targetPath

    $lines = @($text -split "`r`n|`n|`r")
    $parsed = ConvertFrom-DeckText -Lines $lines
    if ($parsed.Count -eq 0) {
        throw "Couldn't find any card lines in that text - expected one card per line, like '1 Rengar, Pridestalker' or '3x Inferna'."
    }

    $resolved = Resolve-DeckList -Parsed $parsed -CardDatabase $Script:CardDatabase
    if ($resolved.Rows.Count -eq 0) {
        throw "None of the lines matched a real card - check the spelling against the official card gallery."
    }

    Export-DeckCsv -Rows $resolved.Rows -Path $targetPath

    return [PSCustomObject]@{
        success          = $true
        deckId           = (Get-DeckId $targetPath)
        fileName         = ($safeName + '.csv')
        overwritten      = $overwritten
        category         = $category
        cardsMatched     = $resolved.Rows.Count
        legendCount      = $resolved.LegendCount
        runeTotal        = $resolved.RuneTotal
        battlefieldCount = $resolved.BattlefieldCount
        mainDeckTotal    = $resolved.MainDeckTotal
        warnings         = @($resolved.Warnings)
    }
}

# ============================================================================
#  STATIC FILE SERVING
# ============================================================================
function Get-ContentType {
    param([string]$Extension)
    switch ($Extension.ToLowerInvariant()) {
        '.html' { return 'text/html; charset=utf-8' }
        '.css'  { return 'text/css; charset=utf-8' }
        '.js'   { return 'application/javascript; charset=utf-8' }
        '.json' { return 'application/json; charset=utf-8' }
        '.svg'  { return 'image/svg+xml' }
        '.ico'  { return 'image/x-icon' }
        default { return 'application/octet-stream' }
    }
}

function Send-FileResponse {
    param([System.Net.HttpListenerResponse]$Response, [string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        $Response.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
        return
    }
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $Response.ContentType = Get-ContentType ([System.IO.Path]::GetExtension($FilePath))
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-JsonResponse {
    param([System.Net.HttpListenerResponse]$Response, [object]$Data, [int]$StatusCode = 200)

    $Response.StatusCode = $StatusCode
    $json = $Data | ConvertTo-Json -Depth 8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-RequestBody {
    param([System.Net.HttpListenerRequest]$Request)
    $encoding = if ($Request.ContentEncoding) { $Request.ContentEncoding } else { [System.Text.Encoding]::UTF8 }
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $encoding)
    $text = $reader.ReadToEnd()
    $reader.Close()
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return $text | ConvertFrom-Json
}

# ============================================================================
#  SERVER
# ============================================================================
# Try the configured port first, then a handful of fallback ports. A
# "conflicts with an existing registration" error means something is
# ALREADY bound to that exact prefix - most often a previous WebServer.ps1
# window that never got closed (running as Administrator does not help with
# that, since it's a different process holding the port, not a permissions
# problem). Rather than making the person hunt that process down every time,
# just find a free port automatically.
$listener = $null
$boundPort = $null
$lastError = $null
$portsToTry = @($Script:Port) + (1..9 | ForEach-Object { $Script:Port + $_ })

foreach ($p in $portsToTry) {
    $candidate = New-Object System.Net.HttpListener
    $candidate.Prefixes.Add("http://localhost:$p/")
    try {
        $candidate.Start()
        $listener = $candidate
        $boundPort = $p
        break
    }
    catch {
        $lastError = $_
        $candidate.Close()
    }
}

if (-not $listener) {
    Write-Host ""
    Write-Host "ERROR: could not start the local web server on any port from $($portsToTry[0]) to $($portsToTry[-1])." -ForegroundColor Red
    Write-Host $lastError.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Most likely cause: an earlier 'Riftbound Web Server' window is still" -ForegroundColor Yellow
    Write-Host "running in the background (check your taskbar / Task Manager for a" -ForegroundColor Yellow
    Write-Host "powershell.exe window titled 'Riftbound Web Server' and close it), or" -ForegroundColor Yellow
    Write-Host "some other application already used all of these ports." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can also check what's using port $($Script:Port) yourself by running:" -ForegroundColor Yellow
    Write-Host "  netstat -ano | findstr :$($Script:Port)" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close this window"
    exit 1
}

$Script:Port = $boundPort
$prefix = "http://localhost:$boundPort/"

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host "  Riftbound Deck Simulator - local web server running" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan
Write-Host ""
Write-Host "  Open this in your browser:  $prefix" -ForegroundColor Green
if ($boundPort -ne $portsToTry[0]) {
    Write-Host "  (Port $($portsToTry[0]) was unavailable, so it switched to $boundPort.)" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  This only listens on your own computer (localhost) - nothing" -ForegroundColor DarkGray
Write-Host "  here is reachable from the internet or other devices." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C or close this window to stop the server." -ForegroundColor DarkGray
Write-Host ""

try {
    Start-Process $prefix | Out-Null
}
catch {
    Write-Host "  (Could not open your browser automatically - open $prefix manually.)" -ForegroundColor Yellow
    Write-Host ""
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()   # blocks until a request comes in
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.AbsolutePath
        $method = $request.HttpMethod
        $statusLine = "OK"

        try {
            if ($method -eq 'GET' -and $path -eq '/api/decks') {
                Send-JsonResponse -Response $response -Data (Get-DecksPayload)
            }
            elseif ($method -eq 'POST' -and $path -eq '/api/simulate') {
                $body = Get-RequestBody -Request $request
                $result = Invoke-SimulationRequest -Body $body
                Send-JsonResponse -Response $response -Data $result
            }
            elseif ($method -eq 'POST' -and $path -eq '/api/simulate-match') {
                $body = Get-RequestBody -Request $request
                $result = Invoke-MatchSimulationRequest -Body $body
                Send-JsonResponse -Response $response -Data $result
            }
            elseif ($method -eq 'POST' -and $path -eq '/api/matchup-matrix') {
                $body = Get-RequestBody -Request $request
                $result = Invoke-MatchupMatrixRequest -Body $body
                Send-JsonResponse -Response $response -Data $result
            }
            elseif ($method -eq 'POST' -and $path -eq '/api/import-deck') {
                $body = Get-RequestBody -Request $request
                $result = Invoke-ImportDeckRequest -Body $body
                Send-JsonResponse -Response $response -Data $result
            }
            elseif ($method -eq 'GET' -and $path -eq '/favicon.ico') {
                # No icon file is shipped; respond with "no content" instead of a
                # 404 so it doesn't show up as an error in the browser console.
                $response.StatusCode = 204
                $statusLine = "204"
            }
            elseif ($method -eq 'GET') {
                $relative = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
                $filePath = Join-Path $Script:WebRoot $relative
                $resolvedRoot = [System.IO.Path]::GetFullPath($Script:WebRoot)
                $resolvedFile = [System.IO.Path]::GetFullPath($filePath)
                if (-not $resolvedFile.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $response.StatusCode = 403
                    $statusLine = "403"
                } else {
                    Send-FileResponse -Response $response -FilePath $resolvedFile
                    if ($response.StatusCode -eq 404) { $statusLine = "404" }
                }
            }
            else {
                $response.StatusCode = 405
                $statusLine = "405"
            }
        }
        catch {
            $statusLine = "ERROR: $($_.Exception.Message)"
            Send-JsonResponse -Response $response -Data ([PSCustomObject]@{ error = $_.Exception.Message }) -StatusCode 500
        }
        finally {
            Write-Host ("  [{0}] {1} {2} -> {3}" -f (Get-Date -Format 'HH:mm:ss'), $method, $path, $statusLine) -ForegroundColor DarkGray
            $response.OutputStream.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
