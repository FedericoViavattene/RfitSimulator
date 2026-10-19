# Riftbound Deck Simulator — project guide for Claude Code

Owner: Federico Viavattene. **Chat with him in Spanish; all app UI text, code comments and docs stay in English.**
Purpose: simulate Riftbound TCG matchups (his deck vs. archetype opponents) to improve his play.
GitHub repo: https://github.com/FedericoViavattene/RfitSimulator (the "Rfit" spelling is real). Branch `main`. Phone app is served by GitHub Pages from `main` → `/docs`.

## Architecture: two front-ends, two engines

| | PC tool | Phone PWA |
|---|---|---|
| Engine | `RiftboundEngine.psm1` (PowerShell module) | `docs/engine.js` (line-for-line JS port) |
| Front-ends | `RiftboundSim.ps1` (console, `RunSimulator.bat`), `WebServer.ps1` + `web/` (local browser UI, `RunWebUI.bat`, `HttpListener`, ports 8787–8796) | `docs/index.html`, `docs/app.js`, `docs/style.css` (no server, runs offline) |
| Decks | CSV files under `Decks/` | `docs/decks.json` seeds IndexedDB once per device |
| Card data | `CardDatabase.json` | `docs/carddatabase.json` (copy of it) |
| Banned list | `Banned.csv` | `docs/banned.json` |

**Standing rules — easy to forget, always check:**
1. **Keep both sides in sync.** Any UI change goes in `web/` AND `docs/` (`index.html`, `app.js`, `style.css`; `style.css` is byte-identical in both). Any game-logic change goes in `RiftboundEngine.psm1` AND `docs/engine.js`, with the same thresholds/formulas/wording. `docs/app.js` differs from `web/app.js` only where it calls `engine.js` directly instead of `fetch('/api/...')`, plus PWA bits (online/offline banner, service-worker registration).
2. **Bump `CACHE_NAME` in `docs/sw.js`** (currently `riftbound-sim-v3`) on every change under `docs/`. Otherwise installed phones keep serving the stale cached copy.
3. `docs/app.js` registers the service worker with a guarded `controllerchange` → `window.location.reload()`. That fixes "new HTML + old cached JS" after an update. Don't remove it.
4. Don't fabricate card behavior. Cards reduce to Energy/Power/Might/Domain + optional Tag (`Remove:N`, `Buff:N`, `Draw:N`, `Shield:N`). Only 2 Legend abilities are modeled (Rengar, Draven), data-driven via `legendAbility` in `CardDatabase.json`. New abilities must use real rules text and existing triggers (`OnUnitPlayed`, `OnCombatWin`).
5. Hard rules already modeled: Victory Score 8 is a hard ceiling (every score update is clamped), Final Point rule at 7+, Runes/Battlefields/Legend are never drawn.

## Key constants and behavior
- 50 games per single-opponent run; 20 best-of-3 matches per match run (`$Script:GamesToSimulate` / `$Script:MatchesToSimulate` in both PowerShell front-ends; mirrored in `docs/app.js` and the button/label text in the HTML/JS — grep for the number when changing).
- Modes: single opponent, best-of-3 match, matchup matrix (matrix has no recommendation panel by design).
- Matchup recommendation + 10-card sideboard suggestion are heuristics from existing stats, not a re-simulation.
- Deck legality: exactly 1 Legend, 12 Runes, 3 Battlefields, ≥40 Main Deck, ≤3 copies, only real cards from `CardDatabase.json`.
- Opponent decks live in `Decks/Opponents/{Aggro,Midrange,Control}`; the user's decks in `Decks/MyDeck`. Text-list import: web "Import a deck" tab (`POST /api/import-deck`) or `ImportDeck.bat` reading `Decks/Import/*.txt`.

## Deck picker (category → legend photo mosaic)
- The visible control is a `.deck-picker-trigger` button; the real `<select id="myDeck">` / `#opponentDeck` stays as hidden source of truth (same pattern as the mode cards / hidden `#simMode`): custom UI sets `.value` and dispatches `change`, so downstream code is unchanged.
- Decks are grouped by **Legend identity** (the deck's own `Type==='Legend'` row `Name`), exposed as `legend` by `WebServer.ps1` (`Get-DeckLegendName`) and `docs/engine.js` (`legendNameOf`/`listDecks`). Several decks with the same Legend collapse into one tile showing "N decks available", then a variant list.
- Legend art is **hotlinked** from Piltover Archive: `https://cdn.piltoverarchive.com/cards/<CODE>.webp?width=420`, via the `LEGEND_ART` table in both `app.js` files. **When adding a deck with a new Legend, add its `LEGEND_ART` entry** (search the exact Legend name on piltoverarchive.com, take the base print's code); without it the tile shows an initial-letter placeholder (not broken). Images are cached offline only after being viewed once online.

## Working in this repo
- Windows PC, Windows PowerShell 5.1 compatibility matters (e.g. no `ConvertFrom-Json -AsHashtable`; don't make `[string[]]` parameters `Mandatory`).
- After editing any `.ps1`/`.psm1`, actually run it if `pwsh`/`powershell` is available (earlier work was done in a sandbox without it, so PowerShell changes were only syntax-balance-checked — worth a real run: `RunWebUI.bat`, `RunSimulator.bat`).
- JS checks: `node --check docs/app.js web/app.js docs/engine.js`. UI checks were done with Playwright against `docs/` served statically (e.g. `python -m http.server`) and against `web/` with a mocked `/api/*`.
- `docs/decks.json` is a snapshot generated from the `Decks/*.csv` files (friendly name = file name without extension, `_` → space). It seeds IndexedDB only once per device, so changing it does not update phones that already installed the app. No generator script is committed.
- Publish with `PushToGitHub.bat` (or plain `git push origin main` now that this runs locally). GitHub Pages takes ~1 minute to redeploy.

## Open follow-ups
- Tags (Remove/Buff/Draw/Shield) are mostly blank for real cards; fill by hand where a matchup needs them (e.g. Rampage `Buff:5` was lost on the Rengar re-import).
- The 9 rebuilt archetype opponent decks are legal real-card decks but not verified tournament lists (Sett/Lillia/Vex are).
- More Legend abilities only where they fit the engine's existing triggers; Empower/XP, exhaust/ready, Equip and tokens would need new engine mechanics first.
- Adding more decks per Legend (user plans this for variety) — the picker already handles it.
- Google login was discussed and deliberately not built (would need real hosting/OAuth).
