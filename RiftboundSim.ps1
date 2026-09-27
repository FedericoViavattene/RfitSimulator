<#
.SYNOPSIS
    Riftbound TCG Deck Simulator - simulates 50 games of your deck vs a selected
    opponent deck and reports a winrate plus deck-optimization feedback.

.DESCRIPTION
    This tool is a STATISTICAL / CURVE testing aid, not a full rules engine.
    It does NOT implement the individual rules text of every card (there are
    1000+ unique cards in Riftbound). Instead, each card is reduced to a small
    set of aggregate numbers:

        Energy  - Energy cost to play the card
        Power   - Power value contributed on resolution (spells/units)
        Might   - Might contributed to a Battlefield while the card is in play
        Domain  - the card's color identity (Fury/Body/Calm/Order/Mind/Chaos)
        Tag     - an optional simplified effect (see below)

    Supported simplified Tags:
        Remove:N   - removes up to N Might worth of enemy presence at a
                     Battlefield when played (approximates removal spells)
        Buff:N     - adds N extra Might to the acting player's board total
                     when played (approximates pump/combat tricks)
        Draw:N     - draws N extra cards when played
        Shield:N   - adds N Might to a Battlefield's defenses, but ONLY while
                     the card's controller is DEFENDING that Battlefield
                     (models the real Shield keyword, rule 814: "+X Might
                     while defending")

    Core rules modeled (see Riftbound-Core-Rules-RUP4-July-16-2026.pdf):
        - Victory Score: first player to reach 8 points wins (rule 194.3),
          provided they have strictly more points than every opponent.
        - Legend / Rune Deck / Battlefield Zone (rules 107.2, 107.4, 103.3):
          Legend, Rune, and Battlefield cards all live in their own pre-game
          zones, separate from the Main Deck, and are never drawn or played.
        - Channel Phase: each player channels 2 Runes/Energy per turn from
          their (separate) Rune Deck (rule 430.4.a / 315.3.b). The player
          going second channels 1 extra Rune on their first turn (485.7).
        - Combat / Battlefields: 3 shared, neutral Battlefields are used. A
          side Conquers a Battlefield by having strictly more Might there
          than the opponent (rule 469.1.a).
        - Final Point restriction (rule 471.1.b): once a player's score is 1
          point from the Victory Score or higher, a Conquer only grants them
          a point if they conquered EVERY Battlefield that turn (a full
          sweep) - otherwise they draw a card instead. The score is also
          hard-capped at the Victory Score (see RiftboundEngine.psm1).
        - Burn Out (rule 431): drawing from an empty deck recycles the
          trash; if the trash is ALSO empty, the player "burns out" and
          gives a point to their opponent every subsequent draw.

    Banned cards (per https://riftbound.gg/rules/banned-cards/) are read from
    Banned.csv and are automatically excluded from any deck at load time.

    The actual simulation engine lives in RiftboundEngine.psm1, shared with
    the local web UI (WebServer.ps1 + RunWebUI.bat) so both front-ends always
    agree on the rules.

.NOTES
    At the end of each simulation you get two options: return to the main
    menu (clears the screen and lets you run another matchup) or close the
    simulator. Either choice requires pressing Enter, so the window will
    never close on its own before you've had a chance to read the results.

    If you run this script by double-clicking it (or via a shortcut) instead
    of from an already-open PowerShell console, Windows may still block it
    entirely under some security settings - use RunSimulator.bat instead,
    which launches it with the execution policy bypassed for that one run.
#>

# ============================================================================
#  SETUP
# ============================================================================
$Script:GamesToSimulate  = 50
$Script:MatchesToSimulate = 20   # for "best-of-3 match" mode
$Script:BestOf           = 3
$Script:RootPath         = $PSScriptRoot
$Script:MyDeckFolder     = Join-Path $RootPath 'Decks\MyDeck'
$Script:OpponentFolder   = Join-Path $RootPath 'Decks\Opponents'
$Script:BannedFile       = Join-Path $RootPath 'Banned.csv'
$Script:CardDatabaseFile = Join-Path $RootPath 'CardDatabase.json'

Import-Module (Join-Path $PSScriptRoot 'RiftboundEngine.psm1') -Force

# Loaded once at startup - used to resolve each deck's real Legend ability (see
# Invoke-LegendAbilityTrigger in the engine) when importing a deck below.
$Script:CardDatabase = Import-CardDatabase -Path $Script:CardDatabaseFile

# ============================================================================
#  DISPLAY HELPERS
# ============================================================================
function Write-Title {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host ("  {0}" -f $Text) -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
}

function Write-SubTitle {
    param([string]$Text)
    Write-Host ""
    Write-Host ("--- {0} ---" -f $Text) -ForegroundColor DarkCyan
}

# ============================================================================
#  DECKLIST VIEWER (console)
# ============================================================================
function Show-Decklist {
    param([object]$Deck)

    Write-Title ("DECKLIST: {0}" -f ($Deck.Name -replace '_', ' '))

    $typeOrder = @('Legend','Battlefield','Rune','Unit','Spell','Gear')
    $grouped = $Deck.DisplayRows | Group-Object Type

    foreach ($t in $typeOrder) {
        $group = $grouped | Where-Object { $_.Name -eq $t }
        if (-not $group) { continue }

        Write-Host ""
        Write-Host ("[{0}]" -f $t.ToUpperInvariant()) -ForegroundColor Green
        foreach ($row in ($group.Group | Sort-Object Name)) {
            $tagText = if ($row.Tag) { " ({0})" -f $row.Tag } else { "" }
            if ($t -in @('Unit','Spell','Gear')) {
                Write-Host ("  {0,2}x {1,-32} [{2}E / {3}P / {4}M] {5}{6}" -f $row.Quantity, $row.Name, $row.Energy, $row.Power, $row.Might, $row.Domain, $tagText)
            } else {
                Write-Host ("  {0,2}x {1,-32} {2}" -f $row.Quantity, $row.Name, $row.Domain)
            }
        }
    }
    Write-Host ""
}

# ============================================================================
#  OPPONENT DECK SELECTION (console)
# ============================================================================
function Select-OpponentDeck {
    param([string]$FolderPath)

    $files = Get-DeckFileList -FolderPath $FolderPath -Recurse
    if (-not $files -or $files.Count -eq 0) {
        throw "No opponent deck CSV files were found under $FolderPath"
    }

    Write-SubTitle "Select an opponent deck"
    $index = 1
    $map = @{}
    $lastCategory = ""
    foreach ($f in $files) {
        if ($f.Category -ne $lastCategory) {
            Write-Host ""
            Write-Host ("[{0}]" -f $f.Category.ToUpperInvariant()) -ForegroundColor Green
            $lastCategory = $f.Category
        }
        Write-Host ("  {0,2}) {1}" -f $index, $f.Name)
        $map[$index] = $f.Path
        $index++
    }

    Write-Host ""
    $choice = Read-Host "Enter the number of the opponent deck to simulate against"
    $choiceInt = 0
    if (-not [int]::TryParse($choice, [ref]$choiceInt) -or -not $map.ContainsKey($choiceInt)) {
        throw "Invalid selection."
    }
    return $map[$choiceInt]
}

# ============================================================================
#  MATCHUP MATRIX (console)
# ============================================================================
function Show-MatchupMatrix {
    param([object[]]$Rows)

    Write-Title "MATCHUP MATRIX"
    $lastCategory = ""
    foreach ($row in $Rows) {
        $category = if ($row.Category) { $row.Category } else { "Opponents" }
        if ($category -ne $lastCategory) {
            Write-Host ""
            Write-Host ("[{0}]" -f $category.ToUpperInvariant()) -ForegroundColor Green
            $lastCategory = $category
        }
        $color = "Red"
        if ([double]$row.Winrate -ge 50) { $color = "Green" }
        Write-Host ("  {0,-32} " -f $row.Name) -NoNewline
        Write-Host ("{0,5}%" -f $row.Winrate) -NoNewline -ForegroundColor $color
        Write-Host ("  ({0}/{1})" -f $row.Wins, $row.Total) -ForegroundColor DarkGray
    }
    Write-Host ""
}

# ============================================================================
#  BEST-OF-N MATCH BREAKDOWN (console)
# ============================================================================
function Show-MatchBreakdown {
    param([object]$MatchBatch)

    Write-Title "MATCH RESULTS (Best of $($MatchBatch.BestOf))"
    $m = 0
    foreach ($match in $MatchBatch.Matches) {
        $m++
        $isWin = ($match.Winner -eq "You")
        $outcome = if ($isWin) { "WON " } else { "LOST" }
        $color = if ($isWin) { "Green" } else { "Red" }
        Write-Host ("  Match {0,2}: " -f $m) -NoNewline
        Write-Host $outcome -NoNewline -ForegroundColor $color
        Write-Host ("  (You {0} - {1} Opponent, games)" -f $match.GamesWonA, $match.GamesWonB)
    }

    Write-Host ""
    Write-Host ("Matches won: {0} / {1}" -f $MatchBatch.MatchWins, $MatchBatch.MatchCount)
    $winrateColor = "Red"
    if ([double]$MatchBatch.MatchWinrate -ge 50) { $winrateColor = "Green" }
    Write-Host ("Match winrate: {0}%" -f $MatchBatch.MatchWinrate) -ForegroundColor $winrateColor
}

# ============================================================================
#  OPTIMIZATION REPORT (console)
# ============================================================================
function Show-OptimizationReport {
    param([object]$Deck, [object[]]$GameResults)

    Write-SubTitle "Deck curve & optimization feedback"
    $stats = Get-OptimizationStats -Deck $Deck -GameResults $GameResults

    Write-Host ""
    Write-Host "Most frequently played cards (across all simulated games):" -ForegroundColor White
    foreach ($t in $stats.MostPlayed) {
        Write-Host ("  {0,-30} played {1} times" -f $t.Name, $t.Count)
    }

    Write-Host ""
    Write-Host "Cards that were NEVER played in any simulated game:" -ForegroundColor White
    if ($stats.NeverPlayed.Count -gt 0) {
        foreach ($n in $stats.NeverPlayed) { Write-Host ("  {0}" -f $n) -ForegroundColor DarkGray }
        Write-Host ""
        Write-Host "SUGGESTION: consider cutting or reducing copies of the cards above -" -ForegroundColor Magenta
        Write-Host "they were too expensive/clunky to ever fit into a turn during simulation." -ForegroundColor Magenta
    } else {
        Write-Host "  (none - every card in the deck got played at least once)" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host ("Average Energy cost across non-Legend/Rune/Battlefield cards: {0:N2}" -f $stats.AverageEnergy)
    if ($stats.CurveSuggestion) {
        Write-Host ("SUGGESTION: {0}" -f $stats.CurveSuggestion) -ForegroundColor Magenta
    }
}

# ============================================================================
#  MAIN PROGRAM
# ============================================================================
try {
    $bannedList = Get-BannedList -Path $Script:BannedFile
    $keepRunning = $true

    while ($keepRunning) {
        Write-Title "RIFTBOUND DECK SIMULATOR"
        Write-Host "This tool simulates games of your deck vs a chosen opponent deck (or the"
        Write-Host "whole meta at once) and reports a winrate plus deck-optimization feedback."
        Write-Host ""
        Write-Host "NOTE: this is a statistical curve/Might simulator, not a full rules engine." -ForegroundColor DarkYellow
        Write-Host "A small, verified set of real Legend abilities is modeled (see README) -" -ForegroundColor DarkYellow
        Write-Host "everything else reduces to simplified Energy/Might/Domain/Tag stats." -ForegroundColor DarkYellow

        # --- Select and load the player's deck ---
        Write-SubTitle "Your deck"
        $myDeckFiles = Get-DeckFileList -FolderPath $Script:MyDeckFolder
        if (-not $myDeckFiles -or $myDeckFiles.Count -eq 0) {
            throw "No deck CSV files found in $($Script:MyDeckFolder). Place your deck CSV there first."
        }
        if ($myDeckFiles.Count -eq 1) {
            $myDeckPath = $myDeckFiles[0].Path
            Write-Host "Using deck file: $($myDeckFiles[0].FileName)"
        } else {
            $i = 1
            $map = @{}
            foreach ($f in $myDeckFiles) {
                Write-Host ("  {0}) {1}" -f $i, $f.FileName)
                $map[$i] = $f.Path
                $i++
            }
            $sel = Read-Host "Multiple deck files found. Enter the number of your deck"
            $selInt = 0
            [void][int]::TryParse($sel, [ref]$selInt)
            $myDeckPath = $map[$selInt]
        }

        $myDeck = Import-Deck -Path $myDeckPath -BannedList $bannedList -CardDatabase $Script:CardDatabase
        if ($myDeck.BannedExcluded.Count -gt 0) {
            Write-Host ("WARNING: banned card(s)/battlefield(s) excluded from your deck: {0}" -f ($myDeck.BannedExcluded -join ', ')) -ForegroundColor Red
        }

        # --- Select a mode ---
        Write-SubTitle "Choose a mode"
        Write-Host "  1) Single opponent - $($Script:GamesToSimulate) games (default)"
        Write-Host "  2) Matchup matrix - run vs EVERY saved opponent deck at once"
        Write-Host "  3) Best-of-$($Script:BestOf) match simulation - $($Script:MatchesToSimulate) matches vs one opponent"
        $modeChoice = Read-Host "Choose an option (1, 2 or 3, Enter for 1)"
        if (-not $modeChoice) { $modeChoice = '1' }

        if ($modeChoice -eq '2') {
            # --- Mode 2: matchup matrix ---
            Write-Host ""
            Write-Host ("Running {0} vs every saved opponent deck..." -f $myDeck.Name) -ForegroundColor Green
            $matrixRows = Get-MatchupMatrix -MyDeck $myDeck -OpponentFolderPath $Script:OpponentFolder -BannedList $bannedList -CardDatabase $Script:CardDatabase -GameCount $Script:GamesToSimulate
            Show-MatchupMatrix -Rows $matrixRows

            $overallWinrate = 0
            if ($matrixRows.Count -gt 0) {
                $overallWinrate = [Math]::Round((($matrixRows | Measure-Object -Property Winrate -Average).Average), 1)
            }
            Write-Host ("Average winrate across all {0} saved opponent deck(s): {1}%" -f $matrixRows.Count, $overallWinrate) -ForegroundColor Cyan

            Write-Title "DONE"
        }
        elseif ($modeChoice -eq '3') {
            # --- Mode 3: best-of-N match simulation vs one opponent ---
            $opponentPath = Select-OpponentDeck -FolderPath $Script:OpponentFolder
            $opponentDeck = Import-Deck -Path $opponentPath -BannedList $bannedList -CardDatabase $Script:CardDatabase
            if ($opponentDeck.BannedExcluded.Count -gt 0) {
                Write-Host ("WARNING: banned card(s)/battlefield(s) excluded from the opponent deck: {0}" -f ($opponentDeck.BannedExcluded -join ', ')) -ForegroundColor Red
            }

            Write-Host ""
            Write-Host ("Simulating {0} best-of-{1} matches: {2}  vs  {3}" -f $Script:MatchesToSimulate, $Script:BestOf, $myDeck.Name, $opponentDeck.Name) -ForegroundColor Green

            $matchBatch = Invoke-MatchBatch -DeckA $myDeck -DeckB $opponentDeck -MatchCount $Script:MatchesToSimulate -BestOf $Script:BestOf
            Show-MatchBreakdown -MatchBatch $matchBatch

            # Flatten every individual game across every match so the existing
            # optimization report (which works off a flat game-results list)
            # can be reused without any change to Get-OptimizationStats itself.
            $allGames = New-Object 'System.Collections.Generic.List[object]'
            foreach ($match in $matchBatch.Matches) {
                foreach ($g in $match.Games) { $allGames.Add($g) }
            }
            Show-OptimizationReport -Deck $myDeck -GameResults $allGames

            Write-Host ""
            $showOpponentList = Read-Host "View the opponent's full decklist? (Y/N)"
            if ($showOpponentList -match '^(?i)y') {
                Show-Decklist -Deck $opponentDeck
            }

            Write-Title "DONE"
        }
        else {
            # --- Mode 1 (default): single opponent, N games ---
            $opponentPath = Select-OpponentDeck -FolderPath $Script:OpponentFolder
            $opponentDeck = Import-Deck -Path $opponentPath -BannedList $bannedList -CardDatabase $Script:CardDatabase
            if ($opponentDeck.BannedExcluded.Count -gt 0) {
                Write-Host ("WARNING: banned card(s)/battlefield(s) excluded from the opponent deck: {0}" -f ($opponentDeck.BannedExcluded -join ', ')) -ForegroundColor Red
            }

            Write-Host ""
            Write-Host ("Simulating: {0}  vs  {1}" -f $myDeck.Name, $opponentDeck.Name) -ForegroundColor Green

            $batch = Invoke-GameBatch -DeckA $myDeck -DeckB $opponentDeck -GameCount $Script:GamesToSimulate
            $g = 0
            foreach ($r in $batch.Results) {
                $g++
                $isWin = ($r.Winner -eq "You")
                $outcome = if ($isWin) { "WIN " } else { "LOSS" }
                $outcomeColor = if ($isWin) { "Green" } else { "Red" }
                Write-Host ("  Game {0,2}: " -f $g) -NoNewline
                Write-Host $outcome -NoNewline -ForegroundColor $outcomeColor
                Write-Host ("  (You {0} - {1} Opponent)" -f $r.ScoreA, $r.ScoreB)
            }

            Write-Title "RESULTS"
            Write-Host ("Wins: {0} / {1}" -f $batch.Wins, $batch.GameCount)
            $winrateColor = "Red"
            if ([double]$batch.Winrate -ge 50) { $winrateColor = "Green" }
            Write-Host ("Winrate: {0}%" -f $batch.Winrate) -ForegroundColor $winrateColor

            # --- Loss reasons ---
            $losses = $batch.Results | Where-Object { $_.Winner -ne "You" }
            if ($losses.Count -gt 0) {
                Write-Host ""
                $showReasons = Read-Host "Show a short reason for each loss? (Y/N)"
                if ($showReasons -match '^(?i)y') {
                    Write-Title "LOSS BREAKDOWN"
                    $gameNum = 0
                    foreach ($r in $batch.Results) {
                        $gameNum++
                        if ($r.Winner -ne "You") {
                            Write-Host ("  Game {0,2}: {1}" -f $gameNum, $r.LossReason) -ForegroundColor Yellow
                        }
                    }
                }
            }

            # --- Optimization report ---
            Show-OptimizationReport -Deck $myDeck -GameResults $batch.Results

            # --- View opponent decklist ---
            Write-Host ""
            $showOpponentList = Read-Host "View the opponent's full decklist? (Y/N)"
            if ($showOpponentList -match '^(?i)y') {
                Show-Decklist -Deck $opponentDeck
            }

            Write-Title "DONE"
        }

        # --- Post-simulation menu ---
        Write-Host ""
        Write-Host "  1) Return to main menu (run another simulation)"
        Write-Host "  2) Close simulator"
        $nextAction = Read-Host "Choose an option (1 or 2)"

        if ($nextAction -eq '1') {
            Clear-Host
        } else {
            Write-Host ""
            Write-Host "Closing simulator. Good luck at your next Nexus Night!" -ForegroundColor Cyan
            $keepRunning = $false
        }
    }
}
catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
    Write-Host ""
    Read-Host "An error occurred. Press Enter to close this window"
}
