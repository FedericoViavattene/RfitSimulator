<#
.SYNOPSIS
    Riftbound TCG Deck Simulator - simulates 10 games of your deck vs a selected
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
$Script:GamesToSimulate = 10
$Script:RootPath        = $PSScriptRoot
$Script:MyDeckFolder    = Join-Path $RootPath 'Decks\MyDeck'
$Script:OpponentFolder  = Join-Path $RootPath 'Decks\Opponents'
$Script:BannedFile      = Join-Path $RootPath 'Banned.csv'

Import-Module (Join-Path $PSScriptRoot 'RiftboundEngine.psm1') -Force

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
        Write-Host "This tool simulates $($Script:GamesToSimulate) games of your deck vs a chosen opponent deck"
        Write-Host "and reports a winrate plus deck-optimization feedback."
        Write-Host ""
        Write-Host "NOTE: this is a statistical curve/Might simulator, not a full rules engine." -ForegroundColor DarkYellow
        Write-Host "It does not implement individual card abilities beyond simplified tags." -ForegroundColor DarkYellow

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

        $myDeck = Import-Deck -Path $myDeckPath -BannedList $bannedList
        if ($myDeck.BannedExcluded.Count -gt 0) {
            Write-Host ("WARNING: banned card(s)/battlefield(s) excluded from your deck: {0}" -f ($myDeck.BannedExcluded -join ', ')) -ForegroundColor Red
        }

        # --- Select opponent deck ---
        $opponentPath = Select-OpponentDeck -FolderPath $Script:OpponentFolder
        $opponentDeck = Import-Deck -Path $opponentPath -BannedList $bannedList
        if ($opponentDeck.BannedExcluded.Count -gt 0) {
            Write-Host ("WARNING: banned card(s)/battlefield(s) excluded from the opponent deck: {0}" -f ($opponentDeck.BannedExcluded -join ', ')) -ForegroundColor Red
        }

        Write-Host ""
        Write-Host ("Simulating: {0}  vs  {1}" -f $myDeck.Name, $opponentDeck.Name) -ForegroundColor Green

        # --- Run simulations ---
        $results = New-Object 'System.Collections.Generic.List[object]'
        for ($g = 1; $g -le $Script:GamesToSimulate; $g++) {
            $r = Invoke-SingleGame -DeckA $myDeck -DeckB $opponentDeck
            $results.Add($r)
            $isWin = ($r.Winner -eq "You")
            $outcome = if ($isWin) { "WIN " } else { "LOSS" }
            $outcomeColor = if ($isWin) { "Green" } else { "Red" }
            Write-Host ("  Game {0,2}: " -f $g) -NoNewline
            Write-Host $outcome -NoNewline -ForegroundColor $outcomeColor
            Write-Host ("  (You {0} - {1} Opponent)" -f $r.ScoreA, $r.ScoreB)
        }

        $wins = ($results | Where-Object { $_.Winner -eq "You" }).Count
        $winrate = [Math]::Round(($wins / $Script:GamesToSimulate) * 100, 1)

        Write-Title "RESULTS"
        Write-Host ("Wins: {0} / {1}" -f $wins, $Script:GamesToSimulate)
        $winrateColor = "Red"
        if ([double]$winrate -ge 50) { $winrateColor = "Green" }
        Write-Host ("Winrate: {0}%" -f $winrate) -ForegroundColor $winrateColor

        # --- Loss reasons ---
        $losses = $results | Where-Object { $_.Winner -ne "You" }
        if ($losses.Count -gt 0) {
            Write-Host ""
            $showReasons = Read-Host "Show a short reason for each loss? (Y/N)"
            if ($showReasons -match '^(?i)y') {
                Write-Title "LOSS BREAKDOWN"
                $gameNum = 0
                foreach ($r in $results) {
                    $gameNum++
                    if ($r.Winner -ne "You") {
                        Write-Host ("  Game {0,2}: {1}" -f $gameNum, $r.LossReason) -ForegroundColor Yellow
                    }
                }
            }
        }

        # --- Optimization report ---
        Show-OptimizationReport -Deck $myDeck -GameResults $results

        # --- View opponent decklist ---
        Write-Host ""
        $showOpponentList = Read-Host "View the opponent's full decklist? (Y/N)"
        if ($showOpponentList -match '^(?i)y') {
            Show-Decklist -Deck $opponentDeck
        }

        Write-Title "DONE"

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
