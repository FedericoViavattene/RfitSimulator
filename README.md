# Riftbound Deck Simulator

A local tool that simulates 50 games of your deck against a chosen opponent
deck, reports a winrate, and gives you deck-optimization feedback (which
cards to cut, curve issues, etc.) to help you build a stronger deck for
Nexus Night / Skirmish events. Comes in two front-ends that share the exact
same simulation engine (`RiftboundEngine.psm1`), so pick whichever you like:

- **`RunSimulator.bat`** - the original terminal/console experience.
- **`RunWebUI.bat`** - a nicer-looking local web page in your browser (see
  "Web UI" below). Nothing here is hosted online - it only runs on your own
  computer.
- **`ImportDeck.bat`** - turns a plain-text decklist into a real deck CSV
  automatically (see "Importing a deck from a text list" below). The web UI
  can also do this directly from a paste box.

## How to run it (console)

**Recommended (most reliable):** open PowerShell yourself and run the script
from an open console window:

```powershell
cd "C:\path\to\RiftboundSimulator"
.\RiftboundSim.ps1
```

After picking your deck, you're asked to choose a mode:
```
  1) Single opponent - 50 games (default)
  2) Matchup matrix - run vs EVERY saved opponent deck at once
  3) Best-of-3 match simulation - 20 matches vs one opponent
```
Press Enter to accept the default (mode 1), or type 2 or 3 - see "Matchup
matrix and best-of-3 matches" below for what each mode reports.

Double-clicking the `.ps1` file also works now - at the end of each
simulation you're given a menu:
```
  1) Return to main menu (run another simulation)
  2) Close simulator
```
Both options require pressing Enter, so the window will never close on its
own before you've read the results. Choosing "1" clears the screen and lets
you pick a new matchup (and a new mode) without restarting the script. Even
so, running it from an already-open console is still the more reliable
habit - some Windows security settings block a `.ps1` from running at all
when double-clicked, whereas running it from inside PowerShell always works.

If Windows blocks the script with an "execution policy" error, run this once
in PowerShell (as your normal user, not admin) and try again:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Web UI

Double-click **`RunWebUI.bat`**. It starts a small local web server (in its
own console window, so you can see activity logs and stop it with Ctrl+C)
and opens `http://localhost:8787` in your default browser.

- Everything runs **on your own computer only** - it's not hosted anywhere,
  not reachable from the internet or from other devices, and nothing about
  your decks or results leaves your machine. `localhost` only your PC can
  reach it.
- Pick your deck from the dropdown, then choose a **Mode**: a single
  opponent (50 games), a best-of-3 match simulation (20 matches), or a
  matchup matrix (every saved opponent deck at once - see "Matchup matrix
  and best-of-3 matches" below). The button label and the opponent-deck
  dropdown update automatically for whichever mode is selected.
- Hit the **Simulate** button and the same winrate, per-game/per-match log
  (green WIN / red LOSS), optimization report, and opponent decklist as the
  console version render as a clean page instead of terminal text.
- If port 8787 is already taken (e.g. by a previous "Riftbound Web Server"
  window you forgot to close), it automatically tries 8788, 8789, etc. and
  tells you in the console window which port it actually used - it also
  opens your browser to the right one automatically, so you don't need to
  track the port number yourself.
- If it still can't start after trying all of those (e.g. "could not start
  the local web server"), check Task Manager / your taskbar for a leftover
  `powershell.exe` window titled "Riftbound Web Server" and close it, or run
  `netstat -ano | findstr :8787` in PowerShell to see what else is using
  that port.
- To stop it, close the "Riftbound Web Server" console window it opened, or
  press Ctrl+C in it.

## Importing a deck from a text list

Instead of hand-building a CSV, you can paste or drop in a plain decklist -
one card per line - and every card's real Type/Energy/Power/Might/Domain
gets looked up automatically from `CardDatabase.json` (the same official
card gallery data used for the "Card-data verification pass" below). You
only need to get the card **name** and **quantity** right; the rest is
filled in for you, and it's checked against the official deckbuilding rules
(exactly 1 Legend, 3 Battlefields, 12 Runes, 40+ Main Deck cards, max 3
copies of any card) with a warning for anything that doesn't add up.

**Accepted line formats** (mix and match freely):
```
1 Jinx, Loose Cannon
3x Chemtech Enforcer
Baccai Reaper x2
Legend: Jinx, Loose Cannon
Battlefields:
```
Section labels (`Legend:`, `Battlefields:`, `Runes:`, `Main Deck:`, `Units:`,
`Spells:`, `Gear:`) are optional and only used as visual separators - they're
skipped, along with blank lines and `#` comment lines. A card's Type always
comes from the database, never from which section you pasted it under, so
you can't accidentally mislabel one.

**From the web UI (recommended):** open the **"Import a deck from a text
list"** panel above the deck pickers, choose where it should go (your decks,
or an opponent archetype folder), give it a name, paste the list, and hit
**Import deck**. The result panel shows what matched and any warnings, and
the deck dropdowns refresh immediately so you can simulate with it right
away.

**From the console:** save your list as a `.txt` file into `Decks\Import\`
(see `Decks\Import\_example.txt` for a full sample using every line format),
then run `ImportDeck.bat`. It lists the `.txt` files it finds, asks where to
put the result, and prints the same match/warning report.

Either way, the output is just a normal CSV in `Decks\MyDeck\` or
`Decks\Opponents\<Aggro|Midrange|Control>\` - if you ever want to hand-edit
it afterward (say, to fill in a `Tag`), it works exactly like every other
deck file described below.

The web UI and the console tool are two front-ends over the exact same
`RiftboundEngine.psm1` module, so they always agree on results - there's no
separate "web version of the rules" to keep in sync.

## What it does

1. Loads your deck from `Decks\MyDeck\*.csv` (if you have more than one CSV
   there, it asks you to pick).
2. Lets you pick an opponent deck from `Decks\Opponents\` - decks are grouped
   into **Aggro / Midrange / Control** subfolders and listed by the Legend
   they use.
3. Checks both decks against `Banned.csv` and automatically excludes any
   banned card/Battlefield, with a warning.
4. Simulates 50 games and prints a per-game result plus a final winrate %.
5. Optionally shows a one-line reason for each loss (deck-out, out-classed on
   Might, close loss, etc.) when you answer Y to the prompt.
6. Prints a deck-optimization report: your most-played cards, any cards that
   never got played (candidates to cut), and a curve check (average Energy
   cost) with a suggestion if it's too high or too low.
7. Optionally shows the opponent's full decklist (grouped by Legend / Battlefield
   / Rune / Unit / Spell / Gear, with Energy/Power/Might/Domain per card) when
   you answer Y to the prompt at the end.

## Matchup matrix and best-of-3 matches

Beyond the default "50 games vs one opponent" mode, both front-ends offer two
more ways to run the simulation - pick a mode from the console's "Choose a
mode" prompt, or the web UI's **Mode** dropdown:

- **Matchup matrix** - runs your deck against **every** saved opponent deck
  under `Decks\Opponents\` (Aggro/Midrange/Control, recursively) in one go,
  and reports a winrate per opponent plus an overall average. This is the
  fastest way to see "what does my deck struggle against across the whole
  meta" instead of testing one matchup at a time.
- **Best-of-3 match simulation** - real Riftbound tournament rounds (Nexus
  Night/Skirmish) are best-of-3, not a single game. This mode plays out 20
  full best-of-3 matches against one chosen opponent (each match ends as
  soon as one side wins 2 games) and reports the **match** winrate - "how
  often would I actually take the round" - separately from the underlying
  per-game results, since a deck that reliably grinds out a game 3 can have
  a very different match winrate than its raw single-game winrate suggests.

Both modes reuse the exact same `Invoke-SingleGame` logic as the default
mode (via `Invoke-GameBatch`/`Invoke-Match`/`Invoke-MatchBatch`/
`Get-MatchupMatrix` in `RiftboundEngine.psm1`) - there's no separate, looser
simulation just for these views.

## Legend abilities

Every Legend has real rules text, but this simulator's simplified card model
(Energy/Power/Might/Domain/Tag - see below) can't represent most of it
faithfully: mechanics like Empower/XP thresholds, exhaust/ready states,
Equip, and token generation aren't modeled by this engine at all, and
guessing at an approximation would go against this project's "don't
fabricate card behavior" rule.

Rather than leave every Legend ability silently ignored, or approximate all
of them and risk getting most wrong, **exactly two Legend abilities are
modeled, using their real, verified rules text**, because both happen to
fit cleanly into mechanics the engine already tracks:

| Legend | Real ability | How it's modeled |
|---|---|---|
| Rengar, Pridestalker | "When you play a unit, give a unit +1 [S] this turn." | +1 Might to a Battlefield the moment you play a Unit there |
| Draven, Glorious Executioner | "When you win a combat, draw 1." | Draw 1 card the moment you win a combat |

Every other Legend in the saved decks (Akali, Kennen, Master Yi, Fiora, Azir,
Kha'Zix, Irelia, Ezreal, Sett, Vex, Lillia, Shen) currently has **no**
simulated ability - their games still run purely on Energy/Power/Might/
Domain/Tag, same as before. This is a deliberate, honest limitation, not an
oversight: adding a new Legend ability means adding real rules text to that
Legend's `legendAbility` entry in `CardDatabase.json` (a small JSON object
with `trigger`/`effect`/`amount`, read by `Invoke-LegendAbilityTrigger` in
the engine) - no PowerShell code changes are needed, but each one still has
to be checked against the card's actual text first rather than guessed.

## Important: what this simulator IS and ISN'T

This is a **statistics/curve testing tool**, not a full Riftbound rules
engine. Riftbound has 1000+ unique cards, each with its own templated rules
text, and reimplementing every single one is out of scope for a local script.
Instead every card is reduced to:

| Column | Meaning |
|---|---|
| `Quantity` | Copies of this card in the deck |
| `Name` | Card name (must match a real card, and must exactly match an entry in Banned.csv to be caught by the ban check) |
| `Type` | `Legend`, `Unit`, `Spell`, `Gear`, `Battlefield`, or `Rune` |
| `Energy` | Energy cost to play it |
| `Power` | Power value (mostly flavor for this simulator - not currently scored) |
| `Might` | Might it contributes to a Battlefield while in play |
| `Domain` | Fury / Body / Calm / Order / Mind / Chaos (use `A/B` for two-domain cards) |
| `Tag` | Optional simplified effect - see below |

### Supported Tags

- `Remove:N` - removes up to N Might of the opponent's board presence when played (approximates removal spells).
- `Buff:N` - adds N Might to your own board total when played (approximates pump/combat tricks).
- `Draw:N` - draws N extra cards when played.
- `Shield:N` - adds N Might to a Battlefield, but **only while you are defending it** (models the real Shield keyword, Core Rules 814).

Cards with no relevant effect for simulation purposes (most vanilla units,
flavor spells, etc.) can just leave `Tag` blank.

### Rules actually modeled

- **Victory Score 8** (Core Rules 194.3): first to 8 points, with strictly more points than any opponent, wins.
- **Legend / Rune Deck / Battlefield Zone are separate from the Main Deck** (rules 103.3, 107.2, 107.4): `Legend`, `Rune`, and `Battlefield` rows in your CSV are set up once at the start of the game and are **never drawn or "played"** - so they never show up in the optimization report's play stats. Only `Unit`/`Spell`/`Gear` cards are in the drawable deck. This also means your Rune count doesn't need to add up to a specific deck-size target - it's tracked separately, same as the real Rune Deck (12 cards).
- **Channel**: +2 Energy per turn per player, from the (separate) Rune Deck (430.4.a / 315.3.b); the player going second channels 1 extra Rune on their first turn to offset going first (485.7).
- **Combat**: 3 shared, neutral Battlefields are used so two different decks can be compared fairly - a side Conquers a Battlefield by having strictly more Might than the opponent there (469.1.a).
- **Final Point restriction** (471.1.b): once a player is 1 point from Victory Score or higher, a Conquer only scores if they swept **every** Battlefield that turn - otherwise they draw a card instead.
- **Hard cap at 8**: the score can never exceed the Victory Score. In real Riftbound the only thing that raises Victory Score above 8 is a specific Battlefield effect, and that Battlefield is on the banned list - so with a legal decklist, games should never end on 9 or 10.
- **Burn Out** (431): drawing from an empty deck recycles the trash; if the trash is also empty, the player burns out and gives up a point every subsequent draw until someone hits Victory Score (this point also respects the 8-point cap).

### Loss diagnostics

Board Might resets to 0 at any Battlefield you just lost, so by the moment a
game ends your *final* board Might is almost always zero - that's real, but
comparing it every time just says "you had 0 Might" over and over, which
isn't useful. The loss-reason feature instead tracks stats **throughout** the
game and picks the most relevant one:

1. Burn Out (deck ran out of cards)
2. Out-classed on **peak** board Might (your best turn vs theirs, not your last turn)
3. Energy left unspent too often (curve too expensive / clogged hand)
4. Too many cards still stuck in hand at game end (top-heavy curve)
5. Never took the lead in points at any point in the game (they're just faster)
6. Very close (1-point) loss
7. Generic multi-turn tempo loss (fallback)

### Viewing the opponent's decklist

At the end of a simulation you're asked "View the opponent's full decklist?".
Answering Y prints every card in the opponent's deck (Legend, Battlefields,
Runes, Units, Spells, Gear), with Energy/Power/Might/Domain/Tag per card -
useful for planning what to actually expect at the table, not just the
aggregate winrate number.

### Keyword glossary

See `Keywords.md` for a quick-reference table of real Riftbound keywords
(Accelerate, Shield, Ganking, Legion, Tank, etc.) with notes on what
matchups each one is good/bad against - useful context while reading the
simulator's feedback, even though the simulator itself only understands the
four Tags above.

### Errata

See `Errata.md`. As of the most recent Vendetta errata update, all 8 errata'd
cards were rules-text wording clarifications only - none changed a card's
Energy/Power/Might numbers, so no deck CSV needed adjustment because of them.
If a future errata does change a number, just edit that card's row directly.

### Banned cards

`Banned.csv` mirrors https://riftbound.gg/rules/banned-cards/ (Standard
Constructed bans as of the most recent ban update). Both your deck and the
opponent deck are checked automatically at load time; any banned card found
is excluded and printed as a warning so you know your simulated deck is
tournament-legal.

## Folder structure

```
RiftboundSimulator/
  RunSimulator.bat           <- double-click for the console version
  RunWebUI.bat                <- double-click for the web UI
  ImportDeck.bat               <- double-click to import a .txt decklist (console)
  RiftboundSim.ps1            <- console front-end
  WebServer.ps1                <- web UI front-end (local HTTP server)
  ImportDeck.ps1                <- console text-list importer
  RiftboundEngine.psm1         <- shared simulation engine (used by all three)
  CardDatabase.json          <- ~935 real cards' Type/Energy/Power/Might/Domain,
                                  extracted from the official card gallery -
                                  used for both the card-data corrections and
                                  the text-list importer
  web/                          <- web UI's HTML/CSS/JS
    index.html
    style.css
    app.js
  Banned.csv                <- banned cards/battlefields
  Keywords.md                <- keyword glossary reference
  Errata.md                  <- errata notes
  Decks/
    Import/
      _example.txt            <- sample decklist showing every accepted format
    MyDeck/
      Rengar_Pridestalker.csv
      Shen_EyeOfTwilight.csv
    Opponents/
      Aggro/
        Akali_Rogue_Assassin.csv
        Fiora_Grand_Duelist.csv
        MasterYi_Wuju_Bladesman.csv
        KhaZix_Voidreaver.csv
        Sett_The_Boss.csv          <- real riftdecks.com list
      Midrange/
        Kennen_Heart_of_the_Tempest.csv
        Irelia_Blade_Dancer.csv
        Draven_Glorious_Executioner.csv
      Control/
        Azir_Emperor_of_the_Sands.csv
        Ezreal_Prodigal_Explorer.csv
        Vex_Gloomist.csv           <- real riftdecks.com list
        Lillia_Bashful_Bloom.csv   <- real riftdecks.com list
```

## About the opponent decks

These decks are built around the Legends that placed highest at the most
recent Riftbound Regional Qualifier (Singapore, Sept 4-6 2026, Vendetta
format) - source: https://riftbound.gg/singapore-regional-qualifier/. Real
Top 8/Top 16 Legends confirmed from that event: Akali (winner), Kennen
(finalist, and the dominant Legend across 3 straight regionals), Master Yi
(Wuju Bladesman and Wuju Master variants), Fiora, Azir, Rengar, and Kha'Zix,
plus Irelia, Draven and Ezreal as consistently strong Legends across the
current Vendetta meta.

**Every card's Energy/Power/Might/Domain is now verified against the official
card gallery** (https://playriftbound.com/en-us/card-gallery/), across all 5
sets released so far (Origins, Proving Grounds, Spiritforged, Unleashed,
Vendetta) - pulled via a community-maintained extraction of that gallery's own
data (https://github.com/riccjohn/riftbound-card-db), not estimated. This pass
also caught and fixed two bugs every deck had: (1) every deck had **two**
Legend rows instead of one (a leftover mistake from an earlier version - real
Riftbound decks run exactly one Legend), and (2) several decks used a wrong
domain pair for their Legend entirely (e.g. Azir was listed as Order/Mind;
the real card is Calm/Order). Both are now corrected everywhere.

For the 9 Legends whose 40-card lists were originally hand-approximated
(Akali, Fiora, Kha'Zix, Master Yi, Kennen, Irelia, Draven, Azir, Ezreal), the
card *names* turned out to be invented too (not just the numbers) - none of
them matched a real card. Those 9 decks were rebuilt from scratch using only
real cards that share a domain with that Legend, keeping each original slot's
intended Energy cost (so the curve shape - Aggro skews cheap, Control skews
toward the top end - is unchanged) while every card, stat and domain is now
real. Each also now legally follows the rules in the official deckbuilding
guide (https://playriftbound.com/en-us/news/rules-and-releases/deckbuilding-primer/):
exactly one Legend, a 40-card-minimum Main Deck, and at most 3 copies of any
one card. Cards belonging to a *different* champion's signature line were
deliberately excluded from these rebuilt decks, since the primer doesn't
confirm those are legal to splash into someone else's deck.

**Sett, The Boss / Lillia, Bashful Bloom / Vex, Gloomist** still use the exact
card choices from real published decks on riftDecks.com (card names,
quantities, Battlefields, and Rune split all match the source list) - see
https://riftdecks.com/riftbound-metagame/deck-sett-the-boss-147931,
https://riftdecks.com/riftbound-metagame/deck-lillia-bashful-bloom-110365, and
https://riftdecks.com/riftbound-metagame/deck-vex-gloomist-110330 - only now
with real Energy/Power/Might/Domain per card instead of estimates, and the
same double-Legend/domain fixes applied.

**One remaining simplification:** the `Tag` column (Remove/Buff/Draw/Shield -
this simulator's simplified stand-in for a card's actual rules text) was left
blank for every newly-added real card, except where a card literally has the
official `[Shield]` keyword. An early attempt to auto-guess other tags from
each card's rules text produced at least one wrong result (misreading a
scaling "pay more to permanently power up" ability as an immediate one-time
buff), so guessing was dropped in favor of leaving it blank rather than risking
more of those. If you want specific cards' Tags filled in, name them and it
can be done by hand, card by card.

If you want any other specific published decklist simulated the same way,
paste the riftdecks.com link (or the list itself) and it can be converted
into a new CSV.

## Adding more decks

Easiest: use the text-list importer (see "Importing a deck from a text list"
above) - paste or drop in a decklist and it writes the CSV for you with real
stats. Or drop a new CSV following the schema above directly into
`Decks\MyDeck\` (for your own decks) or the right archetype subfolder under
`Decks\Opponents\` (for opponents) by hand. Either way, the script picks up
any `.csv` file automatically - no code changes needed.
