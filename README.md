# Riftbound Deck Simulator

Simulates your Riftbound deck against a chosen opponent deck (or the whole
saved meta at once), reports a winrate, and gives you deck-optimization
feedback (which cards to cut, curve issues, etc.) to help you build a
stronger deck for Nexus Night / Skirmish events.

There is **one app and one simulation engine** (`docs/engine.js`), used in two
places:

- **On your PC** - double-click **`RunWebUI.bat`**. It opens the app in your
  browser and uses the deck CSV files under `Decks\`.
- **On your phone** - the same app, published to GitHub Pages from the
  `docs/` folder and installed to your home screen. It works offline and
  keeps its decks on the phone.

Same rules, same results and same screens on both - the only difference is
where decks are stored.

## How to run it on your PC

Double-click **`RunWebUI.bat`**. It starts a small local web server (in its
own console window, so you can see activity logs and stop it with Ctrl+C)
and opens `http://localhost:8787` in your default browser.

- Everything runs **on your own computer only** - it's not hosted anywhere,
  not reachable from the internet or from other devices, and nothing about
  your decks or results leaves your machine. `localhost` only your PC can
  reach it.
- The simulation itself runs inside the browser (`docs/engine.js`, the same
  file the phone runs). The server, `WebServer.ps1`, only serves the `docs/`
  folder and reads/writes the deck CSVs under `Decks\` for it. Nothing extra
  to install - it uses Windows PowerShell and .NET's built-in HttpListener.
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

## Using the app

- The page has three tabs at the top: **Simulate** (the main flow),
  **Decks** (the deck editor - see "Editing a deck" below) and **Import**
  (paste a text decklist). A **step indicator** (Your deck → Mode → Opponent →
  Run it) tracks your progress through the Simulate tab so it's always
  obvious what's left to fill in before you can run anything; it collapses
  to 3 steps in matchup-matrix mode since there's no single opponent to
  pick.
- **Picking a deck** opens a photo picker instead of a plain dropdown: for
  the opponent deck, first pick one of the 3 archetype categories (Aggro /
  Midrange / Control), then tap a tile in the mosaic of that category's
  Legends - each tile shows the Legend's official card art and how many
  saved decks exist for it, so adding a second deck for the same Legend
  later just adds a "2 decks available" step instead of a new tile. Picking
  your own deck skips the category step and goes straight to the mosaic. A
  tile with no matching art yet (or no network) falls back to a plain
  initial-letter placeholder rather than breaking - nothing to configure.
- Then choose a **Mode** by clicking one of the three mode cards: a single
  opponent (1000 games), a best-of-3 match simulation (200 matches), or a
  matchup matrix (500 games against every saved opponent deck - see
  "Matchup matrix and best-of-3 matches" below). The button label and the
  opponent-deck field update automatically for whichever mode is selected.
  The run sizes live in one place, `RUN_SIZES` in `docs/engine.js`.
- **Seed (optional):** every run is driven by a seed, shown under the
  winrate. Leave the field blank for a fresh random run, or type a seed from
  an earlier result to replay that exact run - handy to compare a deck
  change against the same luck.
- Hit the **Simulate** button and the page scrolls straight to your
  results: a winrate card with its **95% range** (on another run of the
  same size the winrate would almost always land inside it - with 1000 games
  that's about ±3 points), then a row of tabs - **Game log**, **Curve &amp;
  optimization**, **Recommendations**, **Opponent decklist** - so each kind
  of feedback has its own screen instead of one long page you have to hunt
  through (the matchup matrix mode skips the recommendations tab - see
  "Matchup recommendations and sideboard suggestions" below). The game log
  tab groups the losses by reason (with one example each) and lists the
  first 50 games. A **New simulation** button at the top of the results
  jumps you back to the setup step to try another deck or matchup.

## Play on your phone (installable web app)

The `docs/` folder is the app itself. GitHub Pages publishes it, and you open
it from your phone as an installed app (an icon on your home screen that
opens full-screen, no browser address bar) - no PC needed once it's
installed.

**What's different on the phone:**
- Decks live in the browser's own local database (IndexedDB) instead of CSV
  files, since a phone browser has no filesystem to read `Decks\` from. They
  come from `docs/decks.json` - a snapshot of the `Decks\*.csv` files that
  `PushToGitHub.bat` refreshes on every push (via `UpdatePhoneDecks.ps1`).
  Every time the app opens it compares that snapshot with the phone's decks:
  a deck that's new on the PC gets added, a deck changed on the PC gets
  updated **unless you edited it on the phone**, and a deck you deleted on
  the phone stays deleted. Decks you import or edit on the phone stay on
  that device only.
- It works fully offline after the first load (a service worker,
  `docs/sw.js`, caches everything needed) - once installed, you don't need a
  connection to run a simulation, only to pick up a future update. The one
  exception is the deck picker's Legend photos (see above): those are
  hotlinked from a third-party card gallery, so a Legend's art only shows up
  offline after you've opened its tile at least once with a connection -
  until then it just shows a plain initial-letter placeholder instead,
  never a broken app.

**One-time setup (only needs doing once):**
1. Push this repo to GitHub as usual (`PushToGitHub.bat`).
2. On github.com, open the repo → **Settings → Pages** → under "Build and
   deployment", set **Source** to "Deploy from a branch", **Branch** to
   `main` and the folder to **`/docs`** → Save. GitHub gives you a URL like
   `https://<your-username>.github.io/<repo-name>/` - that can take a minute
   or two to go live the first time.
3. Open that URL on your phone's browser (Chrome on Android, Safari on
   iOS), then:
   - **Android (Chrome):** tap the ⋮ menu → "Add to Home screen" / "Install
     app".
   - **iPhone (Safari):** tap the Share icon → "Add to Home Screen".
4. Open it from the new icon on your home screen from now on - it launches
   full-screen, like a real app, with no address bar.

**How updates reach your phone:** pushing to GitHub via `PushToGitHub.bat`
redeploys the `docs/` folder to that same URL automatically, usually within
a minute. The next time you open the app icon **with an internet
connection**, it fetches the update in the background; a fully offline
session still opens the last version it had cached. New or changed decks
from the PC arrive the same way (see "What's different on the phone").

## Importing a deck from a text list

Instead of hand-building a CSV, you can paste a plain decklist - one card
per line - and every card's real Type/Energy/Power/Might/Domain gets looked
up automatically from `docs/carddatabase.json` (the same official card
gallery data used for the "Card-data verification pass" below). You only
need to get the card **name** and **quantity** right; the rest is filled in
for you, and it's checked against the official deckbuilding rules (exactly
1 Legend, 3 Battlefields, 12 Runes, 40+ Main Deck cards, max 3 copies of any
card) with a warning for anything that doesn't add up.

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

Open the **Import** tab, choose where it should go (your decks, or an
opponent archetype), give it a name, paste the list, and hit **Import
deck**. The result panel shows what matched and any warnings, and the deck
pickers refresh immediately so you can simulate with it right away.

On the PC the result is a normal CSV in `Decks\MyDeck\` or
`Decks\Opponents\<Aggro|Midrange|Control>\`, which works exactly like every
other deck file described below. On the phone it's saved on that device.

## Editing a deck

The **Decks** tab edits any saved deck (yours or an opponent's):

- Pick the deck, then use **−/+** on each card to change its count (down to
  0 removes it), and type a **Tag** next to any Unit/Spell/Gear (`Remove:2`,
  `Buff:2`, `Draw:1`, `Shield:2` - see "Supported Tags" below). Filling in
  Tags is the main way to make the simulation more faithful to what the
  cards really do.
- **Add a card** searches the card database by name. It only offers Main
  Deck cards and Runes from the deck's Legend domains (Legends and
  Battlefields always show), with each card's real stats filled in.
- The counts at the top (Legend 1, Battlefields 3, Runes 12, Main deck 40+)
  and the list of problems (unknown or banned cards, more than 3 copies,
  off-domain cards, malformed Tags) update as you edit.
- **Save changes** overwrites the deck; **Save as a new deck** keeps the
  original and saves your version under a new name (and destination);
  **Delete this deck** removes it after asking. On the PC these write or
  delete the deck's CSV under `Decks\`; on the phone they only affect that
  device. Nothing is written until you save.

## What it does

1. You pick your deck (`Decks\MyDeck\` on the PC) and an opponent deck
   (`Decks\Opponents\`, grouped into **Aggro / Midrange / Control** and shown
   by the Legend they use).
2. Both decks are checked against the banned list (`docs/banned.json`) and
   any banned card/Battlefield is excluded automatically, with a warning.
3. Simulates 1000 games and shows the winrate % with its 95% range and the
   seed that replays the run.
4. Groups the losses by reason (Burn Out, out-classed on Might, close loss,
   etc.) and lists the first games.
5. A deck-optimization report: your most-played cards, any cards that never
   got played (candidates to cut), and a curve check (average Energy cost)
   with a suggestion if it's too high or too low.
6. Matchup recommendations plus a suggested up-to-10-card sideboard for that
   specific opponent (see "Matchup recommendations and sideboard
   suggestions" below) - single-opponent and best-of-3 modes only.
7. The opponent's full decklist (grouped by Legend / Battlefield / Rune /
   Unit / Spell / Gear, with Energy/Power/Might/Domain per card).

## Matchup matrix and best-of-3 matches

Beyond the default "1000 games vs one opponent" mode, there are two more
ways to run the simulation - pick one from the **Mode** cards:

- **Matchup matrix** - runs your deck against **every** saved opponent deck
  in one go (500 games each), and reports a winrate per opponent with its
  95% range, plus an overall average. Every opponent is played from the same
  seed, so the differences between rows come from the decks rather than
  from luck. This is the fastest way to see "what does my deck struggle
  against across the whole meta" instead of testing one matchup at a time.
- **Best-of-3 match simulation** - real Riftbound tournament rounds (Nexus
  Night/Skirmish) are best-of-3, not a single game. This mode plays out 200
  full best-of-3 matches against one chosen opponent (each match ends as
  soon as one side wins 2 games) and reports the **match** winrate - "how
  often would I actually take the round" - separately from the underlying
  per-game results, since a deck that reliably grinds out a game 3 can have
  a very different match winrate than its raw single-game winrate suggests.

Both modes reuse the exact same single-game logic as the default mode (via
`gameBatch`/`matchOf`/`matchBatch`/`matchupMatrixRows` in `docs/engine.js`)
- there's no separate, looser simulation just for these views.

## Matchup recommendations and sideboard suggestions

After simulating against **one specific opponent** (the default single-
opponent mode, or the best-of-3 match mode - not the matchup matrix, which
is deliberately breadth-first across every opponent at once), the app shows
a **"Matchup recommendations & sideboard"** panel built entirely from that
batch's own simulated games:

- **Matchup shape** - the opponent's category (Aggro/Midrange/Control, read
  from the archetype the deck is filed under, or inferred from its own
  average Energy if that's not available) plus a plain-language note on how
  to approach that shape of deck.
- **Primary loss pattern** - the *most common* reason (across every
  simulated game against this opponent, not just one) this deck lost: Burn
  Out, out-classed on board Might, Energy left unspent, cards stuck in hand,
  never taking the lead, a close 1-point loss, or general tempo loss - the
  same seven categories `getLossReason` already diagnoses per game, now
  aggregated across the whole batch.
- **Suggested sideboard - up to 10 cards** - real, domain-legal cards from
  `docs/carddatabase.json` that aren't already at the 3-copy legal maximum
  in this deck, scored for what this specific matchup calls for (cheaper
  cards when the curve or Burn Out is the issue, higher Might-per-Energy
  when getting out-classed on the board), paired with the same number of
  **"sideboard OUT"** picks from the maindeck - cards that never got played
  in any simulated game against this opponent, or the current curve's
  weakest fit otherwise.

**This is a heuristic, not a rules simulation of sideboarding itself.**
Swapping the suggested cards in and re-running the simulation is still the
only way to know the real impact. It also inherits the same limitation as
the rest of this simulator: a freshly-suggested card that isn't already in
your deck has no `Tag` assigned (a card's `Tag` lives on its row in a deck
CSV, not in the card database), so scoring only ever uses that card's real
Energy/Might/Domain numbers - never a guessed ability. It never invents what
a card actually does.

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
| Rengar, Pridestalker | "When you play a unit, give a unit +1 [S] this turn." | +1 Might until end of turn to a unit that can still attack (else the unit just played) |
| Draven, Glorious Executioner | "When you win a combat, draw 1." | Draw 1 card the moment you win a combat |

Every other Legend in the saved decks (Akali, Kennen, Master Yi, Fiora, Azir,
Kha'Zix, Irelia, Ezreal, Sett, Vex, Lillia, Shen) currently has **no**
simulated ability - their games still run purely on Energy/Power/Might/
Domain/Tag, same as before. This is a deliberate, honest limitation, not an
oversight: adding a new Legend ability means adding real rules text to that
Legend's `legendAbility` entry in `docs/carddatabase.json` (a small JSON
object with `trigger`/`effect`/`amount`, read by `triggerLegendAbility` in
`docs/engine.js`) - no code changes are needed, but each one still has to be
checked against the card's actual text first rather than guessed.

## Important: what this simulator IS and ISN'T

This is a **statistics/curve testing tool**, not a full Riftbound rules
engine. Riftbound has 1000+ unique cards, each with its own templated rules
text, and reimplementing every single one is out of scope for now. Instead
every card is reduced to:

| Column | Meaning |
|---|---|
| `Quantity` | Copies of this card in the deck |
| `Name` | Card name (must match a real card, and must exactly match an entry in `docs/banned.json` to be caught by the ban check) |
| `Type` | `Legend`, `Unit`, `Spell`, `Gear`, `Battlefield`, or `Rune` |
| `Energy` | Energy cost to play it |
| `Power` | Power value (mostly flavor for this simulator - not currently scored) |
| `Might` | Might it contributes to a Battlefield while in play |
| `Domain` | Fury / Body / Calm / Order / Mind / Chaos (use `A/B` for two-domain cards) |
| `Tag` | Optional simplified effect - see below |

### Supported Tags

- `Remove:N` - destroys enemy units worth up to N Might in total, biggest that fits first, units holding a battlefield before units in base (approximates removal).
- `Buff:N` - +N Might until end of turn on a unit that can still attack (approximates pump/combat tricks).
- `Draw:N` - draws N extra cards when played.
- `Shield:N` - +N Might **only while defending** (the real Shield keyword, Core Rules 814). On a unit it's that unit's own keyword; on a spell it protects one of your units holding a battlefield until your next turn; on gear it goes on the unit carrying the gear.

A Spell whose only Tag has nothing to hit (removal with no enemy units, a
pump or shield with no unit of yours) stays in hand. Cards with no relevant
effect for simulation purposes (most vanilla units, flavor spells, etc.) can
just leave `Tag` blank - an untagged spell is still cast, so its Energy cost
counts, but its effect isn't modeled.

### Rules actually modeled

A 1v1 duel, following the Core Rules / Quick Start:

- **Setup:** 2 battlefields, one per player (battlefield abilities aren't modeled). Each player draws an opening hand of **4** and may mulligan up to 2 cards (the AI sets aside cards costing 5+ Energy). The first player is random.
- **Legend / Rune Deck / Battlefield Zone are separate from the Main Deck** (rules 103.3, 107.2, 107.4): `Legend`, `Rune`, and `Battlefield` rows are set up once and are **never drawn or "played"**, so they never show up in the optimization report's play stats. Only `Unit`/`Spell`/`Gear` cards are in the drawable deck.
- **Channel:** 2 runes per turn (430.4.a / 315.3.b), 3 on the second player's first turn (485.7), up to the deck's Rune count (12). Every rune channeled so far is 1 Energy each turn. **Power costs aren't modeled yet** - a card's Energy is its whole cost.
- **Units** are played exhausted, either to base or to a battlefield you control (the AI reinforces a held battlefield the opponent could take next turn). A ready unit exhausts to move from base to a battlefield, so a unit can attack from the turn after it's played. Units stay on the board until they die - only then do they go to the trash.
- **Gear** stays in play. Gear with Might (equipment) or a Shield tag goes on your strongest unit and moves to another one when that unit dies - the Equip cost isn't modeled.
- **Combat:** moving into a battlefield with no enemy units conquers it. Otherwise damage is simultaneous (each side deals its total Might; damage kills the weakest units first). If only attackers remain they conquer; if defenders remain, surviving attackers go back to base.
- **Scoring:** **Conquer** +1 point; **Hold** +1 point for each battlefield you control at the start of your turn. Each battlefield scores at most once per turn, and only the player whose turn it is scores.
- **Final point** (471.1.b): the winning point can't come from a conquer unless every battlefield scored this turn - the player draws 1 instead. A hold can always score it.
- **Victory Score 8** (194.3): first to 8 wins; the score never goes above 8. A game still unfinished after 40 rounds is a draw (it doesn't count as a win).
- **Burn Out** (431): drawing from an empty deck shuffles the trash back in and the opponent gains 1 point - which can be the winning point.
- **The AI** (same for both players): plays the most expensive affordable card first until it runs out of Energy, then attacks every battlefield it doesn't control that its ready units can beat (easiest first, with the smallest force that wins), then guards a threatened battlefield with what's left. It doesn't hold cards for the opponent's turn (no Reactions).
- **Seeded randomness:** shuffles and the first player come from a seeded generator, so a seed replays a run exactly.

### Loss diagnostics

Each lost game gets the single most relevant reason, checked in this order:

1. Burn Out (ran through the whole deck)
2. Out-classed on **peak** board Might (your best turn vs theirs, not your last turn)
3. Energy left unspent over your first 3 turns (curve too expensive / clogged hand - later on, 12 runes outpace any hand, so those turns aren't counted)
4. Too many cards still stuck in hand at game end (top-heavy curve)
5. Never took the lead in points at any point in the game (they're just faster)
6. Very close (1-point) loss
7. Generic multi-turn tempo loss (fallback)

The results group the losses by reason, most common first, with one game's
full explanation as the example.

### Viewing the opponent's decklist

The **Opponent decklist** tab of the results lists every card in the
opponent's deck (Legend, Battlefields, Runes, Units, Spells, Gear), with
Energy/Power/Might/Domain/Tag per card - useful for planning what to
actually expect at the table, not just the aggregate winrate number.

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

`docs/banned.json` mirrors https://riftbound.gg/rules/banned-cards/ (Standard
Constructed bans as of the most recent ban update), as a list of lowercase
card/Battlefield names. Both your deck and the opponent deck are checked
automatically at load time; any banned card found is excluded and shown as
a warning so you know your simulated deck is tournament-legal.

## Folder structure

```
RiftboundSimulator/
  RunWebUI.bat               <- double-click to run the app on your PC
  WebServer.ps1               <- local server: serves docs/ + the deck CSVs
  DeckFiles.psm1              <- reads/writes the Decks\*.csv files
  UpdatePhoneDecks.ps1        <- rebuilds docs/decks.json from Decks\*.csv
  PushToGitHub.bat            <- refreshes docs/decks.json, commits, pushes
  Keywords.md                <- keyword glossary reference
  Errata.md                  <- errata notes
  docs/                       <- THE app (PC and phone), published by GitHub Pages
    index.html
    style.css
    app.js                    <- UI
    engine.js                 <- the simulation engine
    carddatabase.json         <- ~935 real cards' Type/Energy/Power/Might/Domain,
                                 extracted from the official card gallery
    banned.json               <- banned cards/battlefields
    decks.json                <- snapshot of Decks\*.csv, seeds the phone
    sw.js                     <- service worker (offline cache)
    manifest.webmanifest, icons/
  Decks/
    MyDeck/
      Rengar_Pridestalker.csv
      Rengar_Vend.csv
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

Easiest: use the **Import** tab (see "Importing a deck from a text list"
above) - paste a decklist and it writes the CSV for you with real stats -
or start from an existing deck in the **Decks** tab and use **Save as a new
deck**. You can also drop a new CSV following the schema above directly
into `Decks\MyDeck\` (for your own decks) or the right archetype subfolder
under `Decks\Opponents\` (for opponents) by hand. Either way the PC app
picks up any `.csv` file automatically (reload the page) - no code changes
needed.

The next `PushToGitHub.bat` adds it to `docs/decks.json`, and the phone
picks it up the next time the app opens online (see "What's different on
the phone").
