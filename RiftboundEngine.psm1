<#
    RiftboundEngine.psm1

    Shared simulation engine for the Riftbound Deck Simulator. Both the console
    tool (RiftboundSim.ps1) and the local web UI (WebServer.ps1) import this
    module and call the exact same functions, so game logic only lives in one
    place and the two front-ends can never drift apart or disagree with each
    other. See RiftboundSim.ps1's own header comment for the full explanation
    of the rules modeled here (Victory Score, Final Point restriction, Legend/
    Rune/Battlefield zones, Burn Out, etc.) - that design documentation is not
    repeated in this file to avoid the two copies going stale relative to each
    other.
#>

# ============================================================================
#  BANNED CARD LIST
# ============================================================================
function Get-BannedList {
    param([string]$Path)

    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    if (-not (Test-Path $Path)) {
        return $set
    }
    $rows = Import-Csv -Path $Path
    foreach ($row in $rows) {
        if ($row.Name) {
            [void]$set.Add($row.Name.Trim().ToLowerInvariant())
        }
    }
    return $set
}

# ============================================================================
#  DECK FILE LISTING (used by the console picker and the web /api/decks)
# ============================================================================
function Get-DeckFileList {
    param(
        [Parameter(Mandatory)][string]$FolderPath,
        [switch]$Recurse
    )

    $files = Get-ChildItem -Path $FolderPath -Filter '*.csv' -File -ErrorAction SilentlyContinue -Recurse:$Recurse |
        Sort-Object DirectoryName, Name

    return @($files | ForEach-Object {
        $category = $null
        if ($Recurse) {
            $category = Split-Path (Split-Path $_.FullName -Parent) -Leaf
        }
        [PSCustomObject]@{
            Path     = $_.FullName
            FileName = $_.Name
            Name     = ([System.IO.Path]::GetFileNameWithoutExtension($_.Name) -replace '_', ' ')
            Category = $category
        }
    })
}

# ============================================================================
#  DECK IMPORT
# ============================================================================
function Import-Deck {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$LegendDomain = $null,
        [System.Collections.Generic.HashSet[string]]$BannedList,
        # Optional: when supplied (from Import-CardDatabase), the deck's Legend
        # is looked up by name and its real, verified LegendAbility (see
        # Invoke-LegendAbilityTrigger) is attached to the returned deck. Most
        # Legends have no entry there - see that function's comment for why.
        [hashtable]$CardDatabase
    )

    if (-not (Test-Path $Path)) {
        throw "Deck file not found: $Path"
    }

    $rows = Import-Csv -Path $Path
    $cards = New-Object 'System.Collections.Generic.List[object]'
    $displayRows = New-Object 'System.Collections.Generic.List[object]'
    $skippedOffDomain = 0
    $bannedFound = New-Object 'System.Collections.Generic.List[string]'

    # First pass: find the Legend's domain(s) if not supplied, and its name (for
    # the optional LegendAbility lookup below)
    $legendRow = $rows | Where-Object { $_.Type -eq 'Legend' } | Select-Object -First 1
    if (-not $LegendDomain -and $legendRow) { $LegendDomain = $legendRow.Domain }
    $legendName = $null
    if ($legendRow) { $legendName = $legendRow.Name.Trim() }
    $legendAbility = $null
    if ($CardDatabase -and $legendName) {
        $legendRec = $CardDatabase[$legendName.ToLowerInvariant()]
        if ($legendRec) { $legendAbility = $legendRec.LegendAbility }
    }
    $allowedDomains = @()
    if ($LegendDomain) {
        $allowedDomains = $LegendDomain -split '/' | ForEach-Object { $_.Trim() }
    }

    foreach ($row in $rows) {
        $name = $row.Name.Trim()

        if ($BannedList -and $BannedList.Contains($name.ToLowerInvariant())) {
            $bannedFound.Add($name) | Out-Null
            continue
        }

        # Legend, Rune, and Battlefield cards live in their own pre-game zones per the
        # Core Rules (Legend Zone - rule 107.4 / Rune Deck - rule 103.3 / Battlefield
        # Zone - rule 107.2). They are set up directly at the start of the game and are
        # NEVER part of the shuffled, drawable Main Deck - so they are not added to the
        # Library here, are never drawn into Hand, and never show up as "played cards"
        # in the optimization report. Rune channeling is instead modeled as a flat
        # +2 Energy/turn in the Channel Phase (rule 315.3.b).
        # Still record every non-banned row (including Legend/Rune/Battlefield) for the
        # "view decklist" feature, before the gameplay-only Library skip below.
        $displayRows.Add([PSCustomObject]@{
            Quantity = $row.Quantity
            Name     = $name
            Type     = $row.Type
            Energy   = $row.Energy
            Power    = $row.Power
            Might    = $row.Might
            Domain   = $row.Domain
            Tag      = $row.Tag
        })

        if ($row.Type -in @('Legend','Rune','Battlefield')) {
            continue
        }

        # Domain legality check
        if ($allowedDomains.Count -gt 0) {
            $cardDomains = @()
            if ($row.Domain) { $cardDomains = $row.Domain -split '/' | ForEach-Object { $_.Trim() } }
            $legal = $true
            if ($cardDomains.Count -gt 0) {
                $legal = $false
                foreach ($d in $cardDomains) {
                    if ($allowedDomains -contains $d) { $legal = $true; break }
                }
            }
            if (-not $legal) {
                $skippedOffDomain++
                continue
            }
        }

        $qty = [int]$row.Quantity
        for ($i = 0; $i -lt $qty; $i++) {
            $cards.Add([PSCustomObject]@{
                Name   = $name
                Type   = $row.Type
                Energy = [int]$row.Energy
                Power  = [int]$row.Power
                Might  = [int]$row.Might
                Domain = $row.Domain
                Tag    = $row.Tag
            })
        }
    }

    return @{
        Cards             = $cards
        Domain            = $LegendDomain
        Name              = [System.IO.Path]::GetFileNameWithoutExtension($Path)
        LegendName        = $legendName
        LegendAbility     = $legendAbility
        DisplayRows       = $displayRows
        BannedExcluded    = @($bannedFound | Select-Object -Unique)
        SkippedOffDomain  = $skippedOffDomain
    }
}

# ============================================================================
#  PLAYER STATE
# ============================================================================
function New-PlayerState {
    param([object]$Deck, [string]$Label)

    $shuffled = $Deck.Cards | Sort-Object { Get-Random }

    return [PSCustomObject]@{
        Label            = $Label
        DeckName         = $Deck.Name
        Domain           = $Deck.Domain
        Library          = New-Object 'System.Collections.Generic.List[object]' (,$shuffled)
        Hand             = New-Object 'System.Collections.Generic.List[object]'
        Trash            = New-Object 'System.Collections.Generic.List[object]'
        BoardMight       = @(0,0,0)          # Might committed per Battlefield index
        BattlefieldShield= @(0,0,0)          # Shield-tag bonus Might, applies only while defending
        Energy           = 0
        EnergySpent      = 0
        EnergyAvailable  = 0
        Score            = 0
        BurnOutCount     = 0
        PlayLog          = New-Object 'System.Collections.Generic.List[object]'
        PeakBoardMight   = 0      # Best total board Might this player ever held simultaneously (for loss diagnostics)
        EverLed          = $false # Was this player ever strictly ahead on points at some point in the game?
        LegendName       = $Deck.LegendName
        LegendAbility    = $Deck.LegendAbility  # $null unless Import-Deck was given a CardDatabase and this Legend has a modeled ability
    }
}

function Invoke-Draw {
    param([object]$Player, [int]$Count = 1)

    for ($i = 0; $i -lt $Count; $i++) {
        if ($Player.Library.Count -eq 0) {
            if ($Player.Trash.Count -eq 0) {
                # True Burn Out: opponent scores a point
                $Player.BurnOutCount++
                return $false
            }
            # Recycle trash back into the library (rule 431)
            $reshuffled = $Player.Trash | Sort-Object { Get-Random }
            $Player.Library.Clear()
            foreach ($c in $reshuffled) { $Player.Library.Add($c) }
            $Player.Trash.Clear()
        }
        $card = $Player.Library[0]
        $Player.Library.RemoveAt(0)
        $Player.Hand.Add($card)
    }
    return $true
}

# ============================================================================
#  LEGEND ABILITIES
#  A deliberately small, data-driven dispatcher. Most Legends are NOT listed
#  here - their real ability relies on mechanics this simplified statistical
#  engine doesn't model at all (Empower/XP counters, exhaust-ready state on
#  units or the Legend itself, Equip/Gear, token generation, targeted
#  "choose" effects...). Rather than approximate those into something that
#  LOOKS modeled but is actually a guess, they are left unmodeled - exactly
#  the same philosophy as the blank-Tag convention used elsewhere in this
#  project (see README's "Legend abilities" section for the full list of
#  what is and isn't covered, and why).
#
#  Adding a new one is a CardDatabase.json data entry (trigger/effect/amount
#  on that Legend's "legendAbility" field), not new engine code - as long as
#  its real ability maps onto one of the "effect" cases below. New effect
#  types get added to the switch here as they come up.
# ============================================================================
function Invoke-LegendAbilityTrigger {
    param(
        [object]$Player,
        [string]$Trigger,
        [int]$BattlefieldIndex = -1   # only meaningful for OnUnitPlayed
    )

    $ability = $Player.LegendAbility
    if (-not $ability -or $ability.trigger -ne $Trigger) { return }

    $amount = 1
    if ($ability.amount) { $amount = [int]$ability.amount }

    switch ($ability.effect) {
        'BuffBoardMightThisTurn' {
            if ($BattlefieldIndex -ge 0) { $Player.BoardMight[$BattlefieldIndex] += $amount }
        }
        'Draw' {
            Invoke-Draw -Player $Player -Count $amount | Out-Null
        }
    }
}

function Invoke-MainPhase {
    param([object]$Player, [object]$Opponent, [int]$BattlefieldCount = 3)

    $Player.EnergyAvailable = $Player.Energy
    $playable = $Player.Hand | Sort-Object Energy -Descending

    foreach ($card in $playable) {
        if ($card.Energy -le $Player.EnergyAvailable) {
            $Player.EnergyAvailable -= $card.Energy
            $Player.EnergySpent += $card.Energy
            $Player.Hand.Remove($card) | Out-Null

            # Assign Might to the Battlefield with the least current presence
            $targetBF = 0
            $lowest = [int]::MaxValue
            for ($b = 0; $b -lt $BattlefieldCount; $b++) {
                if ($Player.BoardMight[$b] -lt $lowest) { $lowest = $Player.BoardMight[$b]; $targetBF = $b }
            }
            $Player.BoardMight[$targetBF] += $card.Might

            if ($card.Type -eq 'Unit') {
                Invoke-LegendAbilityTrigger -Player $Player -Trigger 'OnUnitPlayed' -BattlefieldIndex $targetBF
            }

            # Apply simplified Tag effects
            if ($card.Tag) {
                $parts = $card.Tag -split ':'
                $tagName = $parts[0]
                $tagVal  = 0
                if ($parts.Count -gt 1) { [void][int]::TryParse($parts[1], [ref]$tagVal) }

                switch ($tagName) {
                    'Remove' {
                        $remaining = $tagVal
                        for ($b = 0; $b -lt $BattlefieldCount -and $remaining -gt 0; $b++) {
                            $take = [Math]::Min($remaining, $Opponent.BoardMight[$b])
                            $Opponent.BoardMight[$b] -= $take
                            $remaining -= $take
                        }
                    }
                    'Buff' {
                        $Player.BoardMight[$targetBF] += $tagVal
                    }
                    'Draw' {
                        Invoke-Draw -Player $Player -Count $tagVal | Out-Null
                    }
                    'Shield' {
                        $Player.BattlefieldShield[$targetBF] += $tagVal
                    }
                }
            }

            $Player.Trash.Add($card)
            $Player.PlayLog.Add($card.Name)
        }
    }
}

function Invoke-CombatStep {
    <#
        Implements Conquer scoring (rule 469.1.a / 471) including the "Final Point"
        restriction (rule 471.1.b): once a player's point total is 1 point from the
        Victory Score or higher, a Conquer only grants them a point if they conquered
        EVERY Battlefield this turn (a full sweep); otherwise they draw a card instead
        of scoring.

        The score is also HARD-CAPPED at the Victory Score and can never go higher.
        In real Riftbound the only thing that raises the Victory Score above 8 is a
        specific Battlefield effect, and that Battlefield is on the banned list - so
        with a legal decklist, the Victory Score is a hard ceiling and a game should
        never be reported as ending above it.
    #>
    param(
        [object]$Active,
        [object]$Defender,
        [int]$BattlefieldCount = 3,
        [int]$VictoryScore = 8
    )

    # Determine the winner of each Battlefield this turn from current board Might.
    # The Defender's Shield tag only applies while they are defending (i.e. always,
    # here, since $Defender is passed as whoever is NOT the turn player).
    $winners = New-Object 'object[]' $BattlefieldCount
    for ($b = 0; $b -lt $BattlefieldCount; $b++) {
        $mightActive   = $Active.BoardMight[$b]
        $mightDefender = $Defender.BoardMight[$b] + $Defender.BattlefieldShield[$b]

        if ($mightActive -gt $mightDefender) { $winners[$b] = $Active }
        elseif ($mightDefender -gt $mightActive) { $winners[$b] = $Defender }
        else { $winners[$b] = $null }
    }

    foreach ($side in @($Active, $Defender)) {
        $other = if ($side -eq $Active) { $Defender } else { $Active }
        $wonIdx = @()
        for ($b = 0; $b -lt $BattlefieldCount; $b++) {
            if ($winners[$b] -eq $side) { $wonIdx += $b }
        }
        if ($wonIdx.Count -eq 0) { continue }

        Invoke-LegendAbilityTrigger -Player $side -Trigger 'OnCombatWin'

        if ($side.Score -ge ($VictoryScore - 1)) {
            # Final Point restriction (471.1.b): only scores on a full sweep, and even
            # then only a single point - never more than the Victory Score.
            if ($wonIdx.Count -eq $BattlefieldCount) {
                $side.Score = [Math]::Min($side.Score + 1, $VictoryScore)
            } else {
                Invoke-Draw -Player $side -Count 1 | Out-Null
            }
        } else {
            # Normal scoring, but still clamped: a multi-Battlefield win from below the
            # threshold (e.g. a full sweep starting at 6 points) cannot jump past the
            # Victory Score in a single Combat Step.
            $side.Score = [Math]::Min($side.Score + $wonIdx.Count, $VictoryScore)
        }

        # Conquered Battlefields reset the loser's board Might there (rule 469.1.a).
        foreach ($b in $wonIdx) {
            $other.BoardMight[$b] = 0
        }
    }
}

# ============================================================================
#  LOSS DIAGNOSTICS
# ============================================================================
function Get-LossReason {
    <#
        Board Might is reset to 0 at any Battlefield the loser just lost (rule
        469.1.a), so by the moment a game ends, the loser's FINAL BoardMight is
        almost always all zeroes - comparing final Might would always say "you had
        0 Might", which is true but meaningless and repetitive. Instead this uses
        stats tracked THROUGHOUT the game (PeakBoardMight, EverLed, leftover Energy,
        cards stuck in hand) to give a more varied and useful diagnosis.

        Returns {Category; Text} rather than a bare string: Category is a short,
        stable key (BurnOut/MightMismatch/EnergyUnspent/HandClogged/NeverLed/
        CloseLoss/Tempo) that Get-MatchupRecommendation aggregates across a whole
        batch of games to find the *most common* reason this deck loses a given
        matchup, while Text stays the human-readable sentence both front-ends
        already print per game.
    #>
    param([object]$Loser, [object]$Winner)

    $pointGap = $Winner.Score - $Loser.Score
    $energyUsedPct = 1.0
    $totalEnergySeen = $Loser.EnergySpent + $Loser.EnergyAvailable
    if ($totalEnergySeen -gt 0) {
        $energyUsedPct = $Loser.EnergySpent / $totalEnergySeen
    }
    $cardsStuckInHand = $Loser.Hand.Count

    if ($Loser.BurnOutCount -gt 0) {
        return [PSCustomObject]@{
            Category = 'BurnOut'
            Text     = "Deck ran out of cards (Burn Out) and conceded a point on every subsequent draw - the deck is likely too thin for how long this game ran, or too much Energy went unspent early instead of refilling the board."
        }
    }
    if ($Loser.PeakBoardMight -gt 0 -and $Winner.PeakBoardMight -gt 0 -and $Loser.PeakBoardMight -lt ($Winner.PeakBoardMight * 0.7)) {
        return [PSCustomObject]@{
            Category = 'MightMismatch'
            Text     = "Out-classed on peak board Might (your best turn reached $($Loser.PeakBoardMight) vs the opponent's $($Winner.PeakBoardMight)) - the deck likely needs a higher average Might curve, or more Buff/Shield effects to compete for Battlefields."
        }
    }
    if ($energyUsedPct -lt 0.75) {
        return [PSCustomObject]@{
            Category = 'EnergyUnspent'
            Text     = ("Left Energy unspent on {0:P0} of the game on average - your hand likely had too many expensive cards clogging the curve early, or not enough cheap plays to use up Channel each turn." -f (1 - $energyUsedPct))
        }
    }
    if ($cardsStuckInHand -ge 4) {
        return [PSCustomObject]@{
            Category = 'HandClogged'
            Text     = "Ended the game with $cardsStuckInHand cards still stuck in hand - the deck may be too top-heavy (too many high-Energy cards) to reliably deploy everything before the game ends."
        }
    }
    if (-not $Loser.EverLed -and $Winner.EverLed) {
        return [PSCustomObject]@{
            Category = 'NeverLed'
            Text     = "Never took the lead in points at any stage of the game - the opponent's deck likely has a faster or more consistent early curve, forcing this deck to always play from behind."
        }
    }
    if ($pointGap -eq 1) {
        return [PSCustomObject]@{
            Category = 'CloseLoss'
            Text     = "Very close loss (lost by a single point after leading or trading for most of the game) - a single extra removal, Buff, or Shield effect could likely flip this matchup."
        }
    }
    return [PSCustomObject]@{
        Category = 'Tempo'
        Text     = "Fell behind on tempo across multiple turns rather than from one specific swing - review the overall curve and card count at each Energy cost for a smoother development."
    }
}

# ============================================================================
#  SINGLE GAME SIMULATION
# ============================================================================
function Invoke-SingleGame {
    param(
        [object]$DeckA,
        [object]$DeckB,
        [int]$VictoryScore = 8,
        [int]$EnergyPerTurn = 2,
        [int]$BattlefieldCount = 3,
        [int]$MaxTurns = 40
    )

    $playerA = New-PlayerState -Deck $DeckA -Label "You"
    $playerB = New-PlayerState -Deck $DeckB -Label "Opponent"

    Invoke-Draw -Player $playerA -Count 7 | Out-Null
    Invoke-Draw -Player $playerB -Count 7 | Out-Null

    # Player going second gets a small Energy head start (rule 430.4.a + catch-up)
    $playerB.Energy += 1

    $turn = 0
    $winner = $null

    while ($turn -lt $MaxTurns) {
        $turn++
        foreach ($pair in @(@($playerA,$playerB), @($playerB,$playerA))) {
            $active = $pair[0]
            $defender = $pair[1]

            $active.Energy += $EnergyPerTurn
            $okA = Invoke-Draw -Player $active -Count 1
            if (-not $okA) {
                # Burn Out point (rule 194.1.d) - not subject to the Final Point
                # restriction (194.1.a.1), but still capped at the Victory Score.
                $defender.Score = [Math]::Min($defender.Score + 1, $VictoryScore)
            }

            Invoke-MainPhase -Player $active -Opponent $defender -BattlefieldCount $BattlefieldCount

            # Track the best simultaneous board Might this player ever held, captured
            # right BEFORE Combat can zero out any Battlefield they end up losing -
            # used for more meaningful loss diagnostics later (see Get-LossReason).
            $activeMightNow = ($active.BoardMight | Measure-Object -Sum).Sum
            if ($activeMightNow -gt $active.PeakBoardMight) { $active.PeakBoardMight = $activeMightNow }

            Invoke-CombatStep -Active $active -Defender $defender -BattlefieldCount $BattlefieldCount -VictoryScore $VictoryScore

            if ($active.Score -gt $defender.Score) { $active.EverLed = $true }
            if ($defender.Score -gt $active.Score) { $defender.EverLed = $true }

            if ($active.Score -ge $VictoryScore -and $active.Score -gt $defender.Score) {
                $winner = $active
                break
            }
            if ($defender.Score -ge $VictoryScore -and $defender.Score -gt $active.Score) {
                $winner = $defender
                break
            }
        }
        if ($winner) { break }
    }

    if (-not $winner) {
        # Tiebreaker: higher score wins; if still tied, higher board Might wins
        if ($playerA.Score -ne $playerB.Score) {
            $winner = if ($playerA.Score -gt $playerB.Score) { $playerA } else { $playerB }
        } else {
            $mA = ($playerA.BoardMight | Measure-Object -Sum).Sum
            $mB = ($playerB.BoardMight | Measure-Object -Sum).Sum
            $winner = if ($mA -ge $mB) { $playerA } else { $playerB }
        }
    }

    $result = [PSCustomObject]@{
        Winner      = $winner.Label
        ScoreA      = $playerA.Score
        ScoreB      = $playerB.Score
        PlayLogA    = $playerA.PlayLog
        LossReason  = $null
    }

    if ($winner.Label -ne "You") {
        $result.LossReason = Get-LossReason -Loser $playerA -Winner $playerB
    }

    return $result
}

# ============================================================================
#  OPTIMIZATION STATS (data only - console and web each render this differently)
# ============================================================================
function Get-OptimizationStats {
    param([object]$Deck, [object[]]$GameResults)

    $allNonBasic = $Deck.Cards | Where-Object { $_.Type -notin @('Legend','Rune','Battlefield') }
    $byName = $allNonBasic | Group-Object Name

    $playedCounts = @{}
    foreach ($r in $GameResults) {
        foreach ($n in $r.PlayLogA) {
            if (-not $playedCounts.ContainsKey($n)) { $playedCounts[$n] = 0 }
            $playedCounts[$n]++
        }
    }

    $top = @($playedCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 5 | ForEach-Object {
        [PSCustomObject]@{ Name = $_.Key; Count = $_.Value }
    })

    $neverPlayed = @($byName | Where-Object { -not $playedCounts.ContainsKey($_.Name) } | Select-Object -ExpandProperty Name -Unique)

    $avgEnergy = 0
    if ($allNonBasic.Count -gt 0) {
        $avgEnergy = ($allNonBasic | Measure-Object -Property Energy -Average).Average
    }

    $curveSuggestion = $null
    if ($avgEnergy -gt 3.2) {
        $curveSuggestion = "Your curve is a bit top-heavy for a 2-Energy-per-turn Channel rate - consider adding a few more low-cost (1-2 Energy) cards for a smoother start."
    } elseif ($avgEnergy -lt 1.8) {
        $curveSuggestion = "Your curve is very low - you may be able to afford a few more impactful high-Might finishers without hurting consistency."
    }

    return [PSCustomObject]@{
        MostPlayed      = $top
        NeverPlayed     = $neverPlayed
        AverageEnergy   = [Math]::Round($avgEnergy, 2)
        CurveSuggestion = $curveSuggestion
    }
}

# ============================================================================
#  MATCHUP RECOMMENDATIONS + SIDEBOARD SUGGESTIONS
#  Turns a batch of already-simulated games against ONE specific opponent
#  into plain-language advice plus a short list of real, domain-legal cards
#  worth sideboarding in/out for that matchup - see Get-MatchupRecommendation
#  below for exactly what this is (and isn't).
# ============================================================================
function Get-MatchupRecommendation {
    <#
        This is a heuristic built entirely from stats this engine already
        tracks (loss-reason categories, curve, board Might) - NOT a rules
        simulation of sideboarding itself. It never invents a card's actual
        ability text (same "don't fabricate" rule as everywhere else in this
        project): a freshly-suggested card that isn't already in MyDeck has
        no Tag data to go on (Tag lives on deck CSV rows, not in
        CardDatabase.json), so scoring only ever uses real Energy/Might/
        Domain numbers, never a guessed effect. Swapping the suggested cards
        in/out and re-running the simulation is still the only way to know
        the real impact - see README's "Matchup recommendations and
        sideboard suggestions" section.

        OpponentCategory (Aggro/Midrange/Control) is normally the archetype
        folder the opponent deck was loaded from; when that's missing or
        unrecognized, it's inferred from the opponent's own average Energy
        so this still works for a deck outside the usual folder layout.
    #>
    param(
        [Parameter(Mandatory)][object]$MyDeck,
        [Parameter(Mandatory)][object]$OpponentDeck,
        [Parameter(Mandatory)][object[]]$GameResults,
        [Parameter(Mandatory)][hashtable]$CardDatabase,
        [string]$OpponentCategory = $null,
        [int]$MaxSideboardCards = 10
    )

    # ---- 1. Most common reason THIS deck lost, across every simulated game
    #         against THIS opponent (not a single game's diagnosis) ----
    $lossCategories = @($GameResults | Where-Object { $_.Winner -ne 'You' -and $_.LossReason } | ForEach-Object { $_.LossReason.Category })
    $primaryConcern = 'None'
    if ($lossCategories.Count -gt 0) {
        $primaryConcern = ($lossCategories | Group-Object | Sort-Object Count -Descending | Select-Object -First 1).Name
    }

    # ---- 2. Characterize the opponent's own curve, and fall back to
    #         inferring Aggro/Midrange/Control from it when the caller
    #         didn't pass a recognized category (e.g. a deck outside the
    #         Aggro/Midrange/Control subfolders) ----
    $oppNonBasic = @($OpponentDeck.Cards | Where-Object { $_.Type -notin @('Legend','Rune','Battlefield') })
    $oppAvgEnergy = 0
    if ($oppNonBasic.Count -gt 0) {
        $oppAvgEnergy = ($oppNonBasic | Measure-Object -Property Energy -Average).Average
    }
    if ($OpponentCategory -notin @('Aggro', 'Midrange', 'Control')) {
        $OpponentCategory = if ($oppAvgEnergy -lt 2.0) { 'Aggro' } elseif ($oppAvgEnergy -gt 3.0) { 'Control' } else { 'Midrange' }
    }

    # ---- 3. Plain-language advice: one line for the matchup shape, one for
    #         the dominant loss pattern - both plain lookup tables keyed by
    #         data already computed above, no per-deck/per-Legend branching ----
    $categoryAdvice = @{
        Aggro    = "Rival Aggro (curva baja, {0:N2} de Energia promedio): conviene estabilizar el tablero temprano y priorizar cartas baratas o con Shield." -f $oppAvgEnergy
        Midrange = "Rival Midrange (curva pareja, {0:N2} de Energia promedio): busca intercambios de Might favorables y evita quedarte atras de tempo." -f $oppAvgEnergy
        Control  = "Rival Control (curva alta, {0:N2} de Energia promedio): conviene cerrar el juego rapido, antes de que estabilice, priorizando una curva baja." -f $oppAvgEnergy
    }
    $concernAdvice = @{
        BurnOut       = 'Perdes por Burn Out (te quedas sin mazo): bajar el costo promedio de la curva suele ayudar mas que sumar mas robo, que solo acelera quedarte sin cartas.'
        MightMismatch = 'Te superan en el pico de Might del tablero: priorizar cartas con mas Might por Energia debería cerrar la brecha.'
        EnergyUnspent = 'Te queda Energia sin gastar seguido: bajar el costo promedio de la curva deberia ayudar a usar mejor el Channel de cada turno.'
        HandClogged   = 'Terminas con cartas trabadas en mano: la curva es demasiado top-heavy para este matchup en particular.'
        NeverLed      = 'Nunca tomas la delantera en puntos: este rival es mas rapido o consistente temprano, priorizar jugadas de 1-2 de Energia deberia ayudar.'
        CloseLoss     = 'Perdes por muy poco margen: una carta mas de Might o de curva baja puede alcanzar para dar vuelta este matchup.'
        Tempo         = 'Perdes tempo de forma pareja en varios turnos, no por un swing puntual: revisa el conteo de cartas en cada costo de Energia.'
        None          = 'Este mazo no perdio ninguna partida simulada contra este rival todavia - no hay un patron de derrota que corregir por ahora.'
    }

    $advice = New-Object 'System.Collections.Generic.List[string]'
    $advice.Add($categoryAdvice[$OpponentCategory])
    $advice.Add($concernAdvice[$primaryConcern])

    # ---- 4. What this matchup wants from a sideboard card, derived from the
    #         same two signals above (never hardcoded per Legend/deck) ----
    $wantsCheap = $primaryConcern -in @('EnergyUnspent', 'HandClogged', 'NeverLed', 'BurnOut') -or $OpponentCategory -eq 'Aggro'
    $wantsMight = $primaryConcern -eq 'MightMismatch' -or $OpponentCategory -in @('Aggro', 'Midrange')

    # ---- 5. Sideboard IN: real, domain-legal cards from CardDatabase.json
    #         that aren't already at the 3-copy legal max, scored for this
    #         matchup's needs ----
    $allowedDomains = @()
    if ($MyDeck.Domain) { $allowedDomains = @($MyDeck.Domain -split '/' | ForEach-Object { $_.Trim() }) }

    $currentCopies = @{}
    foreach ($row in $MyDeck.DisplayRows) {
        if ($row.Type -in @('Unit', 'Spell', 'Gear')) {
            $currentCopies[$row.Name.ToLowerInvariant()] = [int]$row.Quantity
        }
    }

    $seenNames = New-Object 'System.Collections.Generic.HashSet[string]'
    $inCandidates = New-Object 'System.Collections.Generic.List[object]'
    foreach ($rec in $CardDatabase.Values) {
        if (-not $seenNames.Add($rec.Name)) { continue }   # exact-name/normalized-name index alias for the same card
        if ($rec.IsToken) { continue }
        if ($rec.Type -notin @('Unit', 'Spell', 'Gear')) { continue }
        if ($null -eq $rec.Energy) { continue }

        $cardDomains = @($rec.Domains | Where-Object { $_ -and $_ -ne 'Colorless' })
        if ($allowedDomains.Count -gt 0 -and $cardDomains.Count -gt 0) {
            $legal = $false
            foreach ($d in $cardDomains) { if ($allowedDomains -contains $d) { $legal = $true; break } }
            if (-not $legal) { continue }
        }

        $existingQty = 0
        if ($currentCopies.ContainsKey($rec.Name.ToLowerInvariant())) { $existingQty = $currentCopies[$rec.Name.ToLowerInvariant()] }
        if ($existingQty -ge 3) { continue }

        $energy = [double]$rec.Energy
        $might  = [double]$rec.Might

        # Baseline efficiency (Might per Energy) so there's always a sensible
        # ranking even when neither wantsCheap nor wantsMight fired; the
        # matchup-specific bonuses on top of it are what actually change the
        # ordering per opponent.
        $score = 0.0
        if ($energy -gt 0) { $score += ($might / $energy) }
        if ($wantsCheap) { $score += [Math]::Max(0, 3 - $energy) * 1.5 }
        if ($wantsMight) { $score += ($might / [Math]::Max($energy, 1)) * 1.5 }
        if ($existingQty -gt 0) { $score += 0.25 }   # already proven to fit this deck's domains/curve

        if ($score -le 0) { continue }

        $domainStr = if ($cardDomains.Count -gt 0) { $cardDomains -join '/' } else { '' }
        $inCandidates.Add([PSCustomObject]@{
            Name   = $rec.Name
            Type   = $rec.Type
            Energy = $rec.Energy
            Might  = $rec.Might
            Domain = $domainStr
            Score  = [Math]::Round($score, 2)
        })
    }
    $sideboardIn = @($inCandidates | Sort-Object Score -Descending | Select-Object -First $MaxSideboardCards)

    # ---- 6. Sideboard OUT: the weakest maindeck cards for THIS matchup -
    #         "never played in any simulated game against this opponent" is
    #         the most defensible cut candidate (reuses the same PlayLogA
    #         data Get-OptimizationStats does), broken by a curve/Might
    #         tiebreak that matches whatever the matchup wants more of ----
    $playedCounts = @{}
    foreach ($r in $GameResults) {
        foreach ($n in $r.PlayLogA) {
            if (-not $playedCounts.ContainsKey($n)) { $playedCounts[$n] = 0 }
            $playedCounts[$n]++
        }
    }
    $myNonBasic = @($MyDeck.Cards | Where-Object { $_.Type -notin @('Legend', 'Rune', 'Battlefield') })
    $outCandidates = @($myNonBasic | Group-Object Name | ForEach-Object {
        $card = $_.Group[0]
        $timesPlayed = 0
        if ($playedCounts.ContainsKey($_.Name)) { $timesPlayed = $playedCounts[$_.Name] }
        $tiebreak = 0.0
        if ($wantsCheap) { $tiebreak = -1.0 * [double]$card.Energy }        # cut the most expensive cards first
        elseif ($wantsMight) { $tiebreak = [double]$card.Might }            # cut the lowest-Might cards first
        [PSCustomObject]@{
            Name        = $_.Name
            Type        = $card.Type
            Energy      = $card.Energy
            Might       = $card.Might
            Domain      = $card.Domain
            TimesPlayed = $timesPlayed
            CutPriority = ($timesPlayed * 1000.0) + $tiebreak
        }
    })
    $sideboardOutCount = [Math]::Min($MaxSideboardCards, $sideboardIn.Count)
    $sideboardOut = @($outCandidates | Sort-Object CutPriority | Select-Object -First $sideboardOutCount)

    return [PSCustomObject]@{
        OpponentCategory      = $OpponentCategory
        OpponentAverageEnergy = [Math]::Round($oppAvgEnergy, 2)
        PrimaryConcern        = $primaryConcern
        Advice                = @($advice)
        SideboardIn           = $sideboardIn
        SideboardOut          = $sideboardOut
    }
}

# ============================================================================
#  GAME BATCHES, BEST-OF-N MATCHES, AND THE MATCHUP MATRIX
#  One shared implementation of "run N of these" so the console and web UI
#  can never drift apart on how a batch/match/matrix is computed - each front
#  end only differs in how it FORMATS these results, never in how it derives
#  them.
# ============================================================================
function Invoke-GameBatch {
    <#
        Runs GameCount single games of DeckA vs DeckB and returns the full
        list of results plus the aggregate winrate. This is the single game
        loop that used to be duplicated (with its own winrate math) inside
        both RiftboundSim.ps1 and WebServer.ps1 - now there is exactly one
        version of "what does a batch of games mean".
    #>
    param(
        [Parameter(Mandatory)][object]$DeckA,
        [Parameter(Mandatory)][object]$DeckB,
        [int]$GameCount = 50
    )

    $results = New-Object 'System.Collections.Generic.List[object]'
    for ($g = 1; $g -le $GameCount; $g++) {
        $results.Add((Invoke-SingleGame -DeckA $DeckA -DeckB $DeckB))
    }

    $wins = @($results | Where-Object { $_.Winner -eq 'You' }).Count
    $winrate = 0
    if ($GameCount -gt 0) { $winrate = [Math]::Round(($wins / $GameCount) * 100, 1) }

    return [PSCustomObject]@{
        Results   = $results
        Wins      = $wins
        GameCount = $GameCount
        Winrate   = $winrate
    }
}

function Invoke-Match {
    <#
        Simulates one best-of-N match (real Riftbound tournament play, e.g.
        Nexus Night/Skirmish, is best-of-3) by re-running Invoke-SingleGame
        until either side has won a majority of the games needed, rather than
        treating every game as an independent, isolated data point. Returns
        the individual game results too, so a caller can still show a
        per-game breakdown within the match.
    #>
    param(
        [Parameter(Mandatory)][object]$DeckA,
        [Parameter(Mandatory)][object]$DeckB,
        [int]$BestOf = 3
    )

    $gamesToWin = [Math]::Ceiling($BestOf / 2.0)
    $games = New-Object 'System.Collections.Generic.List[object]'
    $winsA = 0
    $winsB = 0

    while ($winsA -lt $gamesToWin -and $winsB -lt $gamesToWin) {
        $g = Invoke-SingleGame -DeckA $DeckA -DeckB $DeckB
        $games.Add($g)
        if ($g.Winner -eq 'You') { $winsA++ } else { $winsB++ }
    }

    $matchWinner = 'Opponent'
    if ($winsA -ge $gamesToWin) { $matchWinner = 'You' }

    return [PSCustomObject]@{
        Winner    = $matchWinner
        GamesWonA = $winsA
        GamesWonB = $winsB
        BestOf    = $BestOf
        Games     = $games
    }
}

function Invoke-MatchBatch {
    <#
        Runs MatchCount best-of-BestOf matches and reports the match-level
        winrate (how often you take the MATCH, not any single game inside
        it) - the number that actually maps to "would I have won the round
        at a real event", which single-game winrate alone doesn't capture
        (e.g. a deck that always goes to a decisive game 3 can have a modest
        single-game winrate but a very different match winrate).
    #>
    param(
        [Parameter(Mandatory)][object]$DeckA,
        [Parameter(Mandatory)][object]$DeckB,
        [int]$MatchCount = 10,
        [int]$BestOf = 3
    )

    $matches = New-Object 'System.Collections.Generic.List[object]'
    for ($i = 1; $i -le $MatchCount; $i++) {
        $matches.Add((Invoke-Match -DeckA $DeckA -DeckB $DeckB -BestOf $BestOf))
    }

    $matchWins = @($matches | Where-Object { $_.Winner -eq 'You' }).Count
    $matchWinrate = 0
    if ($MatchCount -gt 0) { $matchWinrate = [Math]::Round(($matchWins / $MatchCount) * 100, 1) }

    return [PSCustomObject]@{
        Matches      = $matches
        MatchWins    = $matchWins
        MatchCount   = $MatchCount
        MatchWinrate = $matchWinrate
        BestOf       = $BestOf
    }
}

function Get-MatchupMatrix {
    <#
        Runs MyDeck against every deck found in OpponentFolderPath (recursing
        into the Aggro/Midrange/Control subfolders) and returns one row per
        opponent - a "how do I stack up against the whole meta" view instead
        of having to run one matchup at a time. Set -UseMatches to report
        best-of-BestOf match winrate per opponent instead of single-game
        winrate (see Invoke-MatchBatch for why those numbers can differ).
    #>
    param(
        [Parameter(Mandatory)][object]$MyDeck,
        [Parameter(Mandatory)][string]$OpponentFolderPath,
        [System.Collections.Generic.HashSet[string]]$BannedList,
        [hashtable]$CardDatabase,
        [int]$GameCount = 50,
        [switch]$UseMatches,
        [int]$BestOf = 3,
        [int]$MatchCount = 10
    )

    $opponentFiles = Get-DeckFileList -FolderPath $OpponentFolderPath -Recurse
    $rows = New-Object 'System.Collections.Generic.List[object]'

    foreach ($f in $opponentFiles) {
        $oppDeck = Import-Deck -Path $f.Path -BannedList $BannedList -CardDatabase $CardDatabase

        if ($UseMatches) {
            $batch = Invoke-MatchBatch -DeckA $MyDeck -DeckB $oppDeck -MatchCount $MatchCount -BestOf $BestOf
            $winrate = $batch.MatchWinrate
            $wins = $batch.MatchWins
            $total = $batch.MatchCount
        } else {
            $batch = Invoke-GameBatch -DeckA $MyDeck -DeckB $oppDeck -GameCount $GameCount
            $winrate = $batch.Winrate
            $wins = $batch.Wins
            $total = $batch.GameCount
        }

        $rows.Add([PSCustomObject]@{
            Name     = ($oppDeck.Name -replace '_', ' ')
            Category = $f.Category
            Winrate  = $winrate
            Wins     = $wins
            Total    = $total
        })
    }

    return @($rows | Sort-Object Category, Name)
}

# ============================================================================
#  TEXT-LIST DECK IMPORT
#  Lets the user drop in a plain decklist (pasted from riftdecks.com, the
#  official deckbuilder, or typed by hand) instead of hand-building a CSV.
#  Every card's real Type/Energy/Power/Might/Domain is looked up from
#  CardDatabase.json (extracted from the official card gallery) rather than
#  trusted from the text - so the only thing the text needs to get right is
#  the card name and how many copies.
# ============================================================================
function ConvertTo-NormalizedCardName {
    <#
        Strips commas, apostrophes and periods and collapses whitespace, so a
        paste that dropped punctuation ("Rengar Pridestalker", "Emperors
        Dais") can still resolve to the real card ("Rengar, Pridestalker",
        "Emperor's Dais"). Verified against the full card database that no
        two distinct real cards normalize to the same value, so this never
        introduces an ambiguous match.
    #>
    param([string]$Name)
    if (-not $Name) { return '' }
    $n = $Name.ToLowerInvariant()
    $n = $n -replace [char]0x2019, "'"
    $n = $n -replace '[,''.!"]', ''
    $n = $n -replace '\s+', ' '
    return $n.Trim()
}

function Import-CardDatabase {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Card database not found: $Path (this file ships with the simulator - if it's missing, something is wrong with the install)."
    }
    $raw = Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $db = @{}
    foreach ($prop in $raw.PSObject.Properties) {
        $rec = [PSCustomObject]@{
            Name          = $prop.Name
            Type          = $prop.Value.type
            Energy        = $prop.Value.energy
            Might         = $prop.Value.might
            Power         = $prop.Value.power
            Domains       = @($prop.Value.domains)
            IsToken       = [bool]$prop.Value.isToken
            Champions     = @($prop.Value.champions)
            # $null for every Legend except the small, verified set that has one
            # (see Invoke-LegendAbilityTrigger) - never guessed for the rest.
            LegendAbility = $prop.Value.legendAbility
        }
        $db[$prop.Name.ToLowerInvariant()] = $rec

        # Also index by the punctuation-stripped form (see ConvertTo-NormalizedCardName)
        # so pastes that drop commas/apostrophes still resolve. Never overwrites an
        # exact-name key.
        $normKey = ConvertTo-NormalizedCardName $prop.Name
        if ($normKey -and -not $db.Contains($normKey)) {
            $db[$normKey] = $rec
        }
    }
    return $db
}

function ConvertFrom-DeckText {
    <#
        Parses a pasted/typed decklist (one card per line) into a list of
        @{ Quantity; Name } pairs. Tolerant of the usual paste formats:
            1 Rengar, Pridestalker
            3x Inferna
            3 x Inferna
            Inferna x3
            Legend: Sett, The Boss          (section-header-with-content)
        Blank lines, "#" comment lines, and bare section headers (Legend:,
        Battlefields:, Runes:, Main Deck:, Units:, Spells:, Gear: with
        nothing else on the line) are skipped - they're just labels. A
        card's real Type/stats always come from the card database, never
        from which section it was pasted under.
    #>
    # NOTE: deliberately NOT [Parameter(Mandatory)] - PowerShell auto-rejects a
    # Mandatory string/string[] argument that resolves to an empty string with a
    # cryptic "Cannot bind argument to parameter 'Lines' because it is an empty
    # string" error (this bit real users: e.g. Get-Content returns a bare empty
    # string, not an array, for a file that reduces to a single blank line). We
    # handle empty/null input ourselves below and report it through the normal
    # "no card lines found" message instead.
    param([AllowNull()][AllowEmptyCollection()][string[]]$Lines = @())

    $sectionHeaderOnly        = '^(?:Legend|Legends|Battlefield|Battlefields|Rune|Runes|Main ?Deck|Unit|Units|Spell|Spells|Gear)\s*:?\s*$'
    $sectionHeaderWithContent = '^(?:Legend|Legends|Battlefield|Battlefields|Rune|Runes|Main ?Deck|Unit|Units|Spell|Spells|Gear)\s*:\s*(.+)$'
    $leadingQty  = '^(\d+)\s*x?\s+(.+)$'
    $trailingQty = '^(.+?)\s*x\s*(\d+)$'

    $result = New-Object 'System.Collections.Generic.List[object]'
    if (-not $Lines) { return $result }
    foreach ($raw in $Lines) {
        $line = $raw.Trim()
        if (-not $line) { continue }
        if ($line.StartsWith('#')) { continue }
        if ($line -match $sectionHeaderOnly) { continue }

        if ($line -match $sectionHeaderWithContent) {
            $line = $Matches[1].Trim()
        }
        if (-not $line) { continue }

        $qty = 1
        $name = $line
        if ($line -match $leadingQty) {
            $qty = [int]$Matches[1]
            $name = $Matches[2].Trim()
        } elseif ($line -match $trailingQty) {
            $name = $Matches[1].Trim()
            $qty = [int]$Matches[2]
        }

        # normalize curly quotes some sites paste in, so they still match
        $name = $name -replace [char]0x2019, "'" -replace [char]0x2018, "'"
        $name = $name -replace [char]0x201C, '"' -replace [char]0x201D, '"'
        $name = $name.Trim(' ', '"')

        if ($name) {
            $result.Add([PSCustomObject]@{ Quantity = $qty; Name = $name })
        }
    }
    return $result
}

function Resolve-DeckList {
    <#
        Resolves parsed (Quantity, Name) pairs against the card database,
        returning real CSV-ready rows plus a report of anything skipped or
        adjusted (unmatched names, tokens, >3-copy caps, duplicate lines,
        and legality checks: exactly 1 Legend, 3 Battlefields, 12 Runes,
        40+ Main Deck cards - per the official deckbuilding rules).
    #>
    param(
        [Parameter(Mandatory)][object[]]$Parsed,
        [Parameter(Mandatory)][hashtable]$CardDatabase,
        [int]$MaxCopies = 3
    )

    # Merge by normalized name (not raw lowercase) so "Rengar, Pridestalker" and
    # a punctuation-dropped "Rengar Pridestalker" pasted on separate lines are
    # recognized as the same card and their quantities combined.
    $merged = [ordered]@{}
    foreach ($p in $Parsed) {
        $normKey = ConvertTo-NormalizedCardName $p.Name
        if (-not $normKey) { continue }
        if ($merged.Contains($normKey)) {
            $merged[$normKey].Quantity += $p.Quantity
        } else {
            $merged[$normKey] = [PSCustomObject]@{ Name = $p.Name; Quantity = $p.Quantity }
        }
    }

    $rows = New-Object 'System.Collections.Generic.List[object]'
    $warnings = New-Object 'System.Collections.Generic.List[string]'

    foreach ($entry in $merged.Values) {
        # Try the exact name first, then fall back to a punctuation-stripped
        # match - a paste that dropped commas/apostrophes ("Rengar Pridestalker",
        # "Emperors Dais") still resolves to the real card.
        $rec = $CardDatabase[$entry.Name.ToLowerInvariant()]
        if (-not $rec) {
            $rec = $CardDatabase[(ConvertTo-NormalizedCardName $entry.Name)]
        }
        if (-not $rec) {
            $warnings.Add("Not found in the card database, skipped: '$($entry.Name)'")
            continue
        }
        if ($rec.IsToken) {
            $warnings.Add("'$($rec.Name)' is a token (created by another card's effect, not something you deck-build with) - skipped.")
            continue
        }
        $qty = $entry.Quantity
        if ($rec.Type -in @('Unit','Spell','Gear') -and $qty -gt $MaxCopies) {
            $warnings.Add("'$($rec.Name)': $qty copies requested, capped at $MaxCopies (the official max copies of one card).")
            $qty = $MaxCopies
        }
        $domainStr = if (($rec.Domains -join ',') -eq 'Colorless') { '' } else { ($rec.Domains -join '/') }
        $rows.Add([PSCustomObject]@{
            Quantity = $qty
            Name     = $rec.Name
            Type     = $rec.Type
            Energy   = $rec.Energy
            Power    = $rec.Power
            Might    = $rec.Might
            Domain   = $domainStr
            Tag      = ''
        })
    }

    $legendCount = @($rows | Where-Object { $_.Type -eq 'Legend' }).Count
    $runeTotal   = ($rows | Where-Object { $_.Type -eq 'Rune' } | Measure-Object -Property Quantity -Sum).Sum
    $bfCount     = @($rows | Where-Object { $_.Type -eq 'Battlefield' }).Count
    $mainTotal   = ($rows | Where-Object { $_.Type -in @('Unit','Spell','Gear') } | Measure-Object -Property Quantity -Sum).Sum
    if (-not $runeTotal) { $runeTotal = 0 }
    if (-not $mainTotal) { $mainTotal = 0 }

    if ($legendCount -ne 1) { $warnings.Add("Deck has $legendCount Legend card(s) - a legal deck needs exactly 1.") }
    if ($bfCount -ne 3) { $warnings.Add("Deck has $bfCount Battlefield(s) - a legal deck needs exactly 3.") }
    if ($runeTotal -ne 12) { $warnings.Add("Rune Deck has $runeTotal card(s) - a legal Rune Deck is exactly 12.") }
    if ($mainTotal -lt 40) { $warnings.Add("Main Deck has $mainTotal card(s) - the official minimum is 40.") }

    return [PSCustomObject]@{
        Rows             = $rows
        Warnings         = $warnings
        LegendCount      = $legendCount
        RuneTotal        = $runeTotal
        BattlefieldCount = $bfCount
        MainDeckTotal    = $mainTotal
    }
}

function Export-DeckCsv {
    param([Parameter(Mandatory)][object[]]$Rows, [Parameter(Mandatory)][string]$Path)
    $Rows | Select-Object Quantity, Name, Type, Energy, Power, Might, Domain, Tag |
        Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
}

Export-ModuleMember -Function Get-BannedList, Get-DeckFileList, Import-Deck, New-PlayerState, Invoke-Draw, Invoke-LegendAbilityTrigger, Invoke-MainPhase, Invoke-CombatStep, Get-LossReason, Invoke-SingleGame, Get-OptimizationStats, Get-MatchupRecommendation, Invoke-GameBatch, Invoke-Match, Invoke-MatchBatch, Get-MatchupMatrix, Import-CardDatabase, ConvertFrom-DeckText, Resolve-DeckList, Export-DeckCsv
