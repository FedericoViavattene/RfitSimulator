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

- The page has five tabs at the top: **Simulate** (the main flow), **Meta**
  (tournament results - see "Tournament meta" below), **Journal** (your real
  games - see "Journal of real games" below), **Decks** (the deck editor -
  see "Editing a deck" below) and **Import** (paste a text decklist). A
  **step indicator** (Your deck → Mode → Opponent →
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
  first 50 games - tap one to **replay it turn by turn** (see "Replaying a
  game turn by turn" below). A **New simulation** button at the top of the
  results jumps you back to the setup step to try another deck or matchup.

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
- The journal of real games works the same way, from `docs/journal.json`
  (a snapshot of `Journal\Games.csv`): games logged on the PC reach the
  phone with each push. Games logged on the phone reach the PC with
  **Export** on the phone and **Import** on the PC (see "Journal of real
  games").
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

**Weekly data refresh:** every Monday a GitHub Action
(`.github/workflows/refresh-data.yml`) re-reads Riot's card gallery (new
sets, errata) and Riot's tournament "Top Decks" articles. When something
changed it commits the new `docs/carddatabase.json` / `docs/meta.json`
straight to `main`, so the phone updates by itself. You can also run it by
hand from the repo's **Actions** tab ("Weekly data refresh" → "Run
workflow"); its summary lists what was added and any card whose text
changed. Because GitHub can now have commits your PC doesn't,
`PushToGitHub.bat` pulls them in before pushing, and `RunWebUI.bat` pulls
them when it starts (quietly, and only when that's a clean fast-forward).

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
Section labels (`Legend:`, `Battlefields:`, `Runes:`/`Rune Pool:`,
`Main Deck:`, `Units:`, `Spells:`, `Gear:`) are optional and only used as
visual separators - they're skipped, along with blank lines and `#` comment
lines. A card's Type always comes from the database, never from which
section you pasted it under, so you can't accidentally mislabel one. Two
labels do matter, matching the lists Riot publishes: the card under
`Champion:` becomes the deck's **Chosen Champion** (see "Editing a deck"),
and everything under `Sideboard:` is left out of the deck.

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
  0 removes it). Tap a card's name to see its official image and what the
  simulator models of it. Cards whose text is modeled show **card text**;
  for the others you can type a **Tag** (`Remove:2`, `Buff:2`, `Draw:1`,
  `Shield:2` - see "Supported Tags" below) as a rough stand-in for what the
  card does.
- **Add a card** searches the card database by name. It only offers Main
  Deck cards and Runes from the deck's Legend domains (Legends and
  Battlefields always show), with each card's real stats filled in.
- **Chosen Champion:** every deck picks one Champion unit of its Legend's
  champion (e.g. "Rengar, Trophy Hunter" for "Rengar, Pridestalker"). One
  copy starts the game in the **Champion Zone** instead of the Main Deck and
  can be played from there any time, like a card in hand - the simulator
  plays it that way. The chosen one shows **Chosen Champion**; another
  eligible unit shows **Make Chosen Champion** to switch. (In the CSV it's
  simply the first eligible row - choosing one moves it there.)
- The counts at the top (Legend 1, Battlefields 3, Runes 12, Main deck 40+,
  Champion 1) and the list of problems (unknown or banned cards, more than 3
  copies, off-domain cards, malformed Tags, no Chosen Champion) update as
  you edit.
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

## Tournament meta

The **Meta** tab shows Riot's own results for each big event (Regional
Qualifiers and the like), from Riot's organized-play **"Top Decks"**
articles on playriftbound.com:

- **Field** - how many players brought each Legend on Day 1 and on Day 2,
  as a share of the field, and the "Day 2 / Day 1" ratio: above 1× means the
  Legend made the cut more often than its share (green), below 0.8× less
  (red).
- **Lists** - the event's Top 8 and the Best-Of list of each Legend. Tap one
  to see the full list (with its Chosen Champion and Sideboard), then
  **Simulate against it** (it becomes the Simulate tab's opponent, no saving
  needed - replays work too) or **Save as opponent deck**.
- **Test my deck** - plays 200 games against the best-placed list of each of
  the event's 8 most played Legends and weighs the results by their Day 2
  share: roughly "how would my deck have done against that Day 2 field".
- **Trend** - each popular Legend's Day 2 share over the last 6 events, with
  its Top 8 count.

Every list shows **text N%**: how much of its card text the simulator
actually plays (curated abilities, or cards with nothing but keywords). New
sets and meta cards mostly aren't curated yet, so a list at 20% plays most
of its cards as plain stats and the field test **overrates your deck**
against it - the app warns when that's the case. Curating more cards in
`tools/card-abilities.json` raises these numbers.

The data is built by `node tools/build-meta-data.mjs` (after
`build-card-data.mjs`; the weekly GitHub Action runs both) into
`docs/meta.json`: only facts - lists, placements, player counts - with a link
to each article. It finds the articles in Riot's sitemap, so a new event's
article is picked up the week it's published. Riot's articles have the odd
typo ("Corina Veraza"); the script matches those to the nearest card and
says so, and leaves out (and reports) anything it can't place.

## Journal of real games

The **Journal** tab is where you log the games you play for real: date,
result, your deck, the opponent's Legend (and deck, if you like), who went
first, the final score, the event, both battlefields and a note on what
decided it. It then shows:

- **Your record** - overall winrate with its 95% range, going first vs
  second, your last results, and the record per opponent Legend, per deck
  and per event.
- **Real games vs the simulator** - for one of your decks, your real
  winrate against each Legend you've logged next to the simulator's (200
  games against a saved opponent deck of that Legend, or its latest
  tournament list). Where they're far apart (with enough real games to
  count), the simulator is missing something about that matchup.

Tap a game to edit or delete it. On the PC games are saved to
`Journal\Games.csv` (created with the first game) and published with the
rest of the repo by `PushToGitHub.bat` - **the repo is public, so anyone can
read your games and notes there**. On the phone they're saved on the phone;
**Export games** there (it opens the share sheet, e.g. to email it or save
it to Drive) and **Import games** on the PC to bring them over - the same
game is never added twice, and when both sides have a game, the copy
edited last wins.

## Card abilities from the official text

Every card's mechanics come from **Riot's official card gallery**
(https://riftbound.leagueoflegends.com/en-us/card-gallery/), refreshed with:

```
node tools/build-card-data.mjs
```

That script (Node, development only - the app itself never needs it)
downloads the gallery data and writes into `docs/carddatabase.json`. Cards
of a new set are **added** with their official stats (cost, Might, domains,
tags) - a preview card the gallery doesn't give a card type yet waits for
the next run. Then, for every card:

- **Keywords** printed on their own line - `[Assault 2]`, `[Shield]`,
  `[Tank]`, `[Accelerate]` (with its extra cost), `[Ganking]`, `[Deflect]`,
  `[Reaction]`, `[Ambush]`... - read straight from the text.
- The **[Equip] cost** of Equipment.
- Whether it's a **Champion** or **Signature** card (Champion units can be a
  deck's Chosen Champion), and whether it has any rules text beyond its
  keywords (if not, the simulator plays all of it).
- The card's **collector code**, so the app can show the official card image
  (which carries the full rules text).
- Its **ability**, when it's one of the hand-curated entries in
  `tools/card-abilities.json`. Those are written card by card from the
  official text, in a small vocabulary the engine runs (draw, +Might this
  turn, Assault, Shield, deal damage, kill, stun, counter a spell, tokens,
  buffs, channel...). Each entry records a fingerprint of the official text:
  if Riot changes a card's text, the script warns and drops that ability
  until it's reviewed - an errata can't silently leave a wrong ability
  behind.

The rules text itself isn't copied into the repo, only the mechanics. Right
now about 90 cards are curated - every card in the saved decks whose text
fits the engine, plus 5 Legends (Rengar, Draven, Master Yi, Vex, Lillia) and
11 Battlefields. Some are only **partly** modeled (e.g. a spell's "Repeat"
cost or an XP bonus is skipped); the card viewer says so. Everything else
still plays with its real cost, Might and keywords, but its rules text has
no effect - the simulator never guesses what a card does.

Tap any card name (in the **Decks** editor or the **Opponent decklist** tab)
to see its official image, its keywords and exactly what the simulator
models of it.

## Important: what this simulator IS and ISN'T

It plays real Riftbound turns with real card stats, keywords and a growing
set of real abilities, driven by a simple AI - it's a good way to compare
decks and spot trends, not a perfect copy of a human game. A deck row is:

| Column | Meaning |
|---|---|
| `Quantity` | Copies of this card in the deck |
| `Name` | Card name (must match a real card, and must exactly match an entry in `docs/banned.json` to be caught by the ban check) |
| `Type` | `Legend`, `Unit`, `Spell`, `Gear`, `Battlefield`, or `Rune` |
| `Energy` | Energy cost (paid by exhausting runes) |
| `Power` | Power cost (paid by recycling runes of the card's domain) |
| `Might` | The unit's Might (for Equipment: the Might it gives) |
| `Domain` | Fury / Body / Calm / Order / Mind / Chaos (use `A/B` for two-domain cards); a Rune's domain |
| `Tag` | Optional simplified effect for a card whose text isn't modeled - see below |

### Supported Tags

A Tag only counts for a card whose official text isn't modeled (the editor
shows "card text" instead of a Tag box for the ones that are).

- `Remove:N` - destroys enemy units worth up to N Might in total, biggest that fits first, units holding a battlefield before units in base.
- `Buff:N` - +N Might this turn on one of your units (used in a fight).
- `Draw:N` - draws N cards when played.
- `Shield:N` - on a unit, its own Shield keyword (+N Might while defending); on a spell, Shield N on a defender this turn; on gear, Shield N on the unit carrying it.

### Rules actually modeled

A 1v1 duel, following the Core Rules / Quick Start:

- **Setup:** each player brings one of their 3 battlefields (picked at random; in a best-of-3 nobody repeats one), so 2 are in play. Opening hand of **4**, then a mulligan of up to 2 cards (the AI sets aside cards costing 5+ Energy). The first player is random. Each deck's **Chosen Champion** starts in the Champion Zone, outside the Main Deck, and can be played from there like a card in hand (including as a Reaction/Ambush in a fight).
- **Legend / Rune Deck / Battlefield Zone are separate from the Main Deck** (rules 103.3, 107.2, 107.4): only `Unit`/`Spell`/`Gear` cards are drawn.
- **Runes:** 2 channeled per turn from the shuffled Rune Deck (430.4.a / 315.3.b), 3 on the second player's first turn (485.7). **Energy** is paid by exhausting runes; **Power** by recycling a rune of the card's domain to the bottom of the Rune Deck (an exhausted rune can still be recycled), so Power costs slow your rune growth. Runes left ready at the end of your turn can pay for Reactions on the opponent's turn. A two-domain card's Power can be paid with either domain (approximation).
- **Units** are played exhausted (ready with **Accelerate**, paying its extra cost), to base or to a battlefield you control. A ready unit exhausts to move from base to a battlefield; **Ganking** units can also move battlefield to battlefield.
- **Gear** stays in play. Equipment goes on your strongest unit once its [Equip] cost is paid, and moves to another unit when that one dies.
- **Combat:** moving into a battlefield with no enemy units conquers it. Otherwise both sides get a reaction window - the defender first (Reaction/Action spells, **Ambush**/Reaction units), then the attacker - and then damage is simultaneous: each side deals its total Might (**Assault** adds Might while attacking, **Shield** while defending; stunned units deal none), **Tank** units take damage first and **Backline** units last. If only attackers remain they conquer; if defenders remain, surviving attackers go back to base.
- **Counterspells:** when a player casts a spell that hits the other side's units (or costs 2+), the opponent counters it if they hold an affordable counterspell that applies.
- **Deflect:** choosing that unit with a spell costs extra Power.
- **Control** lasts while you have units there.
- **Scoring:** **Conquer** +1 point; **Hold** +1 point for each battlefield you control at the start of your turn. Each battlefield scores at most once per turn.
- **Final point** (471.1.b): the winning point can't come from a conquer unless every battlefield scored this turn - the player draws 1 instead. A hold can always score it.
- **Victory Score 8** (194.3): first to 8 wins; the score never goes above 8. A game still unfinished after 40 rounds is a draw (it doesn't count as a win).
- **Burn Out** (431): drawing from an empty deck shuffles the trash back in and the opponent gains 1 point - which can be the winning point.
- **End of turn:** damage heals and "this turn" effects end; **Temporary** units die at the start of their controller's Beginning Phase, before scoring.
- **The AI** (same for both players): plays the most expensive useful card it can afford, keeping combat tricks, counters and ambushers for the fight (and some Energy back for them when it has a battlefield to protect); uses Legend/gear abilities; attacks every battlefield it doesn't control that its ready units (plus affordable tricks) can take, easiest first; then guards a threatened battlefield.
- **Not modeled yet:** Hidden, Legion, Level/XP, Empower costs, Vision/Predict, Repeat costs, moving enemy units, returning cards to hand, and most "gold" tokens.
- **Seeded randomness:** shuffles, battlefields and the first player come from a seeded generator, so a seed replays a run exactly.

### Loss diagnostics

Each lost game gets the single most relevant reason, checked in this order:

1. Burn Out (ran through the whole deck)
2. Out-classed on **peak** board Might (your best turn vs theirs, not your last turn)
3. Energy left unspent over your first 3 turns (curve too expensive / clogged hand - later on, runes outpace any hand, so those turns aren't counted)
4. Too many cards still stuck in hand at game end (top-heavy curve)
5. Never took the lead in points at any point in the game (they're just faster)
6. Very close (1-point) loss
7. Generic multi-turn tempo loss (fallback)

The results group the losses by reason, most common first, with one game's
full explanation as the example.

### Replaying a game turn by turn

In the **Game log** tab, tap any game to replay it: battlefields, opening
hands and mulligans, every rune channeled, card played, ability used,
attack, reaction, counter, death and point, round by round. In best-of-3
mode, tap a match to step through its games. Nothing is stored for this -
the app re-runs the same seeded run up to that game and records it.

### Viewing the opponent's decklist

The **Opponent decklist** tab of the results lists every card in the
opponent's deck (Legend, Battlefields, Runes, Units, Spells, Gear), with
Energy/Power/Might/Domain per card; tap a name to see the card.

### Keyword glossary

See `Keywords.md` for what each real Riftbound keyword does (from its
official reminder text), whether the simulator models it, and which matchups
it tends to matter in.

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
  JournalFile.psm1            <- reads/writes Journal\Games.csv
  UpdatePhoneDecks.ps1        <- rebuilds docs/decks.json and docs/journal.json
  PushToGitHub.bat            <- pulls, refreshes the phone data, commits, pushes
  .github/workflows/
    refresh-data.yml          <- weekly card + tournament data refresh
  Keywords.md                <- keyword glossary reference
  Errata.md                  <- errata notes
  tools/
    build-card-data.mjs       <- refreshes card mechanics from the official gallery
    build-meta-data.mjs       <- builds docs/meta.json from Riot's Top Decks articles
    card-abilities.json       <- hand-curated abilities, written from the card text
  docs/                       <- THE app (PC and phone), published by GitHub Pages
    index.html
    style.css
    app.js                    <- UI
    engine.js                 <- the simulation engine
    carddatabase.json         <- ~1090 real cards: stats, keywords, collector
                                 codes and curated abilities (no rules text)
    meta.json                 <- tournament results (Legend counts, lists)
    journal.json              <- snapshot of Journal\Games.csv, seeds the phone
    banned.json               <- banned cards/battlefields
    decks.json                <- snapshot of Decks\*.csv, seeds the phone
    sw.js                     <- service worker (offline cache)
    manifest.webmanifest, icons/
  Journal/
    Games.csv                 <- your real games (created with the first one)
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

**Card effects:** what the cards do now comes from their official text (see
"Card abilities from the official text"). The hand-filled `Tag`s these decks
used to carry were removed: checked against the official text, most were
wrong (e.g. "Emperor's Divide" was tagged as removal but moves your own
units to base; "Call to Glory" was tagged as card draw but gives +3 Might).

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
