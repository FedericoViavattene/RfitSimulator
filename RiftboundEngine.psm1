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
        [System.Collections.Generic.HashSet[string]]$BannedList
    )

    if (-not (Test-Path $Path)) {
        throw "Deck file not found: $Path"
    }

    $rows = Import-Csv -Path $Path
    $cards = New-Object 'System.Collections.Generic.List[object]'
    $displayRows = New-Object 'System.Collections.Generic.List[object]'
    $skippedOffDomain = 0
    $bannedFound = New-Object 'System.Collections.Generic.List[string]'

    # First pass: find the Legend's domain(s) if not supplied
    if (-not $LegendDomain) {
        $legendRow = $rows | Where-Object { $_.Type -eq 'Legend' } | Select-Object -First 1
        if ($legendRow) { $LegendDomain = $legendRow.Domain }
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
        return "Deck ran out of cards (Burn Out) and conceded a point on every subsequent draw - the deck is likely too thin for how long this game ran, or too much Energy went unspent early instead of refilling the board."
    }
    if ($Loser.PeakBoardMight -gt 0 -and $Winner.PeakBoardMight -gt 0 -and $Loser.PeakBoardMight -lt ($Winner.PeakBoardMight * 0.7)) {
        return "Out-classed on peak board Might (your best turn reached $($Loser.PeakBoardMight) vs the opponent's $($Winner.PeakBoardMight)) - the deck likely needs a higher average Might curve, or more Buff/Shield effects to compete for Battlefields."
    }
    if ($energyUsedPct -lt 0.75) {
        return ("Left Energy unspent on {0:P0} of the game on average - your hand likely had too many expensive cards clogging the curve early, or not enough cheap plays to use up Channel each turn." -f (1 - $energyUsedPct))
    }
    if ($cardsStuckInHand -ge 4) {
        return "Ended the game with $cardsStuckInHand cards still stuck in hand - the deck may be too top-heavy (too many high-Energy cards) to reliably deploy everything before the game ends."
    }
    if (-not $Loser.EverLed -and $Winner.EverLed) {
        return "Never took the lead in points at any stage of the game - the opponent's deck likely has a faster or more consistent early curve, forcing this deck to always play from behind."
    }
    if ($pointGap -eq 1) {
        return "Very close loss (lost by a single point after leading or trading for most of the game) - a single extra removal, Buff, or Shield effect could likely flip this matchup."
    }
    return "Fell behind on tempo across multiple turns rather than from one specific swing - review the overall curve and card count at each Energy cost for a smoother development."
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
#  TEXT-LIST DECK IMPORT
#  Lets the user drop in a plain decklist (pasted from riftdecks.com, the
#  official deckbuilder, or typed by hand) instead of hand-building a CSV.
#  Every card's real Type/Energy/Power/Might/Domain is looked up from
#  CardDatabase.json (extracted from the official card gallery) rather than
#  trusted from the text - so the only thing the text needs to get right is
#  the card name and how many copies.
# ============================================================================
function Import-CardDatabase {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Card database not found: $Path (this file ships with the simulator - if it's missing, something is wrong with the install)."
    }
    $raw = Get-Content -Path $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $db = @{}
    foreach ($prop in $raw.PSObject.Properties) {
        $db[$prop.Name.ToLowerInvariant()] = [PSCustomObject]@{
            Name      = $prop.Name
            Type      = $prop.Value.type
            Energy    = $prop.Value.energy
            Might     = $prop.Value.might
            Power     = $prop.Value.power
            Domains   = @($prop.Value.domains)
            IsToken   = [bool]$prop.Value.isToken
            Champions = @($prop.Value.champions)
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
    param([Parameter(Mandatory)][string[]]$Lines)

    $sectionHeaderOnly        = '^(?:Legend|Legends|Battlefield|Battlefields|Rune|Runes|Main ?Deck|Unit|Units|Spell|Spells|Gear)\s*:?\s*$'
    $sectionHeaderWithContent = '^(?:Legend|Legends|Battlefield|Battlefields|Rune|Runes|Main ?Deck|Unit|Units|Spell|Spells|Gear)\s*:\s*(.+)$'
    $leadingQty  = '^(\d+)\s*x?\s+(.+)$'
    $trailingQty = '^(.+?)\s*x\s*(\d+)$'

    $result = New-Object 'System.Collections.Generic.List[object]'
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

    $merged = [ordered]@{}
    foreach ($p in $Parsed) {
        $key = $p.Name.ToLowerInvariant()
        if ($merged.Contains($key)) {
            $merged[$key].Quantity += $p.Quantity
        } else {
            $merged[$key] = [PSCustomObject]@{ Name = $p.Name; Quantity = $p.Quantity }
        }
    }

    $rows = New-Object 'System.Collections.Generic.List[object]'
    $warnings = New-Object 'System.Collections.Generic.List[string]'

    foreach ($entry in $merged.Values) {
        $rec = $CardDatabase[$entry.Name.ToLowerInvariant()]
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

Export-ModuleMember -Function Get-BannedList, Get-DeckFileList, Import-Deck, New-PlayerState, Invoke-Draw, Invoke-MainPhase, Invoke-CombatStep, Get-LossReason, Invoke-SingleGame, Get-OptimizationStats, Import-CardDatabase, ConvertFrom-DeckText, Resolve-DeckList, Export-DeckCsv
