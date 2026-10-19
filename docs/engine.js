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

// A card's Tag as an ability, for cards whose official text isn't modeled.
// "Shield:N" on a unit is its own Shield keyword; on gear it goes on the
// unit carrying it (attachLooseGear).
function abilityFromTag(tag, type, keywords) {
  const t = parseTag(tag);
  if (!t) return null;
  if (t.name === 'Shield' && type === 'Unit') {
    keywords.Shield = (keywords.Shield || 0) + t.value;
    return null;
  }
  if (t.name === 'Shield' && type === 'Gear') return null;
  const op = { Remove: 'removeMight', Buff: 'pump', Draw: 'draw', Shield: 'shield' }[t.name];
  return { onPlay: [{ op, n: t.value }] };
}

// ============================================================================
//  COSTS
//  A cost is { energy, symbols }: each Power symbol lists the rune domains
//  that can pay it ('Any' = any domain). A card's Power is paid in its own
//  domain(s) - for a two-domain card either one (approximation: the card
//  data doesn't say which symbol is which).
// ============================================================================
function powerSymbols(card) {
  const domains = (card.Domains || []).filter(d => d && d !== 'Colorless');
  return Array.from({ length: card.Power || 0 }, () => (domains.length ? domains : ['Any']));
}

// { energy: 1, power: { Fury: 1 } } -> cost
function costFromSpec(spec) {
  const symbols = [];
  for (const [domain, n] of Object.entries((spec && spec.power) || {})) {
    for (let i = 0; i < n; i++) symbols.push([domain]);
  }
  return { energy: (spec && spec.energy) || 0, symbols };
}

function addCosts(a, b) {
  return { energy: a.energy + b.energy, symbols: a.symbols.concat(b.symbols) };
}

// ============================================================================
//  ABILITY DESCRIPTIONS (what the simulator understands of a card, in words)
// ============================================================================
function costText(spec) {
  const parts = [];
  if (spec && spec.energy) parts.push(`${spec.energy} Energy`);
  for (const [d, n] of Object.entries((spec && spec.power) || {})) parts.push(`${n} ${d === 'Any' ? 'any' : d} Power`);
  return parts.join(' + ') || 'nothing';
}

function describeOp(o) {
  const s = n => (n === 1 ? '' : 's');
  switch (o.op) {
    case 'draw': return `draw ${o.n}${o.perOtherControlledBattlefield ? ' for each other battlefield you control' : ''}${o.cond === 'otherUnitsMight5' ? ' if your other units have 5+ Might' : ''}${o.cond === 'diedAlone' ? ' if it died alone' : ''}`;
    case 'pump': return `${o.self ? 'it gets' : `give ${o.count > 1 ? `${o.count} friendly units` : 'a friendly unit'}`} +${o.n} Might this turn${o.perEnemyHere ? ' per enemy unit there' : ''}${o.aloneBonus ? ` (+${o.aloneBonus} more if alone)` : ''}`;
    case 'assault': return `${o.self ? 'it gets' : 'give a unit'} Assault ${o.n}${o.permanent ? '' : ' this turn'}`;
    case 'shield': return `give a unit Shield ${o.n}${o.tank ? ' and Tank' : ''} this turn`;
    case 'prevent': return `prevent the next ${o.n} damage to a unit this turn`;
    case 'damage': return `deal ${o.n} to an enemy unit${o.splash ? ` and ${o.splash} to the other enemy units there` : ''}`;
    case 'damageMulti': return `deal ${o.n} to up to ${o.count} units at one place`;
    case 'damageAll': return o.scope === 'enemyCombat' ? `deal ${o.n} to every enemy unit in the fight` : `deal ${o.n} to every unit at a battlefield`;
    case 'damageHere': return `deal ${o.n} to each unit here`;
    case 'removeMight': return `destroy enemy units worth up to ${o.n} Might`;
    case 'kill': return `kill an enemy unit${o.maxMight !== undefined ? ` with ${o.maxMight} Might or less` : ''}${o.controllerDraws ? ` (its controller draws ${o.controllerDraws})` : ''}`;
    case 'fight': return 'a friendly unit and an enemy unit deal damage to each other';
    case 'stun': return `stun ${o.attackerOnly ? 'an attacking' : 'an'} enemy unit`;
    case 'weaken': return o.all ? `enemy units get -${o.n} Might this turn` : `an enemy unit gets -${o.n} Might this turn`;
    case 'token': return `play ${o.count || 1} ${o.ready ? 'ready ' : ''}${o.might}-Might token${s(o.count || 1)}${o.temporary ? ' (Temporary)' : ''}${o.deflect ? ' (Deflect)' : ''}`;
    case 'counter': return `counter a spell${o.maxEnergy !== undefined ? ` costing up to ${o.maxEnergy} Energy and ${o.maxPower} Power` : ''}${o.onlyIfTargetsFriendly ? ' that targets your unit' : ''}${o.requiresPriorSpell ? ' (if the opponent already cast a spell this turn)' : ''}`;
    case 'buff': return o.self ? 'buff it (+1 Might)' : `buff ${o.count || 1} ${o.others ? 'other ' : ''}friendly unit${s(o.count || 1)}${o.where === 'base' ? ' in base' : ''} (+1 Might)`;
    case 'empower': return `it becomes Empowered (+${o.n} Might)`;
    case 'channel': return `channel ${o.n} rune${s(o.n)} exhausted`;
    case 'discard': return o.who === 'opponent' ? `the opponent discards ${o.n}` : `discard ${o.n}`;
    case 'ready': return o.who === 'self' ? 'ready it' : 'ready another friendly unit';
    case 'ganking': return 'give a unit Ganking this turn';
    case 'mill': return `put the top ${o.n} cards of your deck into your trash`;
    case 'readyRunesAtEnd': return `ready ${o.n} runes at the end of the turn`;
    case 'optional': return `you may pay ${costText(o.cost)} to ${(o.then || []).map(describeOp).join(' and ')}`;
    default: return o.op;
  }
}

const TRIGGER_TEXT = {
  onAttack: 'When it attacks',
  onDefend: 'When you defend here',
  onHold: 'When held',
  onConquer: 'When conquered',
  onWinCombat: 'When it wins a fight',
  onCombatEnd: 'After a fight it survives',
  onDeath: 'When it dies',
  onFriendlyUnitPlayed: 'When you play a unit',
  onSecondCard: 'When you play your second card in a turn',
  startOfBeginning: 'At the start of each Beginning Phase',
};

function describeStatic(st) {
  const parts = [];
  if (st.mightPerScore) parts.push('+1 Might per point you have');
  if (st.mightPerBuffedHere) parts.push('+1 Might per buffed friendly unit here');
  if (st.silenceWeakerEnemiesHere) parts.push("enemy units here with less Might don't deal combat damage");
  if (st.aloneEnemyBonus) parts.push(`+${st.aloneEnemyBonus} Might in a fight against a lone enemy unit`);
  if (st.friendlyAloneBonus) parts.push(`a friendly unit ${st.friendlyAloneBonus.when === 'defend' ? 'defending' : 'attacking or defending'} alone gets +${st.friendlyAloneBonus.n} Might`);
  if (st.assaultPerEnemyHere) parts.push('Assault equal to the enemy units here');
  if (st.tankBonusHere) parts.push(`units here with Tank have +${st.tankBonusHere} Might`);
  if (st.defendAloneMalusHere) parts.push(`a unit defending alone here has -${st.defendAloneMalusHere} Might`);
  if (st.noScoreBeforeTurn) parts.push(`players can't score here before their turn ${st.noScoreBeforeTurn}`);
  return parts.join('; ');
}

function describeAbility(ability, type) {
  if (!ability) return '';
  const parts = [];
  if (ability.onPlay && ability.onPlay.length) {
    const text = ability.onPlay.map(describeOp).join(', then ');
    parts.push(type === 'Spell' ? text.charAt(0).toUpperCase() + text.slice(1) : `When played: ${text}`);
  }
  for (const [key, label] of Object.entries(TRIGGER_TEXT)) {
    if (ability[key] && ability[key].length) parts.push(`${label}: ${ability[key].map(describeOp).join(', then ')}`);
  }
  if (ability.activate) parts.push(`Exhaust${ability.activate.cost ? ` and pay ${costText(ability.activate.cost)}` : ''}: ${ability.activate.ops.map(describeOp).join(', then ')}`);
  if (ability.resource) parts.push(`Exhaust: add ${ability.resource.energy ? `${ability.resource.energy} Energy` : `1 ${ability.resource.power} Power`}`);
  if (ability.static) parts.push(describeStatic(ability.static));
  return parts.filter(Boolean).join('. ') + (parts.length ? '.' : '');
}

function describeKeywords(keywords) {
  return Object.entries(keywords || {}).map(([k, v]) => {
    if (k === 'Accelerate') return `Accelerate (${costText(v)})`;
    return v === true || (k === 'Deflect' && v === 1) ? k : `${k} ${v}`;
  });
}

// Official card art (it carries the rules text), hotlinked from Piltover
// Archive's card gallery by collector code.
function cardImageUrl(code) {
  return code ? `https://cdn.piltoverarchive.com/cards/${code}.webp?width=420` : null;
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
    this.gameCounter = 0;             // games played since the run started
    this.replay = null;               // { index, log } while replaying a game
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
        Code: v.code || null,                 // collector code, for the card image
        Keywords: v.keywords || {},           // from the official text
        Equip: v.equip || null,               // [Equip] cost
        Ability: v.ability || null,           // curated from the official text
        AbilityPartial: !!v.abilityPartial,   // some of the text isn't modeled
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
    const runes = [];
    const battlefields = [];
    const displayRows = [];
    let skippedOffDomain = 0;
    const bannedFound = [];

    const legendRow = rows.find(r => r.Type === 'Legend');
    const legendDomain = legendRow ? legendRow.Domain : null;
    const legendName = legendRow ? legendRow.Name.trim() : null;
    const legendRec = legendName ? this.cardDatabase.get(legendName.toLowerCase()) : null;
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

      const qty = parseInt(row.Quantity, 10) || 0;
      const rec = this.cardDatabase.get(name.toLowerCase()) || null;

      if (row.Type === 'Rune') {
        const domain = (row.Domain || (rec && rec.Domains[0]) || 'Any').trim();
        for (let i = 0; i < qty; i++) runes.push(domain);
        continue;
      }
      if (row.Type === 'Battlefield') {
        battlefields.push({ Name: name, Ability: rec ? rec.Ability : null });
        continue;
      }
      if (row.Type === 'Legend') continue;

      if (allowedDomains.length > 0) {
        const cardDomains = row.Domain ? row.Domain.split('/').map(s => s.trim()) : [];
        if (cardDomains.length > 0 && !cardDomains.some(d => allowedDomains.includes(d))) {
          skippedOffDomain++;
          continue;
        }
      }

      const card = this.playableCard(row, rec);
      for (let i = 0; i < qty; i++) cards.push(card);
    }

    // A deck without Rune rows still plays with a standard 12, split
    // between its Legend's domains.
    if (runes.length === 0) {
      const doms = allowedDomains.length ? allowedDomains : ['Any'];
      for (let i = 0; i < RUNE_DECK_SIZE; i++) runes.push(doms[i % doms.length]);
    }

    return {
      Cards: cards,
      Runes: runes,
      Battlefields: battlefields,
      Legend: { Name: legendName, Ability: legendRec ? legendRec.Ability : null },
      Domain: legendDomain,
      Name: record.name,
      LegendName: legendName,
      DisplayRows: displayRows,
      BannedExcluded: [...new Set(bannedFound)],
      SkippedOffDomain: skippedOffDomain,
    };
  }

  // A Main Deck card as the engine plays it: stats from the deck row,
  // keywords and ability from the card database (curated from the official
  // text). A card whose text isn't modeled falls back to the row's Tag.
  playableCard(row, rec) {
    const domains = (row.Domain || '').split('/').map(s => s.trim()).filter(d => d && d !== 'Colorless');
    const keywords = { ...((rec && rec.Keywords) || {}) };
    let ability = rec && rec.Ability ? rec.Ability : null;
    const tagOverridden = !!ability && !!parseTag(row.Tag);
    if (!ability) ability = abilityFromTag(row.Tag, row.Type, keywords);
    return {
      Name: row.Name.trim(),
      Type: row.Type,
      Energy: parseInt(row.Energy, 10) || 0,
      Power: parseInt(row.Power, 10) || 0,
      Might: parseInt(row.Might, 10) || 0,
      Domain: row.Domain,
      Domains: domains,
      Tag: row.Tag,
      TagOverridden: tagOverridden,
      Keywords: keywords,
      Ability: ability,
      Equip: (rec && rec.Equip) || null,
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
  //  - 2 battlefields: each player brings one of their 3 (picked at random;
  //    a best-of-3 never repeats one). Battlefield abilities come from the
  //    card database.
  //  - Opening hand of 4, then a mulligan of up to 2 cards.
  //  - Runes: channel 2 a turn (3 on the second player's first turn) from
  //    the shuffled Rune Deck. Energy is paid by exhausting runes, Power by
  //    recycling runes of the card's domain to the bottom of the Rune Deck
  //    (an exhausted rune can still be recycled). Runes left ready can pay
  //    for Reactions on the opponent's turn.
  //  - Units are played exhausted (ready with [Accelerate]), to base or to a
  //    battlefield you control; a ready unit exhausts to move from base to a
  //    battlefield ([Ganking]: from battlefield to battlefield).
  //  - Combat: [Reaction]/[Action] cards and [Ambush] units can be played in
  //    the fight (defender first, then attacker); damage is simultaneous,
  //    [Tank] units take it first and [Backline] units last. If only
  //    attackers remain they conquer; if defenders remain, surviving
  //    attackers go back to base.
  //  - Control lasts while you have units there.
  //  - Hold: +1 point per battlefield you control at the start of your turn.
  //    Conquer: +1 point. Each battlefield scores at most once per turn. The
  //    winning point can't come from a conquer unless every battlefield
  //    scored this turn - the player draws 1 instead.
  //  - Spells can be countered by the opponent's counterspells.
  //  - Burn Out: drawing from an empty deck shuffles the trash back in and
  //    the opponent gains 1 point.
  //  - Damage and "this turn" effects end at end of turn; [Temporary] units
  //    die at the start of their controller's Beginning Phase.
  //  - First to 8 wins; a game unfinished after MAX_ROUNDS is a draw.
  //
  //  Both players use the same simple AI (see actionPhase, attackStep,
  //  react).
  // --------------------------------------------------------------------
  newPlayerState(deck, label) {
    return {
      Label: label,
      DeckName: deck.Name,
      Library: shuffle(deck.Cards, this.rng),
      Hand: [],
      Trash: [],
      RuneDeck: shuffle(deck.Runes, this.rng),
      Runes: [],          // on the board: { domain, exhausted }
      Base: [],           // units in base
      Gear: [],           // gear in play: { card, holder, exhausted }
      Legend: { name: deck.Legend.Name, ability: deck.Legend.Ability, exhausted: false },
      Battlefield: null,
      TurnsTaken: 0,
      Score: 0,
      BurnOutCount: 0,
      CardsPlayedThisTurn: 0,
      SpellsPlayedThisTurn: 0,
      ReadyRunesAtEnd: 0,
      PlayLog: [],
      EarlyEnergySeen: 0,   // Energy available over the first EARLY_TURNS turns
      EarlyEnergySpent: 0,
      EnergySpentThisTurn: 0,
      PeakBoardMight: 0,
      EverLed: false,
    };
  }

  newUnit(card, owner, { ready = false, temporary = false, token = false } = {}) {
    const kw = card.Keywords || {};
    return {
      card, owner, ability: card.Ability || null, at: -1,
      bonusMight: 0, tempMight: 0, buffed: false, empowered: false,
      assault: kw.Assault || 0, tempAssault: 0,
      shield: kw.Shield || 0, tempShield: 0,
      tank: !!kw.Tank, tempTank: false, backline: !!kw.Backline,
      ganking: !!kw.Ganking, tempGanking: false,
      deflect: kw.Deflect || 0,
      temporary: temporary || !!kw.Temporary, token,
      weaken: 0, stunned: false, prevent: 0, damage: 0,
      exhausted: !ready, gear: [], dead: false,
    };
  }

  tokenCard(might, deflect) {
    return { Name: `${might}-Might token`, Type: 'Unit', Energy: 0, Power: 0, Might: might, Domains: [], Keywords: deflect ? { Deflect: 1 } : {}, Ability: null };
  }

  note(g, player, text) {
    if (g.log) g.log.push({ round: g.round, who: player ? player.Label : null, text });
  }

  // --- board queries ---------------------------------------------------------

  unitsOf(player, g) {
    return player.Base.concat(g.battlefields.flatMap(bf => bf.units.filter(u => u.owner === player)));
  }

  unitsAt(g, b, player) {
    return g.battlefields[b].units.filter(u => u.owner === player);
  }

  enemiesAtBattlefields(player, g) {
    return g.battlefields.flatMap(bf => bf.units.filter(u => u.owner !== player));
  }

  bfName(g, b) {
    const bf = g.battlefields[b];
    return bf.card ? bf.card.Name : `battlefield ${b + 1}`;
  }

  bfStatic(g, b) {
    const bf = g.battlefields[b];
    return bf && bf.card && bf.card.Ability && bf.card.Ability.static ? bf.card.Ability.static : null;
  }

  isTank(u) {
    return u.tank || u.tempTank;
  }

  // Might outside combat: printed + gear + buff/empower + this-turn changes
  // + always-on statics.
  baseMight(u, g) {
    let m = u.card.Might + u.bonusMight + u.tempMight;
    const st = u.ability && u.ability.static;
    if (st && st.mightPerScore) m += st.mightPerScore * u.owner.Score;
    if (st && st.mightPerBuffedHere && u.at >= 0) {
      m += st.mightPerBuffedHere * this.unitsAt(g, u.at, u.owner).filter(x => x.buffed).length;
    }
    if (u.at >= 0) {
      const bfSt = this.bfStatic(g, u.at);
      if (bfSt && bfSt.tankBonusHere && this.isTank(u)) m += bfSt.tankBonusHere;
    }
    // "-N this turn, to a minimum of 1".
    if (u.weaken > 0 && m > 1) m = Math.max(1, m - u.weaken);
    return Math.max(0, m);
  }

  // "+N while alone": gear like Mask of Foresight and Legends like Master Yi.
  aloneBonus(player, role) {
    const sources = player.Gear.map(x => x.card.Ability).concat([player.Legend.ability]);
    let bonus = 0;
    for (const ab of sources) {
      const b = ab && ab.static && ab.static.friendlyAloneBonus;
      if (b && (b.when === 'attackOrDefend' || b.when === role)) bonus += b.n;
    }
    return bonus;
  }

  combatMight(u, role, g, combat) {
    let m = this.baseMight(u, g);
    const st = u.ability && u.ability.static;
    const friends = (role === 'attack' ? combat.attackers : combat.defenders).filter(x => !x.dead);
    const enemies = (role === 'attack' ? combat.defenders : combat.attackers).filter(x => !x.dead);
    if (role === 'attack') {
      m += u.assault + u.tempAssault;
      if (st && st.assaultPerEnemyHere) m += st.assaultPerEnemyHere * enemies.length;
    } else {
      m += u.shield + u.tempShield;
      const bfSt = this.bfStatic(g, combat.b);
      if (bfSt && bfSt.defendAloneMalusHere && friends.length === 1) m -= bfSt.defendAloneMalusHere;
    }
    if (st && st.aloneEnemyBonus && enemies.length === 1) m += st.aloneEnemyBonus;
    if (friends.length === 1) m += this.aloneBonus(u.owner, role === 'attack' ? 'attack' : 'defend');
    return Math.max(0, m);
  }

  combatHealth(u, role, g, combat) {
    return this.combatMight(u, role, g, combat) + u.prevent - u.damage;
  }

  // Combat damage a unit deals: none if stunned, or if a unit like Vilemaw
  // ("enemy units here with less Might than me don't deal combat damage")
  // outclasses it.
  combatDamage(u, role, g, combat) {
    if (u.stunned) return 0;
    const enemies = (role === 'attack' ? combat.defenders : combat.attackers).filter(x => !x.dead);
    const mine = this.baseMight(u, g);
    if (enemies.some(e => e.ability && e.ability.static && e.ability.static.silenceWeakerEnemiesHere && this.baseMight(e, g) > mine)) return 0;
    return this.combatMight(u, role, g, combat);
  }

  // --- runes and costs --------------------------------------------------------

  channel(player, count, exhausted, g) {
    let n = 0;
    for (let i = 0; i < count && player.RuneDeck.length > 0; i++) {
      player.Runes.push({ domain: player.RuneDeck.shift(), exhausted });
      n++;
    }
    return n;
  }

  energySources(player, g) {
    const units = this.unitsOf(player, g).filter(u => !u.exhausted && u.ability && u.ability.resource && u.ability.resource.energy);
    return player.Runes.filter(r => !r.exhausted).length + units.length;
  }

  // Assigns each Power symbol (a list of acceptable domains, or 'Any') a
  // source: a ready Seal-type gear first, then a rune of that domain
  // (exhausted ones first). Returns the assignment, or null if it can't.
  assignPower(player, symbols) {
    const seals = player.Gear.filter(x => !x.exhausted && x.card.Ability && x.card.Ability.resource && x.card.Ability.resource.power);
    const runes = player.Runes.slice().sort((a, b) => (b.exhausted - a.exhausted));
    const used = new Set();
    const plan = [];
    const ordered = symbols.slice().sort((a, b) => (a.includes('Any') ? 1 : a.length) - (b.includes('Any') ? 1 : b.length));
    for (const sym of ordered) {
      const fits = d => sym.includes('Any') || sym.includes(d);
      const seal = seals.find(x => !used.has(x) && fits(x.card.Ability.resource.power));
      if (seal) { used.add(seal); plan.push({ seal }); continue; }
      const rune = runes.find(r => !used.has(r) && fits(r.domain));
      if (!rune) return null;
      used.add(rune);
      plan.push({ rune });
    }
    return plan;
  }

  canPay(player, cost, g) {
    if (this.energySources(player, g) < cost.energy) return false;
    return cost.symbols.length === 0 || this.assignPower(player, cost.symbols) !== null;
  }

  pay(player, cost, g) {
    let energy = cost.energy;
    for (const r of player.Runes) {
      if (energy <= 0) break;
      if (!r.exhausted) { r.exhausted = true; energy--; }
    }
    if (energy > 0) {
      for (const u of this.unitsOf(player, g)) {
        if (energy <= 0) break;
        if (!u.exhausted && u.ability && u.ability.resource && u.ability.resource.energy) { u.exhausted = true; energy--; }
      }
    }
    player.EnergySpentThisTurn += cost.energy;
    if (cost.symbols.length === 0) return;
    // Recycle: back to the bottom of the Rune Deck.
    for (const step of this.assignPower(player, cost.symbols)) {
      if (step.seal) {
        step.seal.exhausted = true;
      } else {
        player.Runes.splice(player.Runes.indexOf(step.rune), 1);
        player.RuneDeck.push(step.rune.domain);
      }
    }
  }

  cardCost(card, accelerate = false) {
    let cost = { energy: card.Energy, symbols: powerSymbols(card) };
    if (accelerate && card.Keywords && card.Keywords.Accelerate) cost = addCosts(cost, costFromSpec(card.Keywords.Accelerate));
    return cost;
  }

  // --- points --------------------------------------------------------------

  gainPoint(player, opponent, g) {
    player.Score = Math.min(player.Score + 1, VICTORY_SCORE);
    if (player.Score > opponent.Score) player.EverLed = true;
    if (player.Score >= VICTORY_SCORE && !g.winner) g.winner = player;
  }

  scoreBattlefield(player, opponent, g, b, how) {
    if (g.winner || g.scoredThisTurn.has(b)) return;
    const st = this.bfStatic(g, b);
    if (st && st.noScoreBeforeTurn && player.TurnsTaken < st.noScoreBeforeTurn) {
      this.note(g, player, `can't score at ${this.bfName(g, b)} before their turn ${st.noScoreBeforeTurn}.`);
      return;
    }
    const isWinningPoint = player.Score === VICTORY_SCORE - 1;
    if (isWinningPoint && how === 'conquer' && g.scoredThisTurn.size < BATTLEFIELD_COUNT - 1) {
      this.note(g, player, `conquers ${this.bfName(g, b)} but the final point needs a hold or every battlefield - draws 1 instead.`);
      this.drawCards(player, opponent, g, 1);
      return;
    }
    g.scoredThisTurn.add(b);
    this.gainPoint(player, opponent, g);
    this.note(g, player, `scores for ${how === 'hold' ? 'holding' : 'conquering'} ${this.bfName(g, b)} (${player.Score}-${opponent.Score}).`);
  }

  conquer(player, opponent, g, b) {
    g.battlefields[b].controller = player;
    this.scoreBattlefield(player, opponent, g, b, 'conquer');
    if (g.winner) return;
    const bfAb = g.battlefields[b].card && g.battlefields[b].card.Ability;
    if (bfAb && bfAb.onConquer) this.runOps(bfAb.onConquer, { p: player, opp: opponent, g, b, source: this.bfName(g, b) });
  }

  updateControl(g, b) {
    const bf = g.battlefields[b];
    if (bf.controller && !bf.units.some(u => u.owner === bf.controller)) bf.controller = null;
  }

  // --- cards in and out ------------------------------------------------------

  drawCards(player, opponent, g, count = 1) {
    for (let i = 0; i < count; i++) {
      if (g.winner) return;
      if (player.Library.length === 0) {
        // Burn Out: shuffle the trash back in, the opponent gains 1 point.
        player.BurnOutCount++;
        player.Library = shuffle(player.Trash, this.rng);
        player.Trash = [];
        this.note(g, player, 'burns out - the trash is shuffled back in and the opponent scores 1.');
        this.gainPoint(opponent, player, g);
        if (g.winner || player.Library.length === 0) return;
      }
      player.Hand.push(player.Library.shift());
    }
  }

  openingHand(player, g) {
    player.Hand = player.Library.splice(0, OPENING_HAND);
    // Mulligan: set aside up to 2 cards too expensive for the early turns,
    // draw that many, then shuffle the set-aside cards back in.
    const setAside = player.Hand
      .filter(c => c.Energy >= MULLIGAN_MIN_ENERGY)
      .sort((a, b) => b.Energy - a.Energy)
      .slice(0, MULLIGAN_MAX);
    if (setAside.length > 0) {
      player.Hand = player.Hand.filter(c => !setAside.includes(c));
      player.Hand.push(...player.Library.splice(0, setAside.length));
      player.Library = shuffle(player.Library.concat(setAside), this.rng);
    }
    this.note(g, player, `opening hand: ${player.Hand.map(c => c.Name).join(', ')}${setAside.length ? ` (mulliganed ${setAside.map(c => c.Name).join(', ')})` : ''}.`);
  }

  removeFromLocation(u, g) {
    const inBase = u.owner.Base.indexOf(u);
    if (inBase >= 0) u.owner.Base.splice(inBase, 1);
    if (u.at >= 0) {
      const units = g.battlefields[u.at].units;
      const idx = units.indexOf(u);
      if (idx >= 0) units.splice(idx, 1);
      this.updateControl(g, u.at);
    }
  }

  killUnit(u, g, why) {
    if (u.dead) return;
    const where = u.at;
    const diedAlone = where >= 0 ? this.unitsAt(g, where, u.owner).length === 1 : u.owner.Base.length === 1;
    u.dead = true;
    this.removeFromLocation(u, g);
    for (const gear of u.gear) gear.holder = null;
    if (!u.token) u.owner.Trash.push(u.card);
    this.note(g, u.owner, `loses ${u.card.Name}${why ? ` (${why})` : ''}.`);
    if (u.ability && u.ability.onDeath) {
      const opp = g.players.find(x => x !== u.owner);
      this.runOps(u.ability.onDeath, { p: u.owner, opp, g, self: u, diedAlone, source: u.card.Name });
    }
  }

  // Damage outside the combat step (spells, battlefields): it's marked until
  // end of turn and kills once it reaches the unit's Might.
  dealDamage(u, n, g, source) {
    if (u.dead || n <= 0) return;
    const absorbed = Math.min(u.prevent, n);
    u.prevent -= absorbed;
    u.damage += n - absorbed;
    if (u.damage > 0 && u.damage >= this.baseMight(u, g)) this.killUnit(u, g, source);
  }

  // Damage from an effect: during a fight it's checked against the unit's
  // combat Might (Shield/Assault count), otherwise against its Might.
  hit(u, n, ctx) {
    const combat = ctx.combat;
    const role = combat && (combat.attackers.includes(u) ? 'attack' : (combat.defenders.includes(u) ? 'defend' : null));
    if (!role) {
      this.dealDamage(u, n, ctx.g, ctx.source);
      return;
    }
    const absorbed = Math.min(u.prevent, n);
    u.prevent -= absorbed;
    u.damage += n - absorbed;
    if (this.combatHealth(u, role, ctx.g, combat) <= 0) this.killUnit(u, ctx.g, ctx.source);
  }

  // Gear with Might (Equipment) goes on the strongest unit; one with an
  // [Equip] cost only when it can be paid. Gear with a Shield tag works the
  // same way.
  attachLooseGear(player, opponent, g) {
    for (const gear of player.Gear) {
      if (gear.holder) continue;
      const shield = gear.card.ShieldTag || 0;
      if (gear.card.Might <= 0 && shield === 0) continue;
      const holder = this.strongest(this.unitsOf(player, g), g);
      if (!holder) return;
      if (gear.card.Equip) {
        const cost = costFromSpec(gear.card.Equip);
        if (!this.canPay(player, cost, g)) continue;
        this.pay(player, cost, g);
      }
      gear.holder = holder;
      holder.gear.push(gear);
      holder.bonusMight += gear.card.Might;
      holder.shield += shield;
      this.note(g, player, `equips ${gear.card.Name} to ${holder.card.Name}.`);
    }
  }

  strongest(units, g) {
    return units.reduce((best, u) => (!best || this.baseMight(u, g) > this.baseMight(best, g) ? u : best), null);
  }

  // --- choosing targets --------------------------------------------------------

  friendlyTargets(ctx, count) {
    const { p, g, combat } = ctx;
    let pool;
    if (combat) {
      pool = (combat.attacker === p ? combat.attackers : combat.defenders).filter(u => !u.dead);
    } else {
      const ready = p.Base.filter(u => !u.exhausted);
      pool = ready.length ? ready : this.unitsOf(p, g);
    }
    return pool.slice().sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g)).slice(0, count);
  }

  // Enemy units an effect can choose: in a combat, the enemy combatants
  // (attackers only for "an attacking unit"); otherwise enemy units at
  // battlefields, the one this player is about to attack first.
  enemyPool(ctx, attackerOnly) {
    const { p, g, combat } = ctx;
    if (combat) {
      if (attackerOnly && combat.attacker === p) return [];
      return (combat.attacker === p ? combat.defenders : combat.attackers).filter(u => !u.dead);
    }
    if (attackerOnly) return [];
    const all = this.enemiesAtBattlefields(p, g);
    if (ctx.targetBf >= 0) {
      const first = all.filter(u => u.at === ctx.targetBf);
      if (first.length) return first;
    }
    return all;
  }

  // [Deflect]: choosing the unit costs extra Power of any domain.
  payToChoose(ctx, u) {
    if (!u.deflect) return true;
    const cost = { energy: 0, symbols: Array.from({ length: u.deflect }, () => ['Any']) };
    if (!this.canPay(ctx.p, cost, ctx.g)) return false;
    this.pay(ctx.p, cost, ctx.g);
    return true;
  }

  pickEnemy(ctx, candidates) {
    for (const u of candidates) {
      if (u.deflect && !this.canPay(ctx.p, { energy: 0, symbols: Array.from({ length: u.deflect }, () => ['Any']) }, ctx.g)) continue;
      if (this.payToChoose(ctx, u)) return u;
    }
    return null;
  }

  // --- running ability ops ---------------------------------------------------

  runOps(ops, ctx) {
    for (const op of ops || []) {
      if (ctx.g.winner) return;
      this.runOp(op, ctx);
    }
  }

  runOp(op, ctx) {
    const { p, opp, g } = ctx;
    const health = u => (ctx.combat ? this.combatHealth(u, ctx.combat.attackers.includes(u) ? 'attack' : 'defend', g, ctx.combat) : this.baseMight(u, g) - u.damage);
    switch (op.op) {
      case 'draw': {
        if (op.cond === 'otherUnitsMight5' && sumBy(this.unitsOf(p, g).filter(u => u !== ctx.self), u => this.baseMight(u, g)) < 5) return;
        if (op.cond === 'diedAlone' && !ctx.diedAlone) return;
        if (op.exhaustSelf) {
          if (p.Legend.exhausted) return;
          p.Legend.exhausted = true;
        }
        let n = op.n;
        if (op.perOtherControlledBattlefield) n *= g.battlefields.filter((bf, b) => b !== ctx.b && bf.controller === p).length;
        if (n > 0) {
          this.drawCards(p, opp, g, n);
          this.note(g, p, `draws ${n} (${ctx.source}).`);
        }
        return;
      }
      case 'pump': {
        const targets = op.self && ctx.self ? [ctx.self] : this.friendlyTargets(ctx, op.count || 1);
        for (const u of targets) {
          let amount = op.n;
          if (op.perEnemyHere) amount = op.n * (u.at >= 0 ? this.unitsAt(g, u.at, opp).length : 0);
          if (op.aloneBonus && (u.at >= 0 ? this.unitsAt(g, u.at, p).length : p.Base.length) === 1) amount += op.aloneBonus;
          u.tempMight += amount;
          this.note(g, p, `gives ${u.card.Name} +${amount} Might this turn (${ctx.source}).`);
        }
        return;
      }
      case 'assault': {
        const u = op.self && ctx.self ? ctx.self : this.friendlyTargets(ctx, 1)[0];
        if (!u) return;
        if (op.permanent) u.assault += op.n;
        else u.tempAssault += op.n;
        this.note(g, p, `gives ${u.card.Name} Assault ${op.n}${op.permanent ? '' : ' this turn'} (${ctx.source}).`);
        return;
      }
      case 'shield': {
        const u = this.friendlyTargets(ctx, 1)[0];
        if (!u) return;
        u.tempShield += op.n;
        if (op.tank) u.tempTank = true;
        this.note(g, p, `gives ${u.card.Name} Shield ${op.n}${op.tank ? ' and Tank' : ''} this turn (${ctx.source}).`);
        return;
      }
      case 'prevent': {
        const u = this.friendlyTargets(ctx, 1)[0];
        if (!u) return;
        u.prevent += op.n;
        this.note(g, p, `protects ${u.card.Name} from the next ${op.n} damage (${ctx.source}).`);
        return;
      }
      case 'damage': {
        const pool = this.enemyPool(ctx, false);
        const killable = pool.filter(u => health(u) <= op.n).sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g));
        const others = ctx.combat ? pool.filter(u => !killable.includes(u)).sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g)) : [];
        const u = this.pickEnemy(ctx, killable.concat(others));
        if (!u) return;
        const where = u.at;
        this.note(g, p, `deals ${op.n} to ${u.card.Name} (${ctx.source}).`);
        this.hit(u, op.n, ctx);
        if (op.splash && where >= 0) {
          for (const other of this.unitsAt(g, where, opp)) if (other !== u) this.hit(other, op.splash, ctx);
        }
        return;
      }
      case 'damageMulti': {
        // "Deal N to up to K units at the same location": the location where
        // that kills the most enemy units.
        let best = null;
        for (let b = 0; b < g.battlefields.length; b++) {
          const hits = this.unitsAt(g, b, opp).filter(u => health(u) <= op.n).slice(0, op.count);
          if (!best || hits.length > best.length) best = hits;
        }
        for (const u of best || []) this.hit(u, op.n, ctx);
        if (best && best.length) this.note(g, p, `deals ${op.n} to ${best.map(u => u.card.Name).join(', ')} (${ctx.source}).`);
        return;
      }
      case 'damageAll': {
        let victims;
        if (op.scope === 'enemyCombat') victims = ctx.combat ? (ctx.combat.attacker === p ? ctx.combat.defenders : ctx.combat.attackers).filter(u => !u.dead) : [];
        else victims = g.battlefields.flatMap(bf => bf.units.slice());
        this.note(g, p, `deals ${op.n} to ${victims.length} unit(s) (${ctx.source}).`);
        for (const u of victims) {
          if (ctx.combat) u.damage += op.n; // checked by the combat step
          else this.dealDamage(u, op.n, g, ctx.source);
        }
        return;
      }
      case 'damageHere': {
        if (ctx.b === undefined || ctx.b < 0) return;
        const victims = g.battlefields[ctx.b].units.slice();
        if (victims.length) this.note(g, null, `${ctx.source} deals ${op.n} to each unit there.`);
        for (const u of victims) this.dealDamage(u, op.n, g, ctx.source);
        return;
      }
      case 'removeMight': {
        // Legacy Tag "Remove:N": destroy enemy units worth up to N Might in
        // total, biggest that fits first, units holding a battlefield first.
        let remaining = op.n;
        for (const pool of [this.enemiesAtBattlefields(p, g), opp.Base.slice()]) {
          for (const u of pool.sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g))) {
            if (u.dead || this.baseMight(u, g) > remaining || !this.payToChoose(ctx, u)) continue;
            remaining -= this.baseMight(u, g);
            this.killUnit(u, g, ctx.source);
          }
        }
        return;
      }
      case 'kill': {
        const pool = this.enemyPool(ctx, false)
          .filter(u => op.maxMight === undefined || this.baseMight(u, g) <= op.maxMight)
          .sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g));
        const u = this.pickEnemy(ctx, pool);
        if (!u) return;
        this.killUnit(u, g, ctx.source);
        if (op.controllerDraws) this.drawCards(opp, p, g, op.controllerDraws);
        return;
      }
      case 'fight': {
        const pair = this.bestFight(p, opp, g);
        if (!pair || !this.payToChoose(ctx, pair.enemy)) return;
        const mine = this.baseMight(pair.friend, g);
        const theirs = this.baseMight(pair.enemy, g);
        this.note(g, p, `${pair.friend.card.Name} fights ${pair.enemy.card.Name} (${ctx.source}).`);
        this.dealDamage(pair.enemy, mine, g, ctx.source);
        this.dealDamage(pair.friend, theirs, g, ctx.source);
        return;
      }
      case 'stun': {
        const pool = this.enemyPool(ctx, !!op.attackerOnly).sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g));
        const u = this.pickEnemy(ctx, pool.filter(x => !x.stunned));
        if (!u) return;
        u.stunned = true;
        this.note(g, p, `stuns ${u.card.Name} (${ctx.source}).`);
        return;
      }
      case 'weaken': {
        if (op.all) {
          for (const u of this.unitsOf(opp, g)) u.weaken += op.n;
          this.note(g, p, `gives enemy units -${op.n} Might this turn (${ctx.source}).`);
          return;
        }
        const pool = this.enemyPool(ctx, false).sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g));
        const u = this.pickEnemy(ctx, pool);
        if (!u) return;
        u.weaken += op.n;
        this.note(g, p, `gives ${u.card.Name} -${op.n} Might this turn (${ctx.source}).`);
        return;
      }
      case 'token': {
        for (let i = 0; i < (op.count || 1); i++) {
          const u = this.newUnit(this.tokenCard(op.might, op.deflect), p, { ready: !!op.ready, temporary: !!op.temporary, token: true });
          p.Base.push(u);
        }
        this.note(g, p, `plays ${op.count || 1} ${op.ready ? 'ready ' : ''}${op.might}-Might token(s)${op.temporary ? ' with Temporary' : ''} (${ctx.source}).`);
        return;
      }
      case 'buff': {
        let pool;
        if (op.self && ctx.self) pool = [ctx.self];
        else if (op.where === 'base') pool = p.Base.slice();
        else pool = this.unitsOf(p, g).filter(u => !(op.others && u === ctx.self));
        const targets = pool.filter(u => !u.buffed && !u.dead).sort((a, b) => this.baseMight(b, g) - this.baseMight(a, g)).slice(0, op.count || 1);
        for (const u of targets) {
          u.buffed = true;
          u.bonusMight += 1;
        }
        if (targets.length) this.note(g, p, `buffs ${targets.map(u => u.card.Name).join(', ')} (+1 Might) (${ctx.source}).`);
        return;
      }
      case 'empower': {
        const u = ctx.self;
        if (!u || u.empowered || u.dead) return;
        u.empowered = true;
        u.bonusMight += op.n;
        this.note(g, p, `${u.card.Name} becomes Empowered (+${op.n} Might).`);
        return;
      }
      case 'channel': {
        const n = this.channel(p, op.n, true, g);
        if (n) this.note(g, p, `channels ${n} rune(s) exhausted (${ctx.source}).`);
        return;
      }
      case 'discard': {
        const who = op.who === 'opponent' ? opp : p;
        for (let i = 0; i < op.n && who.Hand.length; i++) {
          const idx = op.who === 'opponent'
            ? Math.floor(this.rng() * who.Hand.length)
            : who.Hand.indexOf(who.Hand.reduce((low, c) => (!low || c.Energy < low.Energy ? c : low), null));
          const [card] = who.Hand.splice(idx, 1);
          who.Trash.push(card);
          this.note(g, who, `discards ${card.Name} (${ctx.source}).`);
        }
        return;
      }
      case 'ready': {
        let u = null;
        if (op.who === 'self') u = ctx.self;
        else u = this.strongest(p.Base.filter(x => x.exhausted && x !== ctx.self), g);
        if (!u || u.dead) return;
        u.exhausted = false;
        this.note(g, p, `readies ${u.card.Name} (${ctx.source}).`);
        return;
      }
      case 'ganking': {
        const u = this.strongest(this.unitsOf(p, g).filter(x => x.at >= 0), g) || this.friendlyTargets(ctx, 1)[0];
        if (!u) return;
        u.tempGanking = true;
        return;
      }
      case 'mill': {
        const milled = p.Library.splice(0, op.n);
        p.Trash.push(...milled);
        if (milled.length) this.note(g, p, `puts the top ${milled.length} card(s) of their deck into the trash (${ctx.source}).`);
        return;
      }
      case 'readyRunesAtEnd':
        p.ReadyRunesAtEnd += op.n;
        return;
      case 'optional': {
        const cost = costFromSpec(op.cost);
        if (!this.canPay(p, cost, g)) return;
        this.pay(p, cost, g);
        this.runOps(op.then, ctx);
        return;
      }
      case 'counter':
      default:
        return;
    }
  }

  // The friendly/enemy pair for "they deal damage equal to their Mights to
  // each other": the biggest enemy at a battlefield one of our units kills
  // and survives.
  bestFight(p, opp, g) {
    let best = null;
    for (const enemy of this.enemiesAtBattlefields(p, g)) {
      const theirs = this.baseMight(enemy, g);
      const friend = this.unitsOf(p, g)
        .filter(u => this.baseMight(u, g) > theirs)
        .reduce((low, u) => (!low || this.baseMight(u, g) < this.baseMight(low, g) ? u : low), null);
      if (friend && (!best || theirs > this.baseMight(best.enemy, g))) best = { friend, enemy };
    }
    return best;
  }

  // --- playing cards ---------------------------------------------------------

  opsOf(card) {
    return (card.Ability && card.Ability.onPlay) || [];
  }

  isQuick(card) {
    const kw = card.Keywords || {};
    return !!(kw.Reaction || kw.Action);
  }

  // Spells whose whole point is a fight (pumps, shields, stuns, counters):
  // the AI keeps them for a combat or the opponent's turn.
  isCombatTrick(card) {
    if (card.Type !== 'Spell') return false;
    const ops = this.opsOf(card).map(o => o.op);
    if (ops.length === 0) return false;
    const trickOps = ['pump', 'assault', 'shield', 'prevent', 'counter', 'stun'];
    const combatOnly = ops.every(o => trickOps.includes(o) || o === 'draw') && ops.some(o => trickOps.includes(o));
    const enemyCombat = ops.includes('damageAll') && this.opsOf(card).some(o => o.scope === 'enemyCombat');
    return combatOnly || enemyCombat;
  }

  targetsEnemies(card) {
    return this.opsOf(card).some(o => ['damage', 'damageMulti', 'kill', 'fight', 'stun', 'weaken', 'removeMight'].includes(o.op) && !o.all);
  }

  // Is this card worth casting in the main phase right now?
  usefulNow(card, p, opp, g) {
    if (card.Type !== 'Spell') return true;
    if (this.isCombatTrick(card)) return false;
    const ops = this.opsOf(card);
    if (ops.length === 0) return true; // untagged: its effect isn't modeled, its cost is
    const enemies = this.enemiesAtBattlefields(p, g);
    for (const o of ops) {
      if (['draw', 'token', 'buff', 'channel', 'discard', 'mill'].includes(o.op)) return true;
      if (o.op === 'weaken' && o.all) return true;
      if (['damage', 'kill', 'weaken', 'damageMulti', 'stun'].includes(o.op) && enemies.length) return true;
      if (o.op === 'removeMight' && this.unitsOf(opp, g).length) return true;
      if (o.op === 'fight' && this.bestFight(p, opp, g)) return true;
      if (o.op === 'damageAll' && o.scope === 'allBattlefields') {
        const mine = this.unitsOf(p, g).filter(u => u.at >= 0 && this.baseMight(u, g) <= o.n).length;
        const theirs = enemies.filter(u => this.baseMight(u, g) <= o.n).length;
        if (theirs > mine) return true;
      }
    }
    return false;
  }

  // The opponent's answer to a spell: their cheapest counterspell that
  // applies, if the spell is worth it (it hits their units, or costs 2+).
  counterWindow(caster, opp, card, g) {
    if (card.Type !== 'Spell') return null;
    const worth = this.targetsEnemies(card) || card.Energy + card.Power >= 2;
    if (!worth || this.opsOf(card).length === 0) return null;
    const options = opp.Hand.filter(c => {
      const counter = this.opsOf(c).find(o => o.op === 'counter');
      if (!counter) return false;
      if (counter.maxEnergy !== undefined && card.Energy > counter.maxEnergy) return false;
      if (counter.maxPower !== undefined && card.Power > counter.maxPower) return false;
      if (counter.onlyIfTargetsFriendly && !this.targetsEnemies(card)) return false;
      if (counter.requiresPriorSpell && caster.SpellsPlayedThisTurn < 1) return false;
      return this.canPay(opp, this.cardCost(c), g);
    }).sort((a, b) => a.Energy - b.Energy);
    if (!options.length) return null;
    const counterCard = options[0];
    this.pay(opp, this.cardCost(counterCard), g);
    opp.Hand.splice(opp.Hand.indexOf(counterCard), 1);
    opp.Trash.push(counterCard);
    if (opp.Label === 'You') opp.PlayLog.push(counterCard.Name);
    const returnToHand = this.opsOf(counterCard).some(o => o.op === 'counter' && o.returnToHand);
    this.note(g, opp, `counters ${card.Name} with ${counterCard.Name}.`);
    return { returnToHand };
  }

  // Plays a card from hand: pays, then (spells) gives the opponent a chance
  // to counter, then resolves it. `ctx` carries the combat for reactions.
  playCard(card, p, opp, g, { accelerate = false, combat = null, at = -1, targetBf = -1 } = {}) {
    this.pay(p, this.cardCost(card, accelerate), g);
    p.Hand.splice(p.Hand.indexOf(card), 1);
    p.PlayLog.push(card.Name);
    p.CardsPlayedThisTurn++;
    const ctx = { p, opp, g, combat, targetBf, source: card.Name };

    if (card.Type === 'Spell') {
      this.note(g, p, `casts ${card.Name}${combat ? ' in the fight' : ''}.`);
      const countered = this.counterWindow(p, opp, card, g);
      p.SpellsPlayedThisTurn++;
      if (countered) {
        if (countered.returnToHand) p.Hand.push(card);
        else p.Trash.push(card);
      } else {
        this.runOps(this.opsOf(card), ctx);
        p.Trash.push(card);
      }
    } else if (card.Type === 'Gear') {
      const gear = { card: { ...card, ShieldTag: (parseTag(card.Tag) || {}).name === 'Shield' && !card.Ability ? parseTag(card.Tag).value : 0 }, holder: null, exhausted: false };
      p.Gear.push(gear);
      this.note(g, p, `plays ${card.Name}.`);
      this.attachLooseGear(p, opp, g);
      this.runOps(this.opsOf(card), ctx);
    } else {
      const unit = this.newUnit(card, p, { ready: accelerate });
      if (at >= 0) {
        unit.at = at;
        g.battlefields[at].units.push(unit);
        if (combat) combat.defenders.push(unit);
      } else {
        this.deployUnit(unit, p, opp, g);
      }
      this.note(g, p, `plays ${card.Name}${accelerate ? ' (accelerated, ready)' : ''} ${unit.at >= 0 ? `to ${this.bfName(g, unit.at)}` : 'to base'}.`);
      this.attachLooseGear(p, opp, g);
      this.runOps(this.opsOf(card), { ...ctx, self: unit });
      for (const other of this.unitsOf(p, g)) {
        if (other !== unit && other.ability && other.ability.onFriendlyUnitPlayed) this.runOps(other.ability.onFriendlyUnitPlayed, { ...ctx, self: other, source: other.card.Name });
      }
      if (p.Legend.ability && p.Legend.ability.onFriendlyUnitPlayed) {
        this.runOps(p.Legend.ability.onFriendlyUnitPlayed, { ...ctx, combat: null, source: p.Legend.name, playedUnit: unit });
      }
    }

    if (p.CardsPlayedThisTurn === 2) {
      for (const u of this.unitsOf(p, g)) {
        if (u.ability && u.ability.onSecondCard) this.runOps(u.ability.onSecondCard, { ...ctx, self: u, source: u.card.Name });
      }
    }
  }

  // Units are played exhausted: to a battlefield this player controls that
  // the opponent could take next turn, otherwise to base.
  deployUnit(unit, player, opponent, g) {
    const b = this.battlefieldToReinforce(player, opponent, g);
    if (b >= 0) {
      unit.at = b;
      g.battlefields[b].units.push(unit);
    } else {
      player.Base.push(unit);
    }
  }

  // What the opponent could throw at a battlefield next turn: every unit in
  // their base readies and can move (plus Ganking units elsewhere).
  attackPotential(player, g) {
    return sumBy(player.Base, u => this.baseMight(u, g) + u.assault)
      + sumBy(this.unitsOf(player, g).filter(u => u.at >= 0 && u.ganking), u => this.baseMight(u, g) + u.assault);
  }

  defenseEstimate(g, b, player) {
    return sumBy(this.unitsAt(g, b, player), u => this.baseMight(u, g) + u.shield + u.tempShield);
  }

  battlefieldToReinforce(player, opponent, g) {
    const threat = this.attackPotential(opponent, g);
    let pick = -1;
    let lowest = Infinity;
    g.battlefields.forEach((bf, b) => {
      if (bf.controller !== player) return;
      const def = this.defenseEstimate(g, b, player);
      if (def <= threat && def < lowest) { lowest = def; pick = b; }
    });
    return pick;
  }

  // Energy to keep back for the opponent's turn: the cheapest trick or
  // ambusher in hand, when there's a held battlefield to protect.
  reactionReserve(p, g) {
    if (!g.battlefields.some(bf => bf.controller === p)) return 0;
    const held = p.Hand.filter(c => (c.Type === 'Spell' && this.isCombatTrick(c) && this.isQuick(c))
      || (c.Type === 'Unit' && c.Keywords && (c.Keywords.Ambush || c.Keywords.Reaction)));
    if (!held.length) return 0;
    return Math.min(...held.map(c => c.Energy));
  }

  firstAttackTarget(p, opp, g) {
    let pick = -1;
    let lowest = Infinity;
    g.battlefields.forEach((bf, b) => {
      if (bf.controller === p || !this.unitsAt(g, b, opp).length) return;
      const def = this.defenseEstimate(g, b, opp);
      if (def < lowest) { lowest = def; pick = b; }
    });
    return pick;
  }

  // Main phase: play the most expensive useful card that's affordable (and
  // leaves the reaction reserve), again and again; then Legend/gear
  // abilities, attacks, and guarding a threatened battlefield.
  actionPhase(p, opp, g) {
    const available = this.energySources(p, g);
    p.EnergySpentThisTurn = 0;
    this.attachLooseGear(p, opp, g);

    for (let safety = 0; safety < 30 && !g.winner; safety++) {
      const reserve = this.reactionReserve(p, g);
      const targetBf = this.firstAttackTarget(p, opp, g);
      let best = null;
      for (const card of p.Hand) {
        if (!this.usefulNow(card, p, opp, g)) continue;
        const isHeldReaction = (card.Type === 'Unit' && card.Keywords && (card.Keywords.Ambush || card.Keywords.Reaction) && reserve > 0 && card.Energy === reserve);
        if (isHeldReaction) continue;
        const cost = this.cardCost(card);
        if (!this.canPay(p, cost, g)) continue;
        if (this.energySources(p, g) - cost.energy < reserve && card.Energy > 0) continue;
        if (!best || card.Energy + card.Power > best.Energy + best.Power) best = card;
      }
      if (!best) break;
      const wantsAccelerate = best.Type === 'Unit' && best.Keywords && best.Keywords.Accelerate
        && best.Might > 0 && g.battlefields.some(bf => bf.controller !== p)
        && this.canPay(p, this.cardCost(best, true), g);
      this.playCard(best, p, opp, g, { accelerate: wantsAccelerate, targetBf });
    }
    if (g.winner) return;

    this.activateLegend(p, opp, g);
    if (!g.winner) this.attackStep(p, opp, g);
    if (!g.winner) this.reinforce(p, opp, g);

    if (p.TurnsTaken <= EARLY_TURNS) {
      p.EarlyEnergySeen += available;
      p.EarlyEnergySpent += Math.min(available, p.EnergySpentThisTurn);
    }
  }

  // Legend "{exhaust}: ..." abilities used on your own turn (e.g. Lillia's
  // Sprite), when affordable.
  activateLegend(p, opp, g) {
    const act = p.Legend.ability && p.Legend.ability.activate;
    if (!act || p.Legend.exhausted) return;
    let energy = (act.cost && act.cost.energy) || 0;
    if (act.discountPerTemporary) energy = Math.max(0, energy - act.discountPerTemporary * this.unitsOf(p, g).filter(u => u.temporary).length);
    const cost = { energy, symbols: [] };
    if (!this.canPay(p, cost, g)) return;
    this.pay(p, cost, g);
    p.Legend.exhausted = true;
    this.note(g, p, `uses ${p.Legend.name}.`);
    this.runOps(act.ops, { p, opp, g, source: p.Legend.name });
  }

  // Gear "{exhaust}: give a unit +N this turn" (e.g. Heart of Dark Ice), used
  // on an attacker.
  activateGearOn(p, opp, g, unit) {
    for (const gear of p.Gear) {
      const act = gear.card.Ability && gear.card.Ability.activate;
      if (!act || gear.exhausted) continue;
      gear.exhausted = true;
      this.note(g, p, `uses ${gear.card.Name}.`);
      this.runOps(act.ops, { p, opp, g, self: unit, combat: null, source: gear.card.Name });
    }
  }

  // The smallest single ready unit that beats `defense`, else the strongest
  // ones stacked until they do; null when even all of them aren't enough.
  pickAttackers(ready, defense, g) {
    const atk = u => this.baseMight(u, g) + u.assault + u.tempAssault;
    const single = ready.filter(u => atk(u) > defense).reduce((best, u) => (!best || atk(u) < atk(best) ? u : best), null);
    if (single) return [single];
    const force = [];
    let total = 0;
    for (const u of ready.slice().sort((a, b) => atk(b) - atk(a))) {
      force.push(u);
      total += atk(u);
      if (total > defense) return force;
    }
    return null;
  }

  // Pump available from hand for an attack this turn (tricks it can afford).
  trickPotential(p, g) {
    let energy = this.energySources(p, g);
    let total = 0;
    for (const c of p.Hand.filter(x => x.Type === 'Spell' && this.isQuick(x)).sort((a, b) => a.Energy - b.Energy)) {
      if (c.Energy > energy) continue;
      for (const o of this.opsOf(c)) if (o.op === 'pump' || o.op === 'assault') { total += o.n * (o.count || 1); energy -= c.Energy; break; }
    }
    if (p.Gear.some(x => !x.exhausted && x.card.Ability && x.card.Ability.activate)) total += 3;
    return total;
  }

  // Attack every battlefield this player doesn't control that its ready
  // units (plus affordable tricks) can take, easiest first.
  attackStep(p, opp, g) {
    const targets = g.battlefields
      .map((bf, b) => b)
      .filter(b => g.battlefields[b].controller !== p)
      .sort((x, y) => this.defenseEstimate(g, x, opp) - this.defenseEstimate(g, y, opp));
    for (const b of targets) {
      if (g.winner) return;
      const ready = p.Base.filter(u => !u.exhausted)
        .concat(this.unitsOf(p, g).filter(u => u.at >= 0 && u.at !== b && !u.exhausted && (u.ganking || u.tempGanking)));
      if (ready.length === 0) return;
      const defense = this.defenseEstimate(g, b, opp);
      let force = this.pickAttackers(ready, defense, g);
      if (!force && defense > 0) {
        const all = sumBy(ready, u => this.baseMight(u, g) + u.assault + u.tempAssault);
        if (all + this.trickPotential(p, g) > defense) force = ready;
      }
      if (!force) continue;
      if (defense > 0) this.activateGearOn(p, opp, g, this.strongest(force, g));
      this.resolveAttack(p, opp, g, b, force);
    }
  }

  // Leftover ready units guard a held battlefield the opponent could take.
  reinforce(p, opp, g) {
    const b = this.battlefieldToReinforce(p, opp, g);
    if (b < 0) return;
    const ready = p.Base.filter(u => !u.exhausted);
    if (!ready.length) return;
    for (const u of ready) {
      u.exhausted = true;
      p.Base.splice(p.Base.indexOf(u), 1);
      u.at = b;
      g.battlefields[b].units.push(u);
    }
    this.note(g, p, `moves ${ready.map(u => u.card.Name).join(', ')} to guard ${this.bfName(g, b)}.`);
  }

  // Where a fight stands right now: does the attack wipe the defenders, do
  // the attackers survive?
  forecast(g, combat) {
    const atk = combat.attackers.filter(u => !u.dead);
    const def = combat.defenders.filter(u => !u.dead);
    const attackDamage = sumBy(atk, u => this.combatDamage(u, 'attack', g, combat));
    const defenseDamage = sumBy(def, u => this.combatDamage(u, 'defend', g, combat));
    const attackHealth = sumBy(atk, u => Math.max(0, this.combatHealth(u, 'attack', g, combat)));
    const defenseHealth = sumBy(def, u => Math.max(0, this.combatHealth(u, 'defend', g, combat)));
    const defendersWiped = attackDamage >= defenseHealth;
    const attackersWiped = defenseDamage >= attackHealth;
    return { attackerWins: atk.length > 0 && defendersWiped && !attackersWiped, defenderHolds: def.length > 0 && !defendersWiped };
  }

  // Rough value of a trick for this side in this fight (0 = no help).
  trickValue(card, side, g, combat) {
    const attacking = combat.attacker === side;
    const enemies = (attacking ? combat.defenders : combat.attackers).filter(u => !u.dead);
    const friends = (attacking ? combat.attackers : combat.defenders).filter(u => !u.dead);
    if (card.Type === 'Unit') return attacking ? 0 : card.Might + ((card.Keywords && card.Keywords.Shield) || 0);
    let value = 0;
    for (const o of this.opsOf(card)) {
      if (o.op === 'pump' && friends.length) value += o.n * Math.min(o.count || 1, friends.length) * (o.perEnemyHere ? enemies.length : 1);
      if (o.op === 'assault' && attacking && friends.length) value += o.n;
      if ((o.op === 'shield' || o.op === 'prevent') && !attacking && friends.length) value += o.n;
      if (o.op === 'stun' && enemies.length && (!o.attackerOnly || !attacking)) value += Math.max(...enemies.map(u => this.baseMight(u, g)));
      if ((o.op === 'damage' || o.op === 'kill' || o.op === 'weaken') && enemies.length) value += Math.min(o.n || 99, Math.max(...enemies.map(u => this.baseMight(u, g))));
      if (o.op === 'damageAll' && o.scope === 'enemyCombat') value += o.n * enemies.length;
      if (o.op === 'removeMight' && enemies.length) value += o.n;
    }
    return value;
  }

  // A side's reactions in a fight: while it's losing, play the affordable
  // trick (or [Ambush]/[Reaction] unit, for the defender) worth the most.
  react(side, other, g, combat) {
    for (let i = 0; i < 3 && !g.winner; i++) {
      const f = this.forecast(g, combat);
      const winning = combat.attacker === side ? f.attackerWins : !f.attackerWins;
      if (winning) return;
      let best = null;
      let bestValue = 0;
      for (const card of side.Hand) {
        const quickSpell = card.Type === 'Spell' && this.isQuick(card);
        const ambusher = card.Type === 'Unit' && combat.defender === side && card.Keywords && (card.Keywords.Ambush || card.Keywords.Reaction);
        if (!quickSpell && !ambusher) continue;
        if (!this.canPay(side, this.cardCost(card), g)) continue;
        const value = this.trickValue(card, side, g, combat);
        if (value > bestValue) { best = card; bestValue = value; }
      }
      if (!best) return;
      if (best.Type === 'Unit') this.playCard(best, side, other, g, { combat, at: combat.b });
      else this.playCard(best, side, other, g, { combat });
    }
  }

  // Combat damage: each side deals its total; the receiving units die in
  // order - [Tank] first, then the weakest (to kill the most), [Backline]
  // last.
  assignCombatDamage(units, damage, role, g, combat) {
    const order = units.filter(u => !u.dead).sort((a, b) => {
      const rank = u => (this.isTank(u) ? 0 : (u.backline ? 2 : 1));
      return rank(a) - rank(b) || this.combatHealth(a, role, g, combat) - this.combatHealth(b, role, g, combat);
    });
    const dead = [];
    let remaining = damage;
    for (const u of order) {
      const h = Math.max(0, this.combatHealth(u, role, g, combat));
      if (remaining <= 0 || h > remaining) break;
      remaining -= h;
      dead.push(u);
    }
    return dead;
  }

  resolveAttack(p, opp, g, b, force) {
    const bf = g.battlefields[b];
    for (const u of force) {
      this.removeFromLocation(u, g);
      u.exhausted = true;
      u.at = b;
      bf.units.push(u);
    }
    const defenders = this.unitsAt(g, b, opp);
    this.note(g, p, `attacks ${this.bfName(g, b)} with ${force.map(u => u.card.Name).join(', ')}${defenders.length ? ` against ${defenders.map(u => u.card.Name).join(', ')}` : ' (undefended)'}.`);
    if (defenders.length === 0) {
      this.conquer(p, opp, g, b);
      return;
    }

    const combat = { b, attacker: p, defender: opp, attackers: force.slice(), defenders: defenders.slice() };
    const bfAb = bf.card && bf.card.Ability;
    if (bfAb && bfAb.onDefend) this.runOps(bfAb.onDefend, { p: opp, opp: p, g, combat, b, source: this.bfName(g, b) });
    for (const u of force) {
      if (u.ability && u.ability.onAttack) this.runOps(u.ability.onAttack, { p, opp, g, combat, self: u, b, source: u.card.Name });
    }
    this.react(opp, p, g, combat);
    this.react(p, opp, g, combat);
    if (g.winner) return;

    // Units killed by tricks (marked damage) before the damage step.
    for (const u of combat.attackers.concat(combat.defenders)) {
      const role = combat.attackers.includes(u) ? 'attack' : 'defend';
      if (!u.dead && u.damage > 0 && this.combatHealth(u, role, g, combat) <= 0) this.killUnit(u, g, 'damage');
    }
    const attackDamage = sumBy(combat.attackers.filter(u => !u.dead), u => this.combatDamage(u, 'attack', g, combat));
    const defenseDamage = sumBy(combat.defenders.filter(u => !u.dead), u => this.combatDamage(u, 'defend', g, combat));
    const deadDefenders = this.assignCombatDamage(combat.defenders, attackDamage, 'defend', g, combat);
    const deadAttackers = this.assignCombatDamage(combat.attackers, defenseDamage, 'attack', g, combat);
    for (const u of deadDefenders.concat(deadAttackers)) this.killUnit(u, g, 'combat');

    const attackersLeft = combat.attackers.filter(u => !u.dead);
    const defendersLeft = combat.defenders.filter(u => !u.dead);
    if (attackersLeft.length && !defendersLeft.length) {
      this.note(g, p, `wins the fight at ${this.bfName(g, b)}.`);
      this.combatWon(p, opp, g, attackersLeft);
      this.conquer(p, opp, g, b);
    } else {
      if (attackersLeft.length) {
        for (const u of attackersLeft) {
          this.removeFromLocation(u, g);
          u.at = -1;
          p.Base.push(u);
        }
        this.note(g, p, `is held off at ${this.bfName(g, b)} - surviving attackers go back to base.`);
      } else if (defendersLeft.length) {
        this.note(g, opp, `holds ${this.bfName(g, b)}.`);
        this.combatWon(opp, p, g, defendersLeft);
      } else {
        this.note(g, null, `Both sides are wiped out at ${this.bfName(g, b)}.`);
      }
      this.updateControl(g, b);
    }
    for (const u of attackersLeft.concat(defendersLeft)) {
      if (!u.dead && u.ability && u.ability.onCombatEnd) {
        this.runOps(u.ability.onCombatEnd, { p: u.owner, opp: g.players.find(x => x !== u.owner), g, self: u, source: u.card.Name });
      }
    }
  }

  combatWon(winner, loser, g, survivors) {
    for (const u of survivors) {
      if (u.ability && u.ability.onWinCombat) this.runOps(u.ability.onWinCombat, { p: winner, opp: loser, g, self: u, source: u.card.Name });
    }
    const leg = winner.Legend.ability;
    if (leg && leg.onWinCombat) this.runOps(leg.onWinCombat, { p: winner, opp: loser, g, source: winner.Legend.name });
  }

  takeTurn(p, opp, g) {
    g.scoredThisTurn = new Set();
    p.TurnsTaken++;
    p.CardsPlayedThisTurn = 0;
    p.SpellsPlayedThisTurn = 0;
    opp.CardsPlayedThisTurn = 0;
    opp.SpellsPlayedThisTurn = 0;
    this.note(g, p, `--- turn ${p.TurnsTaken} (score ${p.Score}-${opp.Score}) ---`);

    // Awaken: ready everything.
    for (const u of this.unitsOf(p, g)) u.exhausted = false;
    for (const r of p.Runes) r.exhausted = false;
    for (const x of p.Gear) x.exhausted = false;
    p.Legend.exhausted = false;

    // Beginning: start-of-turn effects, Temporary dies, then Hold.
    g.battlefields.forEach((bf, b) => {
      const ab = bf.card && bf.card.Ability;
      if (ab && ab.startOfBeginning) this.runOps(ab.startOfBeginning, { p, opp, g, b, source: this.bfName(g, b) });
    });
    for (const u of this.unitsOf(p, g).filter(x => x.temporary)) this.killUnit(u, g, 'Temporary');
    for (const gear of p.Gear.filter(x => x.card.Keywords && x.card.Keywords.Temporary)) {
      p.Gear.splice(p.Gear.indexOf(gear), 1);
      p.Trash.push(gear.card);
      this.note(g, p, `loses ${gear.card.Name} (Temporary).`);
      if (gear.card.Ability && gear.card.Ability.onDeath) this.runOps(gear.card.Ability.onDeath, { p, opp, g, source: gear.card.Name });
    }
    g.battlefields.forEach((bf, b) => {
      if (g.winner || bf.controller !== p) return;
      this.scoreBattlefield(p, opp, g, b, 'hold');
      if (g.winner) return;
      const ab = bf.card && bf.card.Ability;
      if (ab && ab.onHold) this.runOps(ab.onHold, { p, opp, g, b, source: this.bfName(g, b) });
      for (const u of this.unitsAt(g, b, p)) {
        if (u.ability && u.ability.onHold) this.runOps(u.ability.onHold, { p, opp, g, b, self: u, source: u.card.Name });
      }
      if (p.Legend.ability && p.Legend.ability.onHold) this.runOps(p.Legend.ability.onHold, { p, opp, g, b, source: p.Legend.name });
    });
    if (g.winner) return;

    // Channel, then draw.
    const extraRune = p === g.second && p.TurnsTaken === 1 ? 1 : 0;
    const channeled = this.channel(p, RUNES_PER_TURN + extraRune, false, g);
    this.note(g, p, `channels ${channeled} rune(s) (${p.Runes.length} on the board).`);
    this.drawCards(p, opp, g, 1);
    if (g.winner) return;

    this.actionPhase(p, opp, g);

    const might = sumBy(this.unitsOf(p, g), u => this.baseMight(u, g));
    if (might > p.PeakBoardMight) p.PeakBoardMight = might;

    // End of turn: damage heals, "this turn" effects end.
    for (const u of this.unitsOf(p, g).concat(this.unitsOf(opp, g))) {
      u.tempMight = 0;
      u.tempAssault = 0;
      u.tempShield = 0;
      u.tempTank = false;
      u.tempGanking = false;
      u.weaken = 0;
      u.stunned = false;
      u.prevent = 0;
      u.damage = 0;
    }
    for (const r of p.Runes) {
      if (p.ReadyRunesAtEnd <= 0) break;
      if (r.exhausted) { r.exhausted = false; p.ReadyRunesAtEnd--; }
    }
    p.ReadyRunesAtEnd = 0;
  }

  getLossReason(loser, winner) {
    const pointGap = winner.Score - loser.Score;
    // Only the early turns: later on, runes outpace any hand, so unspent
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

  // Each player brings one of their battlefields; `used` (best-of-3) holds
  // the ones a player already played this match.
  pickBattlefield(deck, used) {
    const options = deck.Battlefields.filter(bf => !(used || []).includes(bf.Name));
    const pool = options.length ? options : deck.Battlefields;
    if (!pool.length) return null;
    return pool[Math.floor(this.rng() * pool.length)];
  }

  // `opts.usedA/usedB`: battlefields already played this match. Games are
  // numbered from the start of each run (this.gameCounter); the one matching
  // this.replay.index records its turn-by-turn events into this.replay.log.
  singleGame(deckA, deckB, opts = {}) {
    const index = this.gameCounter++;
    const log = this.replay && this.replay.index === index ? this.replay.log : null;
    const playerA = this.newPlayerState(deckA, 'You');
    const playerB = this.newPlayerState(deckB, 'Opponent');
    const bfA = this.pickBattlefield(deckA, opts.usedA);
    const bfB = this.pickBattlefield(deckB, opts.usedB);
    const g = {
      players: [playerA, playerB],
      battlefields: [
        { card: bfA, owner: playerA, controller: null, units: [] },
        { card: bfB, owner: playerB, controller: null, units: [] },
      ].slice(0, BATTLEFIELD_COUNT),
      scoredThisTurn: new Set(),
      second: null,
      winner: null,
      round: 0,
      log,
    };

    const [first, second] = this.rng() < 0.5 ? [playerA, playerB] : [playerB, playerA];
    g.second = second;
    this.note(g, null, `Battlefields: ${g.battlefields.map((bf, b) => `${this.bfName(g, b)} (${bf.owner.Label})`).join(' and ')}. ${first.Label === 'You' ? 'You go' : 'The opponent goes'} first.`);
    this.openingHand(playerA, g);
    this.openingHand(playerB, g);

    while (!g.winner && g.round < MAX_ROUNDS) {
      g.round++;
      this.takeTurn(first, second, g);
      if (!g.winner) this.takeTurn(second, first, g);
    }
    if (g.winner) this.note(g, g.winner, `wins ${g.winner.Score}-${g.players.find(x => x !== g.winner).Score}.`);
    else this.note(g, null, `No winner after ${MAX_ROUNDS} rounds - a draw.`);

    const result = {
      Winner: g.winner ? g.winner.Label : 'Draw',
      ScoreA: playerA.Score,
      ScoreB: playerB.Score,
      PlayLogA: playerA.PlayLog,
      Rounds: g.round,
      WentFirst: first.Label,
      BattlefieldA: bfA ? bfA.Name : null,
      BattlefieldB: bfB ? bfB.Name : null,
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
  //  Callers start each run with startRun(seed), so a seed replays the exact
  //  same batch - which is also how a single game is replayed with its
  //  turn-by-turn events (replayGame).
  // --------------------------------------------------------------------
  startRun(seed, replay = null) {
    this.rng = makeRng(seed);
    this.gameCounter = 0;
    this.replay = replay;
  }

  // While replaying, everything after the replayed game can be skipped.
  replayDone() {
    return !!this.replay && this.gameCounter > this.replay.index;
  }

  gameBatch(deckA, deckB, gameCount) {
    const results = [];
    for (let g = 0; g < gameCount && !this.replayDone(); g++) results.push(this.singleGame(deckA, deckB));
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
  // drawing stops after 3x bestOf games and counts as a draw. Neither player
  // brings the same battlefield twice in a match.
  matchOf(deckA, deckB, bestOf = 3) {
    const gamesToWin = Math.ceil(bestOf / 2.0);
    const games = [];
    const usedA = [];
    const usedB = [];
    let winsA = 0, winsB = 0;
    while (winsA < gamesToWin && winsB < gamesToWin && games.length < bestOf * 3 && !this.replayDone()) {
      const index = this.gameCounter;
      const g = this.singleGame(deckA, deckB, { usedA, usedB });
      g.Index = index;
      games.push(g);
      if (g.BattlefieldA) usedA.push(g.BattlefieldA);
      if (g.BattlefieldB) usedB.push(g.BattlefieldB);
      if (g.Winner === 'You') winsA++;
      else if (g.Winner === 'Opponent') winsB++;
    }
    const winner = winsA >= gamesToWin ? 'You' : (winsB >= gamesToWin ? 'Opponent' : 'Draw');
    return { Winner: winner, GamesWonA: winsA, GamesWonB: winsB, BestOf: bestOf, Games: games };
  }

  matchBatch(deckA, deckB, matchCount, bestOf = 3) {
    const matches = [];
    for (let i = 0; i < matchCount && !this.replayDone(); i++) matches.push(this.matchOf(deckA, deckB, bestOf));
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
      this.startRun(seed);
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
    this.startRun(usedSeed);
    const batch = this.gameBatch(myDeck, opponentDeck, games);

    const gameRows = batch.Results.map((r, i) => ({
      n: i + 1,
      index: i,
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
    this.startRun(usedSeed);
    const matchBatch = this.matchBatch(myDeck, opponentDeck, matches, bestOf);

    const matchRows = [];
    const allGames = [];
    matchBatch.Matches.forEach((m, i) => {
      matchRows.push({
        n: i + 1,
        win: m.Winner === 'You',
        draw: m.Winner === 'Draw',
        gamesWonA: m.GamesWonA,
        gamesWonB: m.GamesWonB,
        games: m.Games.map(g => ({ index: g.Index, win: g.Winner === 'You', draw: g.Winner === 'Draw', scoreA: g.ScoreA, scoreB: g.ScoreB })),
      });
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

  // Replays one game of an earlier run (same decks, mode, size and seed;
  // `gameIndex` counts games from 0 in the order they were played) and
  // returns its turn-by-turn events: [{ round, who, text }].
  async replayGame(myDeckId, opponentDeckId, { mode = 'single', seed, gameIndex, games = RUN_SIZES.single, matches = RUN_SIZES.match, bestOf = 3 } = {}) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const opponentDeck = await this.getResolvedDeck(opponentDeckId);
    const events = [];
    this.startRun(normalizeSeed(seed), { index: gameIndex, log: events });
    try {
      if (mode === 'match') this.matchBatch(myDeck, opponentDeck, matches, bestOf);
      else this.gameBatch(myDeck, opponentDeck, games);
    } finally {
      this.replay = null;
    }
    return { events, myDeckName: myDeck.Name, opponentDeckName: opponentDeck.Name };
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

  // What the app shows about a card: its official image, keywords and what
  // the simulator models of it ('text' = curated from the official text,
  // 'partial' = only part of it, 'tag' = the deck row's Tag, 'none').
  cardInfo(cardName, tag = '') {
    const rec = this.cardDatabase.get((cardName || '').toLowerCase()) || this.cardDatabase.get(normalizeCardName(cardName));
    if (!rec) return null;
    const tagAbility = rec.Ability ? null : abilityFromTag(tag, rec.Type, {});
    let modeled = 'none';
    if (rec.Ability) modeled = rec.AbilityPartial ? 'partial' : 'text';
    else if (parseTag(tag)) modeled = 'tag';
    return {
      name: rec.Name,
      type: rec.Type,
      code: rec.Code,
      imageUrl: cardImageUrl(rec.Code),
      keywords: describeKeywords(rec.Keywords),
      modeled,
      abilityText: describeAbility(rec.Ability || tagAbility, rec.Type),
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
      const rec = this.cardDatabase.get(name.toLowerCase());
      if (rec && rec.Ability && parseTag(r.Tag)) problems.push(`'${name}': its card text is already modeled, so its Tag '${r.Tag}' is ignored.`);
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
