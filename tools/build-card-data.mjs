#!/usr/bin/env node
/*
  build-card-data.mjs - refreshes the mechanical card data in
  docs/carddatabase.json from Riot's official card gallery.

  Usage:
    node tools/build-card-data.mjs                 (downloads the gallery)
    node tools/build-card-data.mjs gallery.json    (uses a saved copy of the
                                                    gallery's Next.js data)

  Cards of a new set are added with their stats from the gallery (type,
  energy, power, might, domains, tags, token or not). For every card it
  writes:
  - code       the base print's collector code (e.g. "UNL-024"), used by the
               app to show the official card image (which carries the text)
  - supertype  "Champion", "Signature" or "Token" when the card has one
  - keywords   keywords printed as their own line on the card, e.g.
               { "Assault": 2, "Ganking": true, "Accelerate": { cost } }
  - vanilla    true when the card has no rules text beyond those keywords
               (and [Equip]), so the engine plays all of it
  - equip      the [Equip] cost of Equipment
  - official   the gallery's name, when this database spells it differently
  - ability    the hand-curated, structured ability from
               tools/card-abilities.json, if that card's official text still
               matches the fingerprint recorded there

  The rules text itself is NOT copied into the repo - only the mechanics the
  engine uses. Existing stats (type/energy/power/might/domains) are kept.
  A gallery card without a card type yet (a preview Riot hasn't finished)
  is left out until it has one.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = path.join(ROOT, 'docs', 'carddatabase.json');
const ABILITIES_PATH = path.join(ROOT, 'tools', 'card-abilities.json');
const GALLERY_URL = 'https://riftbound.leagueoflegends.com/en-us/card-gallery/';

async function loadGallery(localPath) {
  if (localPath) return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  const html = await (await fetch(GALLERY_URL)).text();
  const buildId = (html.match(/"buildId":"([^"]+)"/) || [])[1];
  if (!buildId) throw new Error('Could not find the gallery buildId.');
  const url = `https://riftbound.leagueoflegends.com/_next/data/${buildId}/en-us/card-gallery.json`;
  return (await fetch(url)).json();
}

// The card array's path moves between site builds: take the largest array
// of objects that look like cards.
function findCards(data) {
  let best = null;
  (function walk(node) {
    if (Array.isArray(node)) {
      if (node.length && node[0] && typeof node[0] === 'object' && 'name' in node[0] && 'publicCode' in node[0]) {
        if (!best || node.length > best.length) best = node;
      }
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  })(data);
  if (!best) throw new Error('No card array found in the gallery data.');
  return best;
}

const DOMAIN_BY_ICON = { fury: 'Fury', calm: 'Calm', mind: 'Mind', body: 'Body', chaos: 'Chaos', order: 'Order', rainbow: 'Any' };

function textLines(card) {
  const html = [card.text?.richText?.body, card.effect?.richText?.body].filter(Boolean).join('<br />');
  return html
    .replace(/<\/p>\s*<p>/g, '<br />')
    .split(/<br\s*\/?>/)
    .map(l => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').trim())
    .filter(Boolean);
}

function fingerprint(card) {
  const text = textLines(card).join(' ').toLowerCase().replace(/\s+/g, ' ');
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// "{energy_1}{rune_chaos}" -> { energy: 1, power: { Chaos: 1 } }
function parseCost(s) {
  const cost = { energy: 0, power: {} };
  for (const m of (s || '').matchAll(/:rb_energy_(\d+):/g)) cost.energy += parseInt(m[1], 10);
  for (const m of (s || '').matchAll(/:rb_rune_([a-z]+):/g)) {
    const d = DOMAIN_BY_ICON[m[1]] || m[1];
    cost.power[d] = (cost.power[d] || 0) + 1;
  }
  return cost;
}

// Keywords printed on a line of their own ("[Assault 2]", "[Tank]", ...).
// Keywords inside conditions ("[Empowered][>] I have [Deflect]") or used as
// an ability's speed ("[Action][>] {exhaust}: ...") don't count.
const KEYWORD_LINE = /^(\[[A-Za-z][A-Za-z -]*?(?: \d+)?\]\s*)+$/;

function parseKeywords(card, domains) {
  const keywords = {};
  for (const raw of textLines(card)) {
    const reminderFree = raw.replace(/\([^)]*\)/g, '').trim();
    if (!KEYWORD_LINE.test(reminderFree)) continue;
    for (const m of reminderFree.matchAll(/\[([A-Za-z][A-Za-z -]*?)(?: (\d+))?\]/g)) {
      const name = m[1];
      if (name === 'Accelerate') {
        const reminder = (raw.match(/\(([^)]*)\)/) || [])[1];
        const cost = parseCost(reminder);
        if (!reminder || (cost.energy === 0 && Object.keys(cost.power).length === 0)) {
          keywords.Accelerate = { energy: 1, power: { [domains[0] || 'Any']: 1 } };
        } else {
          keywords.Accelerate = cost;
        }
      } else if (['Assault', 'Shield', 'Deflect', 'Hunt'].includes(name)) {
        keywords[name] = m[2] ? parseInt(m[2], 10) : 1;
      } else {
        keywords[name] = m[2] ? parseInt(m[2], 10) : true;
      }
    }
  }
  return keywords;
}

// No rules text beyond keyword lines and a plain [Equip] cost (energy or
// rune icons, e.g. ":rb_energy_1:" or ":rb_rune_order:"). A gear's keyword
// lines ([Ganking], [Tank], [Quick-Draw]...) are for the unit carrying it,
// which the engine doesn't hand over, so a gear with one isn't vanilla.
function isVanilla(card) {
  const gear = typeOf(card) === 'Gear';
  return textLines(card).every(raw => {
    const line = raw.replace(/\([^)]*\)/g, '').trim();
    if (!line || /^\[Equip\]\s*(?:—\s*)?(?::rb_[a-z]+(?:_[a-z0-9]+)?:\s*)+$/.test(line)) return true;
    return !gear && KEYWORD_LINE.test(line);
  });
}

// "[Equip] — {rune_chaos}, Recycle 2 cards..." / "[Equip] {energy_1}"
function parseEquip(card) {
  for (const line of textLines(card)) {
    const m = line.match(/^\[Equip\]\s*(?:—\s*)?([^(]*)/);
    if (m) return parseCost(m[1].split(',')[0]);
  }
  return null;
}

// The base print: no variant suffix ("UNL-024/219", not "UNL-024a") and not
// an overnumbered showcase print ("VEN-197/166").
function basePrint(prints) {
  const isBase = c => {
    const m = /^[A-Z]+-(\d+)\/(\d+)$/.exec(c.publicCode || '');
    return m && parseInt(m[1], 10) <= parseInt(m[2], 10);
  };
  return prints.find(isBase) || prints.find(c => /^[A-Z]+-\d+\/\d+$/.test(c.publicCode)) || prints[0];
}

function cardKey(name) {
  return name.toLowerCase().replace(/’/g, "'");
}

// Name variants between our database and the gallery, beyond the plain
// "Name, Subtitle" form: Legends are "Champion, Title" here but titled with
// the champion in tags there; signature spells carry the champion as a
// subtitle there; a few spellings differ.
const NAME_FIXES = { 'sky cruiser': 'sky crusier', 'yi, honed': 'master yi, honed', 'yi, meditative': 'master yi, meditative' };

// Entries an older import got wrong, dropped once the real card is in.
const BROKEN_NAMES = { 'B': 'B.F. Sword', 'Corina Veraza': 'Corinna Veraza', 'Dr': 'Dr. Mundo, Expert' };

const typeOf = c => (c.cardType?.type || [])[0]?.label || '';
const supertypeOf = c => (c.cardType?.superType || []).map(t => t.label).find(l => ['Champion', 'Signature', 'Token'].includes(l)) || null;
const tagsOf = c => c.tags?.tags || [];

// The name this database uses for a gallery card: "Champion, Title" for a
// Legend (the champion is the tag that names a champion unit, e.g. "Ziggs"
// rather than "Yordle"), the bare name for a signature card subtitled with
// its champion, "Name, Subtitle" otherwise.
function ourName(c, championNames) {
  if (typeOf(c) === 'Legend') {
    const tags = tagsOf(c);
    const champ = tags.find(t => championNames.has(t)) || tags[tags.length - 1];
    return champ ? `${champ}, ${c.name}` : c.name;
  }
  if (c.subtitle && supertypeOf(c) === 'Signature' && tagsOf(c).includes(c.subtitle)) return c.name;
  return c.subtitle ? `${c.name}, ${c.subtitle}` : c.name;
}

const statOf = (c, field) => {
  const v = c[field]?.value?.id;
  return typeof v === 'number' ? v : parseInt(v, 10) || 0;
};

// A new card's entry, with its stats from the gallery.
function newEntry(c) {
  return {
    champions: tagsOf(c),
    domains: (c.domain?.values || []).map(v => v.label),
    energy: statOf(c, 'energy'),
    isToken: supertypeOf(c) === 'Token',
    might: statOf(c, 'might'),
    power: statOf(c, 'power'),
    type: typeOf(c),
  };
}

function indexGallery(cards) {
  const index = new Map();
  const add = (key, card) => {
    const k = cardKey(key);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(card);
  };
  for (const c of cards) {
    const isLegend = (c.cardType?.type || []).some(t => t.label === 'Legend');
    // The champion is one of the Legend's tags, not always the first
    // ("Yordle", "Kennen").
    if (isLegend) (c.tags?.tags || []).forEach(tag => add(`${tag}, ${c.name}`, c));
    else add(c.subtitle ? `${c.name}, ${c.subtitle}` : c.name, c);
  }
  // Bare names ("Showstopper" for "Showstopper, Sett") only where nothing
  // else already uses that key.
  for (const c of cards) {
    const k = cardKey(c.name);
    if (!index.has(k)) add(c.name, c);
  }
  return index;
}

async function main() {
  const gallery = findCards(await loadGallery(process.argv[2]));
  const index = indexGallery(gallery);
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const curated = JSON.parse(fs.readFileSync(ABILITIES_PATH, 'utf8'));

  const report = { matched: 0, unmatched: [], added: {}, incomplete: [], abilities: 0, changedText: [], newHashes: 0, curatedMissing: [] };

  const championNames = new Set(gallery.filter(c => supertypeOf(c) === 'Champion' && typeOf(c) === 'Unit').map(c => c.name));
  // Every gallery card under this database's name for it.
  const byOurName = new Map();
  for (const c of gallery) {
    const k = cardKey(ourName(c, championNames));
    if (!byOurName.has(k)) byOurName.set(k, []);
    byOurName.get(k).push(c);
  }
  const printsOf = name => index.get(cardKey(name)) || index.get(NAME_FIXES[cardKey(name)] || '') || byOurName.get(cardKey(name));

  // Cards of a new set: gallery cards no database entry matches yet.
  const matchedIds = new Set();
  for (const name of Object.keys(db)) (printsOf(name) || []).forEach(c => matchedIds.add(c.id));
  for (const prints of byOurName.values()) {
    if (prints.some(c => matchedIds.has(c.id))) continue;
    const card = basePrint(prints);
    const name = ourName(card, championNames);
    if (!typeOf(card)) {
      report.incomplete.push(name);
      continue;
    }
    if (db[name]) continue;
    db[name] = newEntry(card);
    const set = card.set?.value?.id || '?';
    report.added[set] = (report.added[set] || 0) + 1;
  }
  for (const [broken, real] of Object.entries(BROKEN_NAMES)) {
    if (db[broken] && db[real]) delete db[broken];
  }

  for (const [name, rec] of Object.entries(db)) {
    const prints = printsOf(name);
    delete rec.legendAbility; // replaced by `ability`
    delete rec.code;
    delete rec.supertype;
    delete rec.keywords;
    delete rec.vanilla;
    delete rec.equip;
    delete rec.official;
    delete rec.ability;
    if (!prints) {
      report.unmatched.push(name);
      continue;
    }
    report.matched++;
    const card = basePrint(prints);
    const code = (card.publicCode || '').split('/')[0];
    if (code) rec.code = code;
    const supertype = supertypeOf(card);
    if (supertype) rec.supertype = supertype;
    const official = ourName(card, championNames);
    if (cardKey(official) !== cardKey(name) && rec.type !== 'Legend') rec.official = official;
    const keywords = parseKeywords(card, rec.domains || []);
    if (Object.keys(keywords).length) rec.keywords = keywords;
    if (isVanilla(card)) rec.vanilla = true;
    if (rec.type === 'Gear') {
      const equip = parseEquip(card);
      if (equip) rec.equip = equip;
    }

    const entry = curated.cards[name];
    if (entry) {
      const fp = fingerprint(card);
      if (!entry.hash) {
        entry.hash = fp;
        report.newHashes++;
      }
      if (entry.hash !== fp) {
        report.changedText.push(name);
      } else if (entry.ability && Object.keys(entry.ability).length) {
        rec.ability = entry.ability;
        if (entry.partial) rec.abilityPartial = true;
        else delete rec.abilityPartial;
        report.abilities++;
      }
    } else {
      delete rec.abilityPartial;
    }
  }
  for (const name of Object.keys(curated.cards)) {
    if (!db[name]) report.curatedMissing.push(name);
  }

  // One card per line, sorted by name: small to download on the phone,
  // readable in diffs.
  const lines = Object.entries(db).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  fs.writeFileSync(DB_PATH, `{\n${lines.join(',\n')}\n}\n`);
  fs.writeFileSync(ABILITIES_PATH, JSON.stringify(curated, null, 2) + '\n');

  const added = Object.entries(report.added).map(([set, n]) => `${n} from ${set}`).join(', ');
  if (added) console.log(`New cards added: ${added}.`);
  if (report.incomplete.length) console.log(`Not added yet (no card type in the gallery): ${report.incomplete.join(', ')}`);
  console.log(`Cards matched to the official gallery: ${report.matched} of ${Object.keys(db).length}.`);
  if (report.unmatched.length) console.log(`Not found in the gallery (kept as they were): ${report.unmatched.join(', ')}`);
  console.log(`Curated abilities applied: ${report.abilities}${report.newHashes ? ` (${report.newHashes} new text fingerprints recorded)` : ''}.`);
  if (report.changedText.length) console.log(`WARNING - official text changed since curation, ability dropped until reviewed: ${report.changedText.join(', ')}`);
  if (report.curatedMissing.length) console.log(`WARNING - curated cards not in the database: ${report.curatedMissing.join(', ')}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
