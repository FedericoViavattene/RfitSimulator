/*
  engine.js — the Riftbound Deck Simulator engine. This is the only engine:
  the phone app and the PC both run this file in the browser (the PC through
  WebServer.ps1, which serves this same docs/ folder).

  Everything game-related lives here - the rules model, loss diagnostics,
  optimization stats, matchup recommendation, text-list import and the
  public API app.js calls. The rules modeled and their Core Rules citations
  (Victory Score, Final Point restriction, Burn Out, etc.) are documented in
  README.md under "Rules actually modeled".

  The only thing that differs between PC and phone is where decks are stored
  (see DECK STORAGE below).
*/

// ============================================================================
//  DECK STORAGE
//  Two stores with the same all()/get()/put()/remove() calls:
//  - FileDeckStore: on the PC, WebServer.ps1 exposes the Decks\*.csv files
//    through api/decks, so the CSV files stay the source of truth there.
//  - DeviceDeckStore: everywhere else (GitHub Pages, the installed phone app,
//    any plain static server) decks live in this browser's IndexedDB, kept
//    in step with decks.json on every start (see mergeSeedDecks).
// ============================================================================
const API_DECKS = 'api/decks';

async function responseError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || `${fallback} (${res.status})`);
}

class FileDeckStore {
  constructor() {
    this.kind = 'files';
  }

  // Resolves to a store only when this page is served by WebServer.ps1.
  // Anywhere else api/decks is a 404 (or unreachable offline), so the caller
  // falls back to the device store.
  static async detect() {
    // WebServer.ps1 only listens on localhost - don't probe from GitHub Pages
    // or the installed phone app.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
    try {
      const res = await fetch(API_DECKS, { cache: 'no-store' });
      const type = res.headers.get('Content-Type') || '';
      if (res.ok && type.includes('application/json')) return new FileDeckStore();
    } catch {
      // Offline, or no server behind this page.
    }
    return null;
  }

  async all() {
    const res = await fetch(API_DECKS, { cache: 'no-store' });
    if (!res.ok) throw await responseError(res, 'Could not read the deck files');
    return res.json();
  }

  async get(id) {
    return (await this.all()).find(d => d.id === id) || null;
  }

  async put(record) {
    const res = await fetch(API_DECKS, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(record),
    });
    if (!res.ok) throw await responseError(res, 'Could not save the deck file');
  }

  async remove(id) {
    const res = await fetch(`${API_DECKS}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw await responseError(res, 'Could not delete the deck file');
  }
}

class DeviceDeckStore {
  constructor(db) {
    this.kind = 'device';
    this.db = db;
  }

  static async open(seedUrl) {
    const db = await openDb();
    // decks.json is precached by sw.js, so this also works offline. If it
    // can't be read at all, the decks already on this device still work.
    const seed = await fetch(seedUrl).then(r => r.json()).catch(() => null);
    if (Array.isArray(seed)) await mergeSeedDecks(db, seed);
    return new DeviceDeckStore(db);
  }

  all() {
    return idbGetAll(this.db, STORE_DECKS);
  }

  get(id) {
    return idbGet(this.db, STORE_DECKS, id);
  }

  put(record) {
    return idbPut(this.db, STORE_DECKS, record);
  }

  remove(id) {
    return idbDelete(this.db, STORE_DECKS, id);
  }
}

// A short fingerprint of a deck's card rows, used to tell "still exactly as
// it was seeded" from "edited on this device".
function rowsFingerprint(rows) {
  const text = JSON.stringify((rows || []).map(r =>
    ['Quantity', 'Name', 'Type', 'Energy', 'Power', 'Might', 'Domain', 'Tag'].map(k => String(r[k] ?? ''))));
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// Brings this device's decks in step with decks.json (the PC's Decks\*.csv
// snapshot) without ever touching a deck changed on this device:
// - a seed deck this device has never seen is added (unless a deck with that
//   id already exists here, e.g. an earlier import - that one is kept),
// - a seed deck that changed on the PC replaces this device's copy only if
//   the copy is still exactly what was seeded last time,
// - a seed deck deleted on this device stays deleted.
// The 'meta' store remembers each seed deck's fingerprint as last seeded.
async function mergeSeedDecks(db, seed) {
  const meta = (await idbGet(db, STORE_META, 'seed')) || { key: 'seed', decks: {} };
  const known = meta.decks;
  const toPut = [];

  for (const deck of seed) {
    const existing = await idbGet(db, STORE_DECKS, deck.id);
    const seedPrint = rowsFingerprint(deck.rows);
    if (!(deck.id in known)) {
      if (existing) {
        known[deck.id] = rowsFingerprint(existing.rows);
      } else {
        toPut.push(deck);
        known[deck.id] = seedPrint;
      }
    } else if (existing && known[deck.id] !== seedPrint && rowsFingerprint(existing.rows) === known[deck.id]) {
      toPut.push(deck);
      known[deck.id] = seedPrint;
    }
  }

  if (toPut.length) await idbPutAll(db, STORE_DECKS, toPut);
  await idbPut(db, STORE_META, meta);
}

// IndexedDB helpers behind DeviceDeckStore.
const DB_NAME = 'riftbound-db';
const DB_VERSION = 2;           // v2 added the 'meta' store
const STORE_DECKS = 'decks';
const STORE_META = 'meta';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DECKS)) {
        db.createObjectStore(STORE_DECKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbPutAll(db, storeName, values) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    values.forEach(v => store.put(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
//  RUN SIZES AND GAME CONSTANTS
// ============================================================================
// How many games each mode plays. app.js reads these for its button and
// mode-card labels, so this is the only place to change them.
export const RUN_SIZES = {
  single: 1000, // games vs one opponent (95% margin about ±3 points)
  match: 200,   // best-of-3 matches vs one opponent
  matrix: 500,  // games vs each saved opponent
};

const VICTORY_SCORE = 8;
const BATTLEFIELD_COUNT = 2;    // 1v1: each player brings one battlefield
const OPENING_HAND = 4;
const MULLIGAN_MAX = 2;
const MULLIGAN_MIN_ENERGY = 5;  // AI: cards this expensive get mulliganed away
const RUNES_PER_TURN = 2;
const RUNE_DECK_SIZE = 12;
const MAX_ROUNDS = 40;          // a game still unfinished after this is a draw
const EARLY_TURNS = 3;          // the turns the EnergyUnspent diagnostic looks at

// ============================================================================
//  RANDOM HELPERS
// ============================================================================
// mulberry32: a small, fast, seedable PRNG - the same seed replays the exact
// same run, which also makes two runs directly comparable.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  if (globalThis.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296);
}

function normalizeSeed(seed) {
  const n = Number(seed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) % 4294967296 : randomSeed();
}

function shuffle(arr, rng) {
  // Fisher-Yates.
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================================
//  STATS HELPERS
// ============================================================================
function round1(x) {
  return Math.round(x * 10) / 10;
}

function percent(count, total) {
  return total > 0 ? round1((count / total) * 100) : 0;
}

// 95% Wilson score interval for `wins` out of `n`, in percent. Unlike the
// plain p ± 1.96·SE formula it stays inside 0-100% near the extremes.
function winrateInterval(wins, n) {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const z2 = z * z;
  const p = wins / n;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { low: round1(Math.max(0, center - half) * 100), high: round1(Math.min(1, center + half) * 100) };
}

// ============================================================================
//  CARD EFFECT HELPERS
// ============================================================================
// "Remove:3" -> { name: 'Remove', value: 3 }; blank/unknown -> null.
function parseTag(tag) {
  const m = /^\s*(Remove|Buff|Draw|Shield)\s*:\s*(\d+)\s*$/i.exec(tag || '');
  if (!m) return null;
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return { name, value: parseInt(m[2], 10) };
}

// A unit's Might right now: printed Might + attached gear + "this turn" buffs.
function unitMight(u) {
  return u.card.Might + u.bonusMight + u.tempMight;
}

// What a unit is worth while defending (Shield only counts on defense).
function defenseMight(u) {
  return unitMight(u) + u.shield + u.tempShield;
}

function sumBy(list, fn) {
  return list.reduce((s, x) => s + fn(x), 0);
}

// ============================================================================
//  CARD DATABASE (CardDatabase.json) + BANNED LIST
// ============================================================================
function normalizeCardName(name) {
  // Strip commas/apostrophes/periods/quotes (including curly '’'), collapse
  // whitespace, lowercase.
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.replace(/’/g, "'");
  n = n.replace(/[,'.!"]/g, '');
  n = n.replace(/\s+/g, ' ');
  return n.trim();
}

class Engine {
  constructor() {
    this.cardDatabase = null; // Map<lowercasedOrNormalizedName, record>
    this.bannedSet = null;    // Set<lowercased name>
    this.store = null;        // FileDeckStore or DeviceDeckStore
    this.rng = makeRng(randomSeed()); // reseeded at the start of every run
    this.ready = false;
  }

  // 'files' on the PC (Decks\*.csv through WebServer.ps1), 'device' on the
  // phone / any static host (IndexedDB).
  get storageKind() {
    return this.store ? this.store.kind : null;
  }

  async init() {
    if (this.ready) return;

    const [cardDbRaw, bannedRaw] = await Promise.all([
      fetch('carddatabase.json').then(r => r.json()),
      fetch('banned.json').then(r => r.json()),
    ]);

    // Index every card by its exact lowercased name AND its punctuation-
    // normalized name (never overwriting an exact-name key), so a paste that
    // drops commas/apostrophes still resolves.
    const db = new Map();
    for (const name of Object.keys(cardDbRaw)) {
      const v = cardDbRaw[name];
      const rec = {
        Name: name,
        Type: v.type,
        Energy: v.energy,
        Might: v.might,
        Power: v.power,
        Domains: v.domains || [],
        IsToken: !!v.isToken,
        Champions: v.champions || [],
        LegendAbility: v.legendAbility || null,
      };
      db.set(name.toLowerCase(), rec);
      const normKey = normalizeCardName(name);
      if (normKey && !db.has(normKey)) db.set(normKey, rec);
    }
    this.cardDatabase = db;

    this.bannedSet = new Set(bannedRaw);

    this.store = (await FileDeckStore.detect()) || (await DeviceDeckStore.open('decks.json'));

    this.ready = true;
  }

  // --------------------------------------------------------------------
  //  DECK LISTING
  // --------------------------------------------------------------------

  // The exact Legend name off a deck's own Legend row (e.g.
  // "Rengar, Pridestalker"), falling back to the deck's display name if a
  // record somehow has no Legend row. Used by the web UI's deck-picker
  // mosaic to group decks by legend and look up that legend's card art -
  // kept here (not guessed client-side) so it's always the deck's own real
  // data, never a re-derivation of the file name.
  legendNameOf(record) {
    const legendRow = (record.rows || []).find(r => r.Type === 'Legend');
    return (legendRow && legendRow.Name) || record.name;
  }

  async listDecks() {
    const all = await this.store.all();
    all.sort((a, b) => a.name.localeCompare(b.name));

    const toEntry = d => ({ id: d.id, name: d.name, legend: this.legendNameOf(d) });

    const myDecks = all
      .filter(d => d.isMyDeck)
      .map(toEntry);

    const order = ['Aggro', 'Midrange', 'Control'];
    const opponents = {};
    for (const cat of order) {
      const inCat = all.filter(d => !d.isMyDeck && d.category === cat).map(toEntry);
      if (inCat.length > 0) opponents[cat] = inCat;
    }
    const otherCats = [...new Set(all.filter(d => !d.isMyDeck && !order.includes(d.category)).map(d => d.category))];
    for (const cat of otherCats) {
      opponents[cat] = all.filter(d => !d.isMyDeck && d.category === cat).map(toEntry);
    }

    return { myDecks, opponents };
  }

  // --------------------------------------------------------------------
  //  DECK RESOLUTION  (a stored record's rows -> a playable deck)
  // --------------------------------------------------------------------
  async getResolvedDeck(deckId) {
    const record = await this.store.get(deckId);
    if (!record) throw new Error(`Deck not found: ${deckId}`);
    return this.resolveDeck(record);
  }

  resolveDeck(record) {
    const rows = record.rows;
    const cards = [];
    const displayRows = [];
    let skippedOffDomain = 0;
    let runeCount = 0;
    const bannedFound = [];

    const legendRow = rows.find(r => r.Type === 'Legend');
    let legendDomain = legendRow ? legendRow.Domain : null;
    const legendName = legendRow ? legendRow.Name.trim() : null;
    let legendAbility = null;
    if (legendName) {
      const rec = this.cardDatabase.get(legendName.toLowerCase());
      if (rec) legendAbility = rec.LegendAbility;
    }
    const allowedDomains = legendDomain ? legendDomain.split('/').map(s => s.trim()) : [];

    for (const row of rows) {
      const name = row.Name.trim();

      if (this.bannedSet.has(name.toLowerCase())) {
        bannedFound.push(name);
        continue;
      }

      displayRows.push({
        Quantity: row.Quantity,
        Name: name,
        Type: row.Type,
        Energy: row.Energy,
        Power: row.Power,
        Might: row.Might,
        Domain: row.Domain,
        Tag: row.Tag,
      });

      if (row.Type === 'Rune') runeCount += parseInt(row.Quantity, 10) || 0;
      if (row.Type === 'Legend' || row.Type === 'Rune' || row.Type === 'Battlefield') {
        continue;
      }

      if (allowedDomains.length > 0) {
        const cardDomains = row.Domain ? row.Domain.split('/').map(s => s.trim()) : [];
        let legal = true;
        if (cardDomains.length > 0) {
          legal = cardDomains.some(d => allowedDomains.includes(d));
        }
        if (!legal) {
          skippedOffDomain++;
          continue;
        }
      }

      const qty = parseInt(row.Quantity, 10) || 0;
      for (let i = 0; i < qty; i++) {
        cards.push({
          Name: name,
          Type: row.Type,
          Energy: parseInt(row.Energy, 10) || 0,
          Power: parseInt(row.Power, 10) || 0,
          Might: parseInt(row.Might, 10) || 0,
          Domain: row.Domain,
          Tag: row.Tag,
        });
      }
    }

    return {
      Cards: cards,
      Domain: legendDomain,
      Name: record.name,
      LegendName: legendName,
      LegendAbility: legendAbility,
      // Runes channeled can't exceed the Rune Deck; a deck with no Rune rows
      // still plays with a standard 12.
      RuneCount: runeCount || RUNE_DECK_SIZE,
      DisplayRows: displayRows,
      BannedExcluded: [...new Set(bannedFound)],
      SkippedOffDomain: skippedOffDomain,
    };
  }

  categoryFromDeckId(deckId) {
    // Second-to-last path segment ("Opponents/Aggro/Foo" -> "Aggro").
    if (!deckId) return null;
    const parts = deckId.split('/');
    if (parts.length >= 2) return parts[parts.length - 2];
    return null;
  }

  // --------------------------------------------------------------------
  //  GAME MODEL (1v1 duel)
  //
  //  Rules modeled (see README "Rules actually modeled" for citations):
  //  - 2 battlefields, one per player (battlefield abilities aren't modeled).
  //  - Opening hand of 4, then a mulligan of up to 2 cards.
  //  - Channel 2 runes a turn (3 on the second player's first turn), up to
  //    the deck's Rune count; every rune is 1 Energy each turn. Power costs
  //    aren't modeled yet.
  //  - Units are played exhausted, to base or to a battlefield you control;
  //    a ready unit exhausts to move from base to a battlefield.
  //  - Combat damage is simultaneous. If only attackers remain they conquer;
  //    if defenders remain, surviving attackers go back to base. Moving into
  //    a battlefield with no enemy units conquers it without combat.
  //  - Hold: +1 point per battlefield you control at the start of your turn.
  //    Conquer: +1 point. Each battlefield scores at most once per turn.
  //  - The winning point can't come from a conquer unless every battlefield
  //    scored this turn - the player draws 1 instead.
  //  - Burn Out: drawing from an empty deck shuffles the trash back in and
  //    the opponent gains 1 point.
  //  - First to 8 wins; a game unfinished after MAX_ROUNDS is a draw.
  //
  //  Both players are driven by the same simple AI (mulligan, playCards,
  //  deployUnit, attack, reinforce below).
  // --------------------------------------------------------------------
  newPlayerState(deck, label) {
    return {
      Label: label,
      DeckName: deck.Name,
      Library: shuffle(deck.Cards, this.rng),
      Hand: [],
      Trash: [],
      Base: [],         // units in base
      Gear: [],         // gear in play: { card, holder: unit | null }
      Runes: 0,
      RuneCap: deck.RuneCount,
      TurnsTaken: 0,
      Score: 0,
      BurnOutCount: 0,
      PlayLog: [],
      EarlyEnergySeen: 0,   // Energy available over the first EARLY_TURNS turns
      EarlyEnergySpent: 0,
      PeakBoardMight: 0,
      EverLed: false,
      LegendAbility: deck.LegendAbility,
    };
  }

  newUnit(card, owner) {
    return { card, owner, bonusMight: 0, tempMight: 0, shield: 0, tempShield: 0, exhausted: true, gear: [] };
  }

  unitsOf(player, g) {
    const onBattlefields = g.battlefields.flatMap(bf => bf.units.filter(u => u.owner === player));
    return player.Base.concat(onBattlefields);
  }

  defenseAt(bf, player) {
    return sumBy(bf.units.filter(u => u.owner === player), defenseMight);
  }

  // What the opponent could throw at a battlefield next turn: every unit in
  // their base readies and can move.
  attackPotential(player) {
    return sumBy(player.Base, unitMight);
  }

  strongest(units) {
    return units.reduce((best, u) => (!best || unitMight(u) > unitMight(best) ? u : best), null);
  }

  strongestReadyUnit(player) {
    return this.strongest(player.Base.filter(u => !u.exhausted));
  }

  // The battlefield this player controls whose defense the opponent's next
  // attack could beat (weakest first), or -1 if none is in danger.
  battlefieldToReinforce(player, opponent, g) {
    const threat = this.attackPotential(opponent);
    let pick = -1;
    let lowest = Infinity;
    g.battlefields.forEach((bf, b) => {
      if (bf.controller !== player) return;
      const def = this.defenseAt(bf, player);
      if (def <= threat && def < lowest) { lowest = def; pick = b; }
    });
    return pick;
  }

  // --- points --------------------------------------------------------------

  gainPoint(player, opponent, g) {
    player.Score = Math.min(player.Score + 1, VICTORY_SCORE);
    if (player.Score > opponent.Score) player.EverLed = true;
    if (player.Score >= VICTORY_SCORE) g.winner = player;
  }

  scoreBattlefield(player, opponent, g, b, how) {
    if (g.winner || g.scoredThisTurn.has(b)) return;
    const isWinningPoint = player.Score === VICTORY_SCORE - 1;
    if (isWinningPoint && how === 'conquer' && g.scoredThisTurn.size < BATTLEFIELD_COUNT - 1) {
      this.drawCards(player, opponent, g, 1);
      return;
    }
    g.scoredThisTurn.add(b);
    this.gainPoint(player, opponent, g);
  }

  conquer(player, opponent, g, b) {
    g.battlefields[b].controller = player;
    this.scoreBattlefield(player, opponent, g, b, 'conquer');
  }

  // --- cards ---------------------------------------------------------------

  drawCards(player, opponent, g, count = 1) {
    for (let i = 0; i < count; i++) {
      if (g.winner) return;
      if (player.Library.length === 0) {
        // Burn Out: shuffle the trash back in, the opponent gains 1 point.
        player.BurnOutCount++;
        player.Library = shuffle(player.Trash, this.rng);
        player.Trash = [];
        this.gainPoint(opponent, player, g);
        if (g.winner || player.Library.length === 0) return;
      }
      player.Hand.push(player.Library.shift());
    }
  }

  openingHand(player) {
    player.Hand = player.Library.splice(0, OPENING_HAND);
    // Mulligan: set aside up to 2 cards too expensive for the early turns,
    // draw that many, then shuffle the set-aside cards back in.
    const setAside = player.Hand
      .filter(c => c.Energy >= MULLIGAN_MIN_ENERGY)
      .sort((a, b) => b.Energy - a.Energy)
      .slice(0, MULLIGAN_MAX);
    if (setAside.length === 0) return;
    player.Hand = player.Hand.filter(c => !setAside.includes(c));
    player.Hand.push(...player.Library.splice(0, setAside.length));
    player.Library = shuffle(player.Library.concat(setAside), this.rng);
  }

  killUnit(unit, g) {
    const owner = unit.owner;
    const inBase = owner.Base.indexOf(unit);
    if (inBase >= 0) owner.Base.splice(inBase, 1);
    for (const bf of g.battlefields) {
      const idx = bf.units.indexOf(unit);
      if (idx >= 0) bf.units.splice(idx, 1);
    }
    // Its gear stays in play and gets re-equipped by attachLooseGear.
    for (const gear of unit.gear) gear.holder = null;
    owner.Trash.push(unit.card);
  }

  // Gear with Might (equipment) or a Shield tag goes on the strongest unit.
  // Approximation: the Equip cost and timing aren't modeled.
  attachLooseGear(player, g) {
    for (const gear of player.Gear) {
      if (gear.holder) continue;
      const tag = parseTag(gear.card.Tag);
      const shield = tag && tag.name === 'Shield' ? tag.value : 0;
      if (gear.card.Might <= 0 && shield === 0) continue;
      const holder = this.strongest(this.unitsOf(player, g));
      if (!holder) return;
      gear.holder = holder;
      holder.gear.push(gear);
      holder.bonusMight += gear.card.Might;
      holder.shield += shield;
    }
  }

  // Remove:N - destroy enemy units worth up to N Might in total, biggest that
  // fits first, units holding a battlefield before units in base.
  removeEnemyMight(opponent, g, amount) {
    let remaining = amount;
    const pools = [g.battlefields.flatMap(bf => bf.units.filter(u => u.owner === opponent)), opponent.Base];
    for (const pool of pools) {
      for (;;) {
        const target = pool
          .filter(u => unitMight(u) <= remaining)
          .reduce((best, u) => (!best || unitMight(u) > unitMight(best) ? u : best), null);
        if (!target) break;
        remaining -= unitMight(target);
        this.killUnit(target, g);
        if (pool === opponent.Base) continue;
        pool.splice(pool.indexOf(target), 1);
      }
    }
  }

  applyTag(tag, player, opponent, g) {
    switch (tag.name) {
      case 'Remove':
        this.removeEnemyMight(opponent, g, tag.value);
        break;
      case 'Buff': {
        // A pump: +N this turn, on a unit that can still attack.
        const target = this.strongestReadyUnit(player) || this.strongest(this.unitsOf(player, g));
        if (target) target.tempMight += tag.value;
        break;
      }
      case 'Draw':
        this.drawCards(player, opponent, g, tag.value);
        break;
      case 'Shield': {
        // A protection spell: +N while defending, until this player's next
        // turn, on a unit holding a battlefield if there is one.
        const holding = g.battlefields.flatMap(bf => bf.units.filter(u => u.owner === player));
        const target = this.strongest(holding) || this.strongest(this.unitsOf(player, g));
        if (target) target.tempShield += tag.value;
        break;
      }
      default:
        break;
    }
  }

  // Skip a spell whose only modeled effect has nothing to hit. Untagged
  // spells are still cast (their effect isn't modeled, their cost is).
  worthPlaying(card, player, opponent, g) {
    if (card.Type !== 'Spell') return true;
    const tag = parseTag(card.Tag);
    if (!tag) return true;
    if (tag.name === 'Remove') return this.unitsOf(opponent, g).length > 0;
    if (tag.name === 'Buff' || tag.name === 'Shield') return this.unitsOf(player, g).length > 0;
    return true;
  }

  triggerLegendAbility(player, opponent, g, trigger, playedUnit = null) {
    const ability = player.LegendAbility;
    if (!ability || ability.trigger !== trigger) return;
    const amount = ability.amount ? parseInt(ability.amount, 10) : 1;
    switch (ability.effect) {
      case 'BuffBoardMightThisTurn': {
        // "Give a unit +N this turn": a unit that can still attack, else the
        // unit just played.
        const target = this.strongestReadyUnit(player) || playedUnit;
        if (target) target.tempMight += amount;
        break;
      }
      case 'Draw':
        this.drawCards(player, opponent, g, amount);
        break;
      default:
        break;
    }
  }

  // Units are played exhausted: to a battlefield this player controls that
  // the opponent could take next turn, otherwise to base.
  deployUnit(unit, player, opponent, g) {
    const b = this.battlefieldToReinforce(player, opponent, g);
    if (b >= 0) g.battlefields[b].units.push(unit);
    else player.Base.push(unit);
  }

  playCard(card, player, opponent, g) {
    const tag = parseTag(card.Tag);
    if (card.Type === 'Unit') {
      const unit = this.newUnit(card, player);
      if (tag && tag.name === 'Shield') unit.shield += tag.value; // the unit's own Shield keyword
      this.deployUnit(unit, player, opponent, g);
      this.attachLooseGear(player, g);
      this.triggerLegendAbility(player, opponent, g, 'OnUnitPlayed', unit);
      if (tag && tag.name !== 'Shield') this.applyTag(tag, player, opponent, g);
    } else if (card.Type === 'Gear') {
      // Gear stays in play; its Might/Shield go on a unit (attachLooseGear).
      player.Gear.push({ card, holder: null });
      this.attachLooseGear(player, g);
      if (tag && tag.name !== 'Shield') this.applyTag(tag, player, opponent, g);
    } else {
      if (tag) this.applyTag(tag, player, opponent, g);
      player.Trash.push(card);
    }
  }

  // Greedy: keep playing the most expensive affordable card that's worth
  // playing (re-checked after each card, since Draw effects add options).
  playCards(player, opponent, g) {
    const available = player.Runes;
    let energy = available;
    while (!g.winner) {
      const card = player.Hand
        .filter(c => c.Energy <= energy && this.worthPlaying(c, player, opponent, g))
        .reduce((best, c) => (!best || c.Energy > best.Energy ? c : best), null);
      if (!card) break;
      energy -= card.Energy;
      player.Hand.splice(player.Hand.indexOf(card), 1);
      player.PlayLog.push(card.Name);
      this.playCard(card, player, opponent, g);
    }
    if (player.TurnsTaken <= EARLY_TURNS) {
      player.EarlyEnergySeen += available;
      player.EarlyEnergySpent += available - energy;
    }
  }

  // Simultaneous damage: `damage` kills the weakest units first (that's how
  // to kill the most of them). Returns the units that die.
  assignDamage(units, damage, healthOf) {
    const dead = [];
    let remaining = damage;
    for (const u of units.slice().sort((a, b) => healthOf(a) - healthOf(b))) {
      if (remaining <= 0 || healthOf(u) > remaining) break;
      remaining -= healthOf(u);
      dead.push(u);
    }
    return dead;
  }

  moveToBattlefield(force, player, opponent, g, b) {
    for (const u of force) {
      u.exhausted = true;
      player.Base.splice(player.Base.indexOf(u), 1);
    }
    const bf = g.battlefields[b];
    const defenders = bf.units.filter(u => u.owner === opponent);
    if (defenders.length === 0) {
      bf.units.push(...force);
      this.conquer(player, opponent, g, b);
      return;
    }

    const deadDefenders = this.assignDamage(defenders, sumBy(force, unitMight), defenseMight);
    const deadAttackers = this.assignDamage(force, sumBy(defenders, defenseMight), unitMight);
    deadDefenders.forEach(u => this.killUnit(u, g));
    deadAttackers.forEach(u => this.killUnit(u, g));
    const attackersLeft = force.filter(u => !deadAttackers.includes(u));
    const defendersLeft = defenders.filter(u => !deadDefenders.includes(u));

    if (attackersLeft.length > 0 && defendersLeft.length === 0) {
      bf.units.push(...attackersLeft);
      this.triggerLegendAbility(player, opponent, g, 'OnCombatWin');
      this.conquer(player, opponent, g, b);
    } else {
      player.Base.push(...attackersLeft); // surviving attackers go back to base
      if (defendersLeft.length > 0 && attackersLeft.length === 0) {
        this.triggerLegendAbility(opponent, player, g, 'OnCombatWin');
      }
    }
  }

  // The smallest single ready unit that beats `defense`, else the strongest
  // ones stacked until they do; null when even everything isn't enough.
  pickAttackers(ready, defense) {
    const single = ready
      .filter(u => unitMight(u) > defense)
      .reduce((best, u) => (!best || unitMight(u) < unitMight(best) ? u : best), null);
    if (single) return [single];
    const force = [];
    let total = 0;
    for (const u of ready.slice().sort((a, b) => unitMight(b) - unitMight(a))) {
      force.push(u);
      total += unitMight(u);
      if (total > defense) return force;
    }
    return null;
  }

  // Attack every battlefield this player doesn't control that its ready
  // units can take, easiest first.
  attack(player, opponent, g) {
    const targets = g.battlefields
      .map((bf, b) => b)
      .filter(b => g.battlefields[b].controller !== player)
      .sort((x, y) => this.defenseAt(g.battlefields[x], opponent) - this.defenseAt(g.battlefields[y], opponent));
    for (const b of targets) {
      if (g.winner) return;
      const ready = player.Base.filter(u => !u.exhausted);
      if (ready.length === 0) return;
      const force = this.pickAttackers(ready, this.defenseAt(g.battlefields[b], opponent));
      if (force) this.moveToBattlefield(force, player, opponent, g, b);
    }
  }

  // Leftover ready units guard a held battlefield the opponent could take.
  reinforce(player, opponent, g) {
    const b = this.battlefieldToReinforce(player, opponent, g);
    if (b < 0) return;
    const ready = player.Base.filter(u => !u.exhausted);
    for (const u of ready) {
      u.exhausted = true;
      player.Base.splice(player.Base.indexOf(u), 1);
      g.battlefields[b].units.push(u);
    }
  }

  takeTurn(player, opponent, g) {
    g.scoredThisTurn = new Set();
    player.TurnsTaken++;

    // Awaken: ready everything; protection from last turn's spells ends.
    for (const u of this.unitsOf(player, g)) {
      u.exhausted = false;
      u.tempShield = 0;
    }

    // Beginning: Hold.
    g.battlefields.forEach((bf, b) => {
      if (bf.controller === player) this.scoreBattlefield(player, opponent, g, b, 'hold');
    });
    if (g.winner) return;

    // Channel, then draw.
    const extraRune = player === g.second && player.TurnsTaken === 1 ? 1 : 0;
    player.Runes = Math.min(player.RuneCap, player.Runes + RUNES_PER_TURN + extraRune);
    this.drawCards(player, opponent, g, 1);
    if (g.winner) return;

    // Action: play cards, attack, guard.
    this.attachLooseGear(player, g);
    this.playCards(player, opponent, g);
    if (!g.winner) this.attack(player, opponent, g);
    if (!g.winner) this.reinforce(player, opponent, g);

    const might = sumBy(this.unitsOf(player, g), unitMight);
    if (might > player.PeakBoardMight) player.PeakBoardMight = might;

    // End of turn: "this turn" effects wear off.
    for (const u of this.unitsOf(player, g).concat(this.unitsOf(opponent, g))) u.tempMight = 0;
  }

  getLossReason(loser, winner) {
    const pointGap = winner.Score - loser.Score;
    // Only the early turns: later on, 12 runes outpace any hand, so unspent
    // Energy there says nothing about the curve.
    const energyUsedPct = loser.EarlyEnergySeen > 0 ? loser.EarlyEnergySpent / loser.EarlyEnergySeen : 1.0;
    const cardsStuckInHand = loser.Hand.length;

    if (loser.BurnOutCount > 0) {
      return {
        Category: 'BurnOut',
        Text: `Ran through the whole deck (Burn Out ${loser.BurnOutCount}x) - each time the trash was shuffled back in and the opponent scored a point. The deck is likely too thin for how long this game ran, or it drew too many extra cards without closing the game.`,
      };
    }
    if (loser.PeakBoardMight > 0 && winner.PeakBoardMight > 0 && loser.PeakBoardMight < winner.PeakBoardMight * 0.7) {
      return {
        Category: 'MightMismatch',
        Text: `Out-classed on peak board Might (your best turn reached ${loser.PeakBoardMight} vs the opponent's ${winner.PeakBoardMight}) - the deck likely needs a higher average Might curve, or more Buff/Shield effects to compete for Battlefields.`,
      };
    }
    if (energyUsedPct < 0.6) {
      const pct = Math.round((1 - energyUsedPct) * 100);
      return {
        Category: 'EnergyUnspent',
        Text: `Left ${pct}% of your Energy unspent over your first ${EARLY_TURNS} turns - your hand likely had too many expensive cards clogging the curve early, or not enough cheap plays to use your runes each turn.`,
      };
    }
    if (cardsStuckInHand >= 4) {
      return {
        Category: 'HandClogged',
        Text: `Ended the game with ${cardsStuckInHand} cards still stuck in hand - the deck may be too top-heavy (too many high-Energy cards) to reliably deploy everything before the game ends.`,
      };
    }
    if (!loser.EverLed && winner.EverLed) {
      return {
        Category: 'NeverLed',
        Text: "Never took the lead in points at any stage of the game - the opponent's deck likely has a faster or more consistent early curve, forcing this deck to always play from behind.",
      };
    }
    if (pointGap === 1) {
      return {
        Category: 'CloseLoss',
        Text: "Very close loss (lost by a single point after leading or trading for most of the game) - a single extra removal, Buff, or Shield effect could likely flip this matchup.",
      };
    }
    return {
      Category: 'Tempo',
      Text: "Fell behind on tempo across multiple turns rather than from one specific swing - review the overall curve and card count at each Energy cost for a smoother development.",
    };
  }

  singleGame(deckA, deckB) {
    const playerA = this.newPlayerState(deckA, 'You');
    const playerB = this.newPlayerState(deckB, 'Opponent');
    const g = {
      battlefields: Array.from({ length: BATTLEFIELD_COUNT }, () => ({ controller: null, units: [] })),
      scoredThisTurn: new Set(),
      second: null,
      winner: null,
    };

    this.openingHand(playerA);
    this.openingHand(playerB);
    const [first, second] = this.rng() < 0.5 ? [playerA, playerB] : [playerB, playerA];
    g.second = second;

    let rounds = 0;
    while (!g.winner && rounds < MAX_ROUNDS) {
      rounds++;
      this.takeTurn(first, second, g);
      if (!g.winner) this.takeTurn(second, first, g);
    }

    const result = {
      Winner: g.winner ? g.winner.Label : 'Draw',
      ScoreA: playerA.Score,
      ScoreB: playerB.Score,
      PlayLogA: playerA.PlayLog,
      Rounds: rounds,
      WentFirst: first.Label,
      LossReason: null,
    };
    if (result.Winner === 'Opponent') {
      result.LossReason = this.getLossReason(playerA, playerB);
    }
    return result;
  }

  // --------------------------------------------------------------------
  //  OPTIMIZATION STATS
  // --------------------------------------------------------------------
  optimizationStats(deck, gameResults) {
    const allNonBasic = deck.Cards.filter(c => !['Legend', 'Rune', 'Battlefield'].includes(c.Type));
    const byName = new Map();
    for (const c of allNonBasic) {
      if (!byName.has(c.Name)) byName.set(c.Name, []);
      byName.get(c.Name).push(c);
    }

    const playedCounts = new Map();
    for (const r of gameResults) {
      for (const n of r.PlayLogA) {
        playedCounts.set(n, (playedCounts.get(n) || 0) + 1);
      }
    }

    const top = [...playedCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ Name: name, Count: count }));

    const neverPlayed = [...byName.keys()].filter(n => !playedCounts.has(n));

    let avgEnergy = 0;
    if (allNonBasic.length > 0) {
      avgEnergy = allNonBasic.reduce((s, c) => s + c.Energy, 0) / allNonBasic.length;
    }

    let curveSuggestion = null;
    if (avgEnergy > 3.2) {
      curveSuggestion = "Your curve is a bit top-heavy for a 2-Energy-per-turn Channel rate - consider adding a few more low-cost (1-2 Energy) cards for a smoother start.";
    } else if (avgEnergy < 1.8) {
      curveSuggestion = "Your curve is very low - you may be able to afford a few more impactful high-Might finishers without hurting consistency.";
    }

    return {
      MostPlayed: top,
      NeverPlayed: neverPlayed,
      AverageEnergy: Math.round(avgEnergy * 100) / 100,
      CurveSuggestion: curveSuggestion,
    };
  }

  // --------------------------------------------------------------------
  //  MATCHUP RECOMMENDATION + SIDEBOARD
  // --------------------------------------------------------------------
  matchupRecommendation(myDeck, opponentDeck, gameResults, opponentCategory = null, maxSideboardCards = 10) {
    const lossCategories = gameResults
      .filter(r => r.Winner !== 'You' && r.LossReason)
      .map(r => r.LossReason.Category);
    let primaryConcern = 'None';
    if (lossCategories.length > 0) {
      const counts = new Map();
      for (const c of lossCategories) counts.set(c, (counts.get(c) || 0) + 1);
      primaryConcern = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    const oppNonBasic = opponentDeck.Cards.filter(c => !['Legend', 'Rune', 'Battlefield'].includes(c.Type));
    let oppAvgEnergy = 0;
    if (oppNonBasic.length > 0) {
      oppAvgEnergy = oppNonBasic.reduce((s, c) => s + c.Energy, 0) / oppNonBasic.length;
    }
    if (!['Aggro', 'Midrange', 'Control'].includes(opponentCategory)) {
      opponentCategory = oppAvgEnergy < 2.0 ? 'Aggro' : (oppAvgEnergy > 3.0 ? 'Control' : 'Midrange');
    }

    const categoryAdvice = {
      Aggro: `Rival Aggro (curva baja, ${oppAvgEnergy.toFixed(2)} de Energia promedio): conviene estabilizar el tablero temprano y priorizar cartas baratas o con Shield.`,
      Midrange: `Rival Midrange (curva pareja, ${oppAvgEnergy.toFixed(2)} de Energia promedio): busca intercambios de Might favorables y evita quedarte atras de tempo.`,
      Control: `Rival Control (curva alta, ${oppAvgEnergy.toFixed(2)} de Energia promedio): conviene cerrar el juego rapido, antes de que estabilice, priorizando una curva baja.`,
    };
    const concernAdvice = {
      BurnOut: 'Perdes por Burn Out (te quedas sin mazo): bajar el costo promedio de la curva suele ayudar mas que sumar mas robo, que solo acelera quedarte sin cartas.',
      MightMismatch: 'Te superan en el pico de Might del tablero: priorizar cartas con mas Might por Energia debería cerrar la brecha.',
      EnergyUnspent: 'Te queda Energia sin gastar seguido: bajar el costo promedio de la curva deberia ayudar a usar mejor el Channel de cada turno.',
      HandClogged: 'Terminas con cartas trabadas en mano: la curva es demasiado top-heavy para este matchup en particular.',
      NeverLed: 'Nunca tomas la delantera en puntos: este rival es mas rapido o consistente temprano, priorizar jugadas de 1-2 de Energia deberia ayudar.',
      CloseLoss: 'Perdes por muy poco margen: una carta mas de Might o de curva baja puede alcanzar para dar vuelta este matchup.',
      Tempo: 'Perdes tempo de forma pareja en varios turnos, no por un swing puntual: revisa el conteo de cartas en cada costo de Energia.',
      None: 'Este mazo no perdio ninguna partida simulada contra este rival todavia - no hay un patron de derrota que corregir por ahora.',
    };

    const advice = [categoryAdvice[opponentCategory], concernAdvice[primaryConcern]];

    const wantsCheap = ['EnergyUnspent', 'HandClogged', 'NeverLed', 'BurnOut'].includes(primaryConcern) || opponentCategory === 'Aggro';
    const wantsMight = primaryConcern === 'MightMismatch' || ['Aggro', 'Midrange'].includes(opponentCategory);

    const allowedDomains = myDeck.Domain ? myDeck.Domain.split('/').map(s => s.trim()) : [];

    const currentCopies = new Map();
    for (const row of myDeck.DisplayRows) {
      if (['Unit', 'Spell', 'Gear'].includes(row.Type)) {
        currentCopies.set(row.Name.toLowerCase(), parseInt(row.Quantity, 10) || 0);
      }
    }

    const seenNames = new Set();
    const inCandidates = [];
    for (const rec of this.cardDatabase.values()) {
      if (seenNames.has(rec.Name)) continue;
      seenNames.add(rec.Name);
      if (rec.IsToken) continue;
      if (!['Unit', 'Spell', 'Gear'].includes(rec.Type)) continue;
      if (rec.Energy === null || rec.Energy === undefined) continue;

      const cardDomains = (rec.Domains || []).filter(d => d && d !== 'Colorless');
      if (allowedDomains.length > 0 && cardDomains.length > 0) {
        const legal = cardDomains.some(d => allowedDomains.includes(d));
        if (!legal) continue;
      }

      const existingQty = currentCopies.get(rec.Name.toLowerCase()) || 0;
      if (existingQty >= 3) continue;

      const energy = Number(rec.Energy);
      const might = Number(rec.Might);

      let score = 0.0;
      if (energy > 0) score += (might / energy);
      if (wantsCheap) score += Math.max(0, 3 - energy) * 1.5;
      if (wantsMight) score += (might / Math.max(energy, 1)) * 1.5;
      if (existingQty > 0) score += 0.25;

      if (score <= 0) continue;

      const domainStr = cardDomains.length > 0 ? cardDomains.join('/') : '';
      inCandidates.push({ Name: rec.Name, Type: rec.Type, Energy: rec.Energy, Might: rec.Might, Domain: domainStr, Score: Math.round(score * 100) / 100 });
    }
    inCandidates.sort((a, b) => b.Score - a.Score);
    const sideboardIn = inCandidates.slice(0, maxSideboardCards);

    const playedCounts = new Map();
    for (const r of gameResults) {
      for (const n of r.PlayLogA) playedCounts.set(n, (playedCounts.get(n) || 0) + 1);
    }
    const myNonBasic = myDeck.Cards.filter(c => !['Legend', 'Rune', 'Battlefield'].includes(c.Type));
    const byName = new Map();
    for (const c of myNonBasic) {
      if (!byName.has(c.Name)) byName.set(c.Name, c);
    }
    const outCandidates = [...byName.entries()].map(([name, card]) => {
      const timesPlayed = playedCounts.get(name) || 0;
      let tiebreak = 0.0;
      if (wantsCheap) tiebreak = -1.0 * Number(card.Energy);
      else if (wantsMight) tiebreak = Number(card.Might);
      return {
        Name: name, Type: card.Type, Energy: card.Energy, Might: card.Might, Domain: card.Domain,
        TimesPlayed: timesPlayed,
        CutPriority: (timesPlayed * 1000.0) + tiebreak,
      };
    });
    outCandidates.sort((a, b) => a.CutPriority - b.CutPriority);
    const sideboardOutCount = Math.min(maxSideboardCards, sideboardIn.length);
    const sideboardOut = outCandidates.slice(0, sideboardOutCount);

    return {
      OpponentCategory: opponentCategory,
      OpponentAverageEnergy: Math.round(oppAvgEnergy * 100) / 100,
      PrimaryConcern: primaryConcern,
      Advice: advice,
      SideboardIn: sideboardIn,
      SideboardOut: sideboardOut,
    };
  }

  // --------------------------------------------------------------------
  //  BATCHES / MATCHES / MATRIX
  //  Callers reseed this.rng first (see the public API), so a seed replays
  //  the exact same batch.
  // --------------------------------------------------------------------
  gameBatch(deckA, deckB, gameCount) {
    const results = [];
    for (let g = 0; g < gameCount; g++) results.push(this.singleGame(deckA, deckB));
    const wins = results.filter(r => r.Winner === 'You').length;
    const draws = results.filter(r => r.Winner === 'Draw').length;
    return {
      Results: results,
      Wins: wins,
      Draws: draws,
      GameCount: gameCount,
      Winrate: percent(wins, gameCount),
      Interval: winrateInterval(wins, gameCount),
    };
  }

  // Drawn games don't count toward either side; a match that somehow keeps
  // drawing stops after 3x bestOf games and counts as a draw.
  matchOf(deckA, deckB, bestOf = 3) {
    const gamesToWin = Math.ceil(bestOf / 2.0);
    const games = [];
    let winsA = 0, winsB = 0;
    while (winsA < gamesToWin && winsB < gamesToWin && games.length < bestOf * 3) {
      const g = this.singleGame(deckA, deckB);
      games.push(g);
      if (g.Winner === 'You') winsA++;
      else if (g.Winner === 'Opponent') winsB++;
    }
    const winner = winsA >= gamesToWin ? 'You' : (winsB >= gamesToWin ? 'Opponent' : 'Draw');
    return { Winner: winner, GamesWonA: winsA, GamesWonB: winsB, BestOf: bestOf, Games: games };
  }

  matchBatch(deckA, deckB, matchCount, bestOf = 3) {
    const matches = [];
    for (let i = 0; i < matchCount; i++) matches.push(this.matchOf(deckA, deckB, bestOf));
    const matchWins = matches.filter(m => m.Winner === 'You').length;
    return {
      Matches: matches,
      MatchWins: matchWins,
      MatchCount: matchCount,
      MatchWinrate: percent(matchWins, matchCount),
      Interval: winrateInterval(matchWins, matchCount),
      BestOf: bestOf,
    };
  }

  // Every opponent is played from the same seed (common random numbers), so
  // the differences between rows come from the decks, not from luck.
  async matchupMatrixRows(myDeck, gameCount, seed) {
    const all = await this.store.all();
    const opponents = all.filter(d => !d.isMyDeck);
    const rows = [];
    for (const record of opponents) {
      const oppDeck = this.resolveDeck(record);
      this.rng = makeRng(seed);
      const batch = this.gameBatch(myDeck, oppDeck, gameCount);
      rows.push({
        Name: oppDeck.Name,
        Category: record.category,
        Winrate: batch.Winrate,
        Interval: batch.Interval,
        Wins: batch.Wins,
        Draws: batch.Draws,
        Total: batch.GameCount,
      });
    }
    rows.sort((a, b) => (a.Category || '').localeCompare(b.Category || '') || a.Name.localeCompare(b.Name));
    return rows;
  }

  // --------------------------------------------------------------------
  //  TEXT-LIST DECK IMPORT  (parse -> resolve against the card database ->
  //  save through the deck store)
  // --------------------------------------------------------------------
  parseDeckText(text) {
    const sectionHeaderOnly = /^(?:Legend|Legends|Battlefield|Battlefields|Rune|Runes|Main ?Deck|Unit|Units|Spell|Spells|Gear)\s*:?\s*$/i;
    const sectionHeaderWithContent = /^(?:Legend|Legends|Battlefield|Battlefields|Rune|Runes|Main ?Deck|Unit|Units|Spell|Spells|Gear)\s*:\s*(.+)$/i;
    const leadingQty = /^(\d+)\s*x?\s+(.+)$/i;
    const trailingQty = /^(.+?)\s*x\s*(\d+)$/i;

    const lines = (text || '').split(/\r\n|\n|\r/);
    const result = [];
    for (const raw of lines) {
      let line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) continue;
      if (sectionHeaderOnly.test(line)) continue;

      const withContent = line.match(sectionHeaderWithContent);
      if (withContent) line = withContent[1].trim();
      if (!line) continue;

      let qty = 1;
      let name = line;
      const lead = line.match(leadingQty);
      const trail = line.match(trailingQty);
      if (lead) {
        qty = parseInt(lead[1], 10);
        name = lead[2].trim();
      } else if (trail) {
        name = trail[1].trim();
        qty = parseInt(trail[2], 10);
      }

      name = name.replace(/’|‘/g, "'").replace(/“|”/g, '"');
      name = name.replace(/^[\s"]+|[\s"]+$/g, '');

      if (name) result.push({ Quantity: qty, Name: name });
    }
    return result;
  }

  resolveDeckList(parsed, maxCopies = 3) {
    const merged = new Map();
    for (const p of parsed) {
      const normKey = normalizeCardName(p.Name);
      if (!normKey) continue;
      if (merged.has(normKey)) {
        merged.get(normKey).Quantity += p.Quantity;
      } else {
        merged.set(normKey, { Name: p.Name, Quantity: p.Quantity });
      }
    }

    const rows = [];
    const warnings = [];

    for (const entry of merged.values()) {
      let rec = this.cardDatabase.get(entry.Name.toLowerCase());
      if (!rec) rec = this.cardDatabase.get(normalizeCardName(entry.Name));
      if (!rec) {
        warnings.push(`Not found in the card database, skipped: '${entry.Name}'`);
        continue;
      }
      if (rec.IsToken) {
        warnings.push(`'${rec.Name}' is a token (created by another card's effect, not something you deck-build with) - skipped.`);
        continue;
      }
      let qty = entry.Quantity;
      if (['Unit', 'Spell', 'Gear'].includes(rec.Type) && qty > maxCopies) {
        warnings.push(`'${rec.Name}': ${qty} copies requested, capped at ${maxCopies} (the official max copies of one card).`);
        qty = maxCopies;
      }
      rows.push(this.rowFromRecord(rec, qty));
    }

    const counts = this.deckCounts(rows);
    warnings.push(...counts.warnings);
    return {
      Rows: rows,
      Warnings: warnings,
      LegendCount: counts.legendCount,
      RuneTotal: counts.runeTotal,
      BattlefieldCount: counts.battlefieldCount,
      MainDeckTotal: counts.mainDeckTotal,
    };
  }

  // A deck row with the card's real stats from the card database.
  rowFromRecord(rec, quantity) {
    const domainStr = (rec.Domains || []).join(',') === 'Colorless' ? '' : (rec.Domains || []).join('/');
    return { Quantity: quantity, Name: rec.Name, Type: rec.Type, Energy: rec.Energy, Power: rec.Power, Might: rec.Might, Domain: domainStr, Tag: '' };
  }

  // The deckbuilding counts (exactly 1 Legend, 3 Battlefields, 12 Runes,
  // 40+ Main Deck) and a warning for each one that's off.
  deckCounts(rows) {
    const qty = r => parseInt(r.Quantity, 10) || 0;
    const legendCount = rows.filter(r => r.Type === 'Legend').reduce((s, r) => s + qty(r), 0);
    const runeTotal = rows.filter(r => r.Type === 'Rune').reduce((s, r) => s + qty(r), 0);
    const battlefieldCount = rows.filter(r => r.Type === 'Battlefield').reduce((s, r) => s + qty(r), 0);
    const mainDeckTotal = rows.filter(r => ['Unit', 'Spell', 'Gear'].includes(r.Type)).reduce((s, r) => s + qty(r), 0);

    const warnings = [];
    if (legendCount !== 1) warnings.push(`Deck has ${legendCount} Legend card(s) - a legal deck needs exactly 1.`);
    if (battlefieldCount !== 3) warnings.push(`Deck has ${battlefieldCount} Battlefield(s) - a legal deck needs exactly 3.`);
    if (runeTotal !== 12) warnings.push(`Rune Deck has ${runeTotal} card(s) - a legal Rune Deck is exactly 12.`);
    if (mainDeckTotal < 40) warnings.push(`Main Deck has ${mainDeckTotal} card(s) - the official minimum is 40.`);
    return { legendCount, runeTotal, battlefieldCount, mainDeckTotal, warnings };
  }

  // ========================================================================
  //  PUBLIC API — what app.js calls. Results use camelCase JSON shapes,
  //  consumed by app.js's render*() functions.
  // ========================================================================

  // `seed` (optional): replays an earlier run exactly; a random one is
  // picked otherwise. Every result reports the seed it used.
  async simulate(myDeckId, opponentDeckId, { games = RUN_SIZES.single, seed, sideboardSize = 10 } = {}) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const opponentDeck = await this.getResolvedDeck(opponentDeckId);
    const opponentCategory = this.categoryFromDeckId(opponentDeckId);

    const usedSeed = normalizeSeed(seed);
    this.rng = makeRng(usedSeed);
    const batch = this.gameBatch(myDeck, opponentDeck, games);

    const gameRows = batch.Results.map((r, i) => ({
      n: i + 1,
      win: r.Winner === 'You',
      draw: r.Winner === 'Draw',
      scoreA: r.ScoreA,
      scoreB: r.ScoreB,
      wentFirst: r.WentFirst === 'You',
      lossCategory: r.LossReason ? r.LossReason.Category : null,
      lossReason: r.LossReason ? r.LossReason.Text : null,
    }));

    const optimization = this.optimizationPayload(myDeck, batch.Results);
    const opponentDecklist = this.decklistPayload(opponentDeck);
    const recommendation = this.recommendationPayload(
      this.matchupRecommendation(myDeck, opponentDeck, batch.Results, opponentCategory, sideboardSize)
    );

    return {
      myDeckName: myDeck.Name,
      opponentDeckName: opponentDeck.Name,
      bannedExcludedMy: myDeck.BannedExcluded,
      bannedExcludedOpponent: opponentDeck.BannedExcluded,
      seed: usedSeed,
      wins: batch.Wins,
      draws: batch.Draws,
      totalGames: batch.GameCount,
      winrate: batch.Winrate,
      winrateLow: batch.Interval.low,
      winrateHigh: batch.Interval.high,
      games: gameRows,
      optimization,
      opponentDecklist,
      recommendation,
    };
  }

  async simulateMatch(myDeckId, opponentDeckId, { matches = RUN_SIZES.match, bestOf = 3, seed, sideboardSize = 10 } = {}) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const opponentDeck = await this.getResolvedDeck(opponentDeckId);
    const opponentCategory = this.categoryFromDeckId(opponentDeckId);

    const usedSeed = normalizeSeed(seed);
    this.rng = makeRng(usedSeed);
    const matchBatch = this.matchBatch(myDeck, opponentDeck, matches, bestOf);

    const matchRows = [];
    const allGames = [];
    matchBatch.Matches.forEach((m, i) => {
      matchRows.push({ n: i + 1, win: m.Winner === 'You', draw: m.Winner === 'Draw', gamesWonA: m.GamesWonA, gamesWonB: m.GamesWonB });
      for (const g of m.Games) allGames.push(g);
    });

    const optimization = this.optimizationPayload(myDeck, allGames);
    const opponentDecklist = this.decklistPayload(opponentDeck);
    const recommendation = this.recommendationPayload(
      this.matchupRecommendation(myDeck, opponentDeck, allGames, opponentCategory, sideboardSize)
    );

    return {
      myDeckName: myDeck.Name,
      opponentDeckName: opponentDeck.Name,
      bannedExcludedMy: myDeck.BannedExcluded,
      bannedExcludedOpponent: opponentDeck.BannedExcluded,
      seed: usedSeed,
      bestOf: matchBatch.BestOf,
      matchWins: matchBatch.MatchWins,
      matchCount: matchBatch.MatchCount,
      matchWinrate: matchBatch.MatchWinrate,
      matchWinrateLow: matchBatch.Interval.low,
      matchWinrateHigh: matchBatch.Interval.high,
      matches: matchRows,
      optimization,
      opponentDecklist,
      recommendation,
    };
  }

  async matchupMatrix(myDeckId, { games = RUN_SIZES.matrix, seed } = {}) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const usedSeed = normalizeSeed(seed);
    const rows = await this.matchupMatrixRows(myDeck, games, usedSeed);
    const averageWinrate = rows.length > 0 ? round1(rows.reduce((s, r) => s + r.Winrate, 0) / rows.length) : 0;

    return {
      myDeckName: myDeck.Name,
      bannedExcludedMy: myDeck.BannedExcluded,
      seed: usedSeed,
      gamesPerOpponent: games,
      rows: rows.map(r => ({
        name: r.Name,
        category: r.Category,
        winrate: r.Winrate,
        winrateLow: r.Interval.low,
        winrateHigh: r.Interval.high,
        wins: r.Wins,
        draws: r.Draws,
        total: r.Total,
      })),
      averageWinrate,
    };
  }

  // Where a deck named `deckName` goes in `category` ('MyDeck', 'Aggro',
  // 'Midrange' or 'Control'): its id (also its CSV path on the PC) and the
  // display name. Names keep letters, digits, spaces, commas, apostrophes
  // and dashes; spaces become '_' in the id.
  deckIdFor(category, deckName, fallbackName) {
    const validCategories = ['MyDeck', 'Aggro', 'Midrange', 'Control'];
    if (!validCategories.includes(category)) {
      throw new Error(`Invalid destination '${category}'. Must be one of: ${validCategories.join(', ')}.`);
    }

    let rawName = deckName || '';
    if (!rawName.trim()) rawName = fallbackName;
    let safeName = rawName.replace(/[^A-Za-z0-9 ,'-]/g, '').replace(/\s+/g, '_');
    safeName = safeName.replace(/^_+|_+$/g, '');
    if (!safeName) {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      safeName = `${fallbackName.replace(/\s+/g, '_')}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    const id = category === 'MyDeck' ? `MyDeck/${safeName}` : `Opponents/${category}/${safeName}`;
    return { id, name: safeName.replace(/_/g, ' ') };
  }

  async importDeck({ text, category, deckName }) {
    if (!text || !text.trim()) throw new Error('No decklist text was provided.');

    const { id, name } = this.deckIdFor(category, deckName, 'Imported Deck');
    const existing = await this.store.get(id);
    const overwritten = !!existing;

    const parsed = this.parseDeckText(text);
    if (parsed.length === 0) {
      throw new Error("Couldn't find any card lines in that text - expected one card per line, like '1 Rengar, Pridestalker' or '3x Inferna'.");
    }

    const resolved = this.resolveDeckList(parsed);
    if (resolved.Rows.length === 0) {
      throw new Error('None of the lines matched a real card - check the spelling against the official card gallery.');
    }

    const record = {
      id,
      name,
      category: category === 'MyDeck' ? null : category,
      isMyDeck: category === 'MyDeck',
      rows: resolved.Rows,
    };
    await this.store.put(record);

    return {
      success: true,
      deckId: id,
      fileName: this.store.kind === 'files' ? `Decks/${id}.csv` : record.name,
      overwritten,
      category,
      cardsMatched: resolved.Rows.length,
      legendCount: resolved.LegendCount,
      runeTotal: resolved.RuneTotal,
      battlefieldCount: resolved.BattlefieldCount,
      mainDeckTotal: resolved.MainDeckTotal,
      warnings: resolved.Warnings,
    };
  }

  // --------------------------------------------------------------------
  //  DECK EDITING  (the "Decks" tab)
  // --------------------------------------------------------------------
  async getDeck(id) {
    const record = await this.store.get(id);
    if (!record) throw new Error(`Deck not found: ${id}`);
    return {
      id: record.id,
      name: record.name,
      category: record.isMyDeck ? 'MyDeck' : record.category,
      rows: (record.rows || []).map(r => ({ ...r, Quantity: parseInt(r.Quantity, 10) || 0, Tag: r.Tag || '' })),
    };
  }

  // A one-copy row for a card picked in the editor's search.
  cardRow(cardName) {
    const rec = this.cardDatabase.get(cardName.toLowerCase());
    if (!rec || rec.IsToken) throw new Error(`Not a deckbuilding card: '${cardName}'.`);
    return this.rowFromRecord(rec, 1);
  }

  // Real cards whose name contains `query`, for the editor's "add a card"
  // box. With `domains` (the deck's Legend domains), Main Deck cards and
  // Runes outside them are left out; Legends and Battlefields always show.
  searchCards(query, { domains = [], limit = 20 } = {}) {
    const q = normalizeCardName(query);
    if (!q) return [];
    const seen = new Set();
    const matches = [];
    for (const rec of this.cardDatabase.values()) {
      if (seen.has(rec.Name)) continue;
      seen.add(rec.Name);
      if (rec.IsToken || !rec.Type) continue;
      const normName = normalizeCardName(rec.Name);
      if (!normName.includes(q)) continue;
      const cardDomains = (rec.Domains || []).filter(d => d && d !== 'Colorless');
      const domainBound = ['Unit', 'Spell', 'Gear', 'Rune'].includes(rec.Type);
      if (domainBound && domains.length > 0 && cardDomains.length > 0 && !cardDomains.some(d => domains.includes(d))) continue;
      matches.push({ rec, starts: normName.startsWith(q) });
    }
    matches.sort((a, b) => (b.starts - a.starts) || a.rec.Name.localeCompare(b.rec.Name));
    return matches.slice(0, limit).map(({ rec }) => {
      const row = this.rowFromRecord(rec, 1);
      return { name: row.Name, type: row.Type, energy: row.Energy, power: row.Power, might: row.Might, domain: row.Domain };
    });
  }

  // Everything the editor flags about a deck: the deckbuilding counts plus
  // per-card problems (unknown or banned cards, more than 3 copies, cards
  // outside the Legend's domains, malformed Tags).
  checkDeck(rows) {
    const counts = this.deckCounts(rows);
    const problems = [];
    const legendRow = rows.find(r => r.Type === 'Legend');
    const domains = legendRow && legendRow.Domain ? legendRow.Domain.split('/').map(s => s.trim()) : [];

    for (const r of rows) {
      const name = (r.Name || '').trim();
      const qty = parseInt(r.Quantity, 10) || 0;
      if (!this.cardDatabase.get(name.toLowerCase())) problems.push(`'${name}' isn't in the card database.`);
      if (this.bannedSet.has(name.toLowerCase())) problems.push(`'${name}' is banned - it's left out when simulating.`);
      if (['Unit', 'Spell', 'Gear'].includes(r.Type) && qty > 3) problems.push(`'${name}': ${qty} copies - the maximum is 3.`);
      if (['Unit', 'Spell', 'Gear', 'Rune'].includes(r.Type) && domains.length > 0 && r.Domain) {
        const cardDomains = r.Domain.split('/').map(s => s.trim());
        if (!cardDomains.some(d => domains.includes(d))) problems.push(`'${name}' (${r.Domain}) is outside the Legend's domains - it's left out when simulating.`);
      }
      if (r.Tag && r.Tag.trim() && !parseTag(r.Tag)) problems.push(`'${name}': Tag '${r.Tag}' should look like Remove:2, Buff:2, Draw:1 or Shield:2.`);
    }
    return {
      legendCount: counts.legendCount,
      battlefieldCount: counts.battlefieldCount,
      runeTotal: counts.runeTotal,
      mainDeckTotal: counts.mainDeckTotal,
      problems,
    };
  }

  // Saves an edited deck. With `id`, overwrites that deck (keeping its
  // name); without, creates `name` in `category` ("Save as new deck").
  async saveDeck({ id, category, name, rows }) {
    const cleanRows = (rows || [])
      .map(r => ({ ...r, Quantity: parseInt(r.Quantity, 10) || 0, Tag: (r.Tag || '').trim() }))
      .filter(r => r.Quantity > 0);
    if (cleanRows.length === 0) throw new Error('The deck has no cards.');
    const badTag = cleanRows.find(r => r.Tag && !parseTag(r.Tag));
    if (badTag) throw new Error(`'${badTag.Name}': Tag '${badTag.Tag}' should look like Remove:2, Buff:2, Draw:1 or Shield:2.`);

    let target;
    if (id) {
      const current = await this.store.get(id);
      if (!current) throw new Error(`Deck not found: ${id}`);
      target = { id, name: current.name, category: current.isMyDeck ? 'MyDeck' : current.category };
    } else {
      target = { ...this.deckIdFor(category, name, 'New Deck'), category };
    }

    const existing = id ? true : !!(await this.store.get(target.id));
    await this.store.put({
      id: target.id,
      name: target.name,
      category: target.category === 'MyDeck' ? null : target.category,
      isMyDeck: target.category === 'MyDeck',
      rows: cleanRows,
    });
    return { id: target.id, name: target.name, overwritten: existing };
  }

  async deleteDeck(id) {
    await this.store.remove(id);
  }

  // --------------------------------------------------------------------
  //  PAYLOAD SHAPING
  // --------------------------------------------------------------------
  optimizationPayload(deck, gameResults) {
    const raw = this.optimizationStats(deck, gameResults);
    return {
      mostPlayed: raw.MostPlayed.map(c => ({ name: c.Name, count: c.Count })),
      neverPlayed: raw.NeverPlayed,
      averageEnergy: raw.AverageEnergy,
      curveSuggestion: raw.CurveSuggestion,
    };
  }

  decklistPayload(deck) {
    const typeOrder = ['Legend', 'Battlefield', 'Rune', 'Unit', 'Spell', 'Gear'];
    const groups = {};
    for (const t of typeOrder) {
      const rows = deck.DisplayRows.filter(r => r.Type === t).sort((a, b) => a.Name.localeCompare(b.Name));
      if (rows.length === 0) continue;
      groups[t] = rows.map(r => ({ quantity: r.Quantity, name: r.Name, energy: r.Energy, power: r.Power, might: r.Might, domain: r.Domain, tag: r.Tag }));
    }
    return { name: deck.Name, groups };
  }

  recommendationPayload(rec) {
    return {
      opponentCategory: rec.OpponentCategory,
      opponentAverageEnergy: rec.OpponentAverageEnergy,
      primaryConcern: rec.PrimaryConcern,
      advice: rec.Advice,
      sideboardIn: rec.SideboardIn.map(c => ({ name: c.Name, type: c.Type, energy: c.Energy, might: c.Might, domain: c.Domain })),
      sideboardOut: rec.SideboardOut.map(c => ({ name: c.Name, type: c.Type, energy: c.Energy, might: c.Might, domain: c.Domain, timesPlayed: c.TimesPlayed })),
    };
  }
}

export const engine = new Engine();
