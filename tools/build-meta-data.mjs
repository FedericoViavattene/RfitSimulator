#!/usr/bin/env node
/*
  build-meta-data.mjs - builds docs/meta.json from Riot's official
  organized-play "Top Decks" articles (playriftbound.com news): for every
  event, how many players brought each Legend on Day 1 and Day 2, and the
  published decklists (the Top 8 and the best list of each Legend).

  Usage:
    node tools/build-meta-data.mjs                (downloads the articles)
    node tools/build-meta-data.mjs --cache dir    (keeps a copy of every
                                                   downloaded page in dir and
                                                   reuses it on the next run)

  Run it after tools/build-card-data.mjs: card names are resolved against
  docs/carddatabase.json, and a name it doesn't know is reported (and kept
  out of the list) rather than guessed.

  Only facts are stored - lists, placements, player counts - with a link to
  each article; none of the articles' prose.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = path.join(ROOT, 'docs', 'carddatabase.json');
const META_PATH = path.join(ROOT, 'docs', 'meta.json');
const SITEMAP_URL = 'https://riftbound.leagueoflegends.com/en-us/sitemap_loc.xml';
const ARTICLE_URL = /^https:\/\/playriftbound\.com\/en-us\/news\/(?:[a-z0-9-]+\/)?[a-z0-9-]*(?:top-decks|best-decks)[a-z0-9-]*\/$/;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; RiftboundSimulator; +https://github.com/FedericoViavattene/RfitSimulator)' };

const args = process.argv.slice(2);
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;

async function download(url) {
  const file = cacheDir && path.join(cacheDir, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]+/gi, '_'));
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (file) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, text);
  }
  return text;
}

// --- card names ---------------------------------------------------------------

const cardKey = name => name.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const looseKey = name => cardKey(name).replace(/[,'.!"]/g, '').replace(/\s+/g, ' ');
const compactKey = name => cardKey(name).replace(/[^a-z0-9]/g, '');

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Resolves a card name as the articles print it to this database's name.
// The articles have the odd typo ("Corina Veraza", "Si vir, Mercenary"), so
// after the exact and punctuation-free forms it accepts the one card within
// a couple of letters - and reports every such fix.
function cardResolver(db, fixes) {
  const index = new Map();
  const compact = new Map();
  const add = (key, name) => { if (key && !index.has(key)) index.set(key, name); };
  for (const [name, rec] of Object.entries(db)) {
    if (rec.isToken) continue;
    for (const n of [name, rec.official].filter(Boolean)) {
      add(cardKey(n), name);
      add(looseKey(n), name);
      if (!compact.has(compactKey(n))) compact.set(compactKey(n), name);
    }
  }
  return raw => {
    const name = raw.replace(/:$/, '').trim();
    const found = index.get(cardKey(name)) || index.get(looseKey(name)) || compact.get(compactKey(name));
    if (found) return found;
    const key = compactKey(name);
    if (key.length < 5) return null;
    const limit = Math.max(1, Math.floor(key.length / 9));
    let best = null;
    let bestDistance = Infinity;
    let tie = false;
    for (const [k, card] of compact) {
      if (Math.abs(k.length - key.length) > limit) continue;
      const d = editDistance(key, k);
      if (d < bestDistance) [best, bestDistance, tie] = [card, d, false];
      else if (d === bestDistance && card !== best) tie = true;
    }
    if (best && bestDistance <= limit && !tie) {
      fixes.add(`"${raw}" -> "${best}"`);
      return best;
    }
    return null;
  };
}

// --- HTML to text -----------------------------------------------------------

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;|[’‘]/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function textLinesOf(html) {
  return decode(html
    .replace(/<br\s*\/?>|<\/(?:p|li|h\d|td|th|tr|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const cellsOf = row => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => textLinesOf(m[1]).join(' '));

// --- one article --------------------------------------------------------------

// "Los Angeles’ Top Decks" -> "Los Angeles"; "From Garen to Annie: RQ
// Houston's Top Decks" -> "Houston"; "The Best Decks Out of Bologna" ->
// "Bologna".
function eventName(title) {
  return decode(title)
    .replace(/^.*[:,]\s*/, '')
    .replace(/^the best decks out of\s+/i, '')
    .replace(/^RQ\s+/i, '')
    .replace(/'s?\s+top decks$/i, '')
    .trim();
}

const SECTION = /^(Legend|Champion|Main Deck|Battlefields?|Rune Pool|Runes|Sideboard)\s*(?::\s*(.*))?$/i;
const RANK = /^(Legend Rank|Overall Ranking|Overall Rank)\s*:?\s*(.*)$/i;

// "3 Name", "3x Name", "x3 Name", "Name x3" or a bare "Name".
function parseCardLine(line) {
  const m = line.match(/^x?(\d+)\s*x?\s+(.+)$/i) || line.match(/^(.+?)\s+x(\d+)$/i);
  if (!m) return { qty: 1, name: line.trim() };
  return /^\d+$/.test(m[1]) ? { qty: parseInt(m[1], 10), name: m[2].trim() } : { qty: parseInt(m[2], 10), name: m[1].trim() };
}

// A deck table: the player, their ranks, then labeled sections of
// "3 Card Name" lines.
function parseDeckTable(html) {
  const deck = { player: null, legendRank: null, overall: null, sections: { legend: [], champion: [], main: [], battlefields: [], runes: [], sideboard: [] } };
  let section = 'main';
  for (const line of textLinesOf(html)) {
    const rank = line.match(RANK);
    if (rank) {
      const value = rank[2].replace(/\s+/g, ' ').trim();
      if (/legend/i.test(rank[1])) deck.legendRank = value.replace(/^#/, '').replace(/\s*\/\s*/, '/').replace(/\s*players?$/i, '');
      else deck.overall = parseInt(value.replace(/^#/, ''), 10) || null;
      continue;
    }
    const head = line.match(SECTION);
    if (head) {
      const label = head[1].toLowerCase();
      section = label.startsWith('legend') ? 'legend'
        : label.startsWith('champion') ? 'champion'
        : label.startsWith('battlefield') ? 'battlefields'
        : label.startsWith('rune') ? 'runes'
        : label.startsWith('side') ? 'sideboard'
        : 'main';
      if (head[2]) deck.sections[section].push(parseCardLine(head[2]));
      continue;
    }
    if (!deck.player) {
      deck.player = line;
      continue;
    }
    deck.sections[section].push(parseCardLine(line));
  }
  return deck;
}

// The Day 1 / Day 2 table: a Legend label, then the Day 1 and Day 2 player
// counts (in that order in every layout Riot has used) and percentages.
function parseShareTable(html) {
  const rows = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = cellsOf(row);
    const counts = cells.slice(1).filter(c => /^\d+$/.test(c)).map(c => parseInt(c, 10));
    if (!cells[0] || counts.length < 2) continue;
    rows.push({ label: cells[0], day1: counts[0], day2: counts[1] });
  }
  return rows;
}

function legendResolver(db) {
  const legends = Object.keys(db).filter(n => db[n].type === 'Legend');
  const champOf = n => cardKey(n.split(',')[0]);
  const titleOf = n => n.split(',').slice(1).join(',').trim().toLowerCase();
  const initials = s => s.split(/\s+/).map(w => w[0]).join('').toLowerCase();
  // "Irelia" / "Renata" / "Kai'sa, Daughter of the Void" / "Master Yi, WB" /
  // "Master Yi, Wuju Bladesmen" -> the Legend's full name, or null. A bare
  // champion with two Legends ("Master Yi") resolves only when `seen` (the
  // Legends of the event's lists) holds just one of them.
  return (label, seen = null) => {
    const [champPart, ...rest] = decode(label).split(',');
    const title = rest.join(',').trim().toLowerCase();
    const champ = cardKey(champPart);
    let options = legends.filter(n => champOf(n) === champ);
    if (!options.length) options = legends.filter(n => champOf(n).startsWith(champ));
    if (!title) {
      if (options.length > 1 && seen) options = options.filter(n => seen.has(n));
      return options.length === 1 ? options[0] : null;
    }
    return options.find(n => titleOf(n) === title)
      || options.find(n => initials(titleOf(n)) === title.replace(/[^a-z]/g, ''))
      || options.find(n => titleOf(n).slice(0, 5) === title.slice(0, 5))
      || null;
  };
}

// Card lines -> resolved cards. A line that doesn't resolve gets a second
// look for the articles' formatting slips: a stray label ("Lucian: Lucian,
// Purifier"), two lines run together ("Wages of Pain3 Xin Zhao, Vigilant"),
// or one card split over two lines ("2 Se" + "a Monkey").
function resolveLines(lines, resolve) {
  const cards = [];
  const unknown = [];
  for (let i = 0; i < lines.length; i++) {
    const { qty, name } = lines[i];
    const direct = resolve(name);
    if (direct) {
      cards.push({ qty, card: direct });
      continue;
    }
    const afterLabel = name.includes(': ') && resolve(name.split(': ').slice(1).join(': '));
    if (afterLabel) {
      cards.push({ qty, card: afterLabel });
      continue;
    }
    const merged = name.match(/^(.*?\D)(\d+)\s+(\S.*)$/);
    if (merged && resolve(merged[1]) && resolve(merged[3])) {
      cards.push({ qty, card: resolve(merged[1]) });
      cards.push({ qty: parseInt(merged[2], 10), card: resolve(merged[3]) });
      continue;
    }
    if (merged && resolve(merged[1])) {
      // "Ruin Runner2 Se" + "a Monkey"
      cards.push({ qty, card: resolve(merged[1]) });
      const next = lines[i + 1];
      const joined = next && resolve(merged[3] + next.name);
      if (joined) {
        cards.push({ qty: parseInt(merged[2], 10), card: joined });
        i++;
        continue;
      }
      unknown.push(`${merged[2]} ${merged[3]}`);
      continue;
    }
    if (name.length > 1) unknown.push(name);
  }
  return { cards, unknown };
}

function parseArticle(url, html, db, resolve, resolveLegend, warnings) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${url}: no page data`);
  const page = JSON.parse(m[1]).props.pageProps.page;
  const body = (page.blades || []).filter(b => b.type === 'articleRichText').map(b => b.richText?.body || '').join('\n');
  const id = url.split('/').filter(Boolean).pop();
  const event = {
    id,
    name: eventName(page.title || id),
    title: decode(page.title || ''),
    published: (page.displayedPublishDate || page.analytics?.publishDate || '').slice(0, 10),
    url,
    players: null,
    day2Players: null,
    share: [],
    decks: [],
  };

  let shareRows = [];
  let group = null;
  for (const block of body.match(/<h[12][^>]*>[\s\S]*?<\/h[12]>|<table[\s\S]*?<\/table>/gi) || []) {
    if (/^<h[12]/i.test(block)) {
      const heading = textLinesOf(block).join(' ');
      if (/top\s*(?:8|eight)/i.test(heading)) group = 'top8';
      else if (/best/i.test(heading)) group = 'bestof';
      continue;
    }
    if (/Legend Rank|Overall Rank|Main Deck/i.test(block)) {
      const raw = parseDeckTable(block);
      const deck = {
        player: raw.player, overall: raw.overall, legendRank: raw.legendRank,
        top8: group === 'top8' || (raw.overall != null && raw.overall <= 8), bestOf: group === 'bestof',
        legend: null, champion: null, main: [], battlefields: [], runes: [], sideboard: [], unknown: [],
      };
      for (const [section, lines] of Object.entries(raw.sections)) {
        const { cards, unknown } = resolveLines(lines, resolve);
        deck.unknown.push(...unknown);
        for (const { qty, card } of cards) {
          const type = db[card].type;
          if (type === 'Legend') deck.legend = card;
          else if (section === 'sideboard') deck.sideboard.push([qty, card]);
          else if (type === 'Battlefield') {
            if (!deck.battlefields.includes(card)) deck.battlefields.push(card);
          } else if (type === 'Rune') deck.runes.push([qty, card]);
          else if (section === 'champion') deck.champion = card;
          else deck.main.push([qty, card]);
        }
      }
      event.decks.push(deck);
      continue;
    }
    if (!shareRows.length && /%/.test(block)) shareRows = parseShareTable(block);
  }

  // An early article prints no Legend line: the Chosen Champion tells which
  // Legend when its champion has only one, or else the "Legend Rank: 1 / 31"
  // player count matching that Legend's Day 1 count.
  for (const deck of event.decks) {
    if (deck.legend || !deck.champion) continue;
    const champ = deck.champion.split(',')[0];
    let legend = resolveLegend(champ);
    if (!legend && deck.legendRank) {
      const total = parseInt(deck.legendRank.split('/')[1], 10);
      const rows = shareRows.filter(r => r.day1 === total && resolveLegend(r.label) && db[deck.champion].champions.includes(resolveLegend(r.label).split(',')[0]));
      if (rows.length === 1) legend = resolveLegend(rows[0].label);
    }
    if (legend) {
      deck.legend = legend;
      deck.legendInferred = true;
    }
  }
  // A Top 8 list that also won its Legend's Best-Of is printed twice.
  const byList = new Map();
  event.decks = event.decks.filter(deck => {
    const key = JSON.stringify([deck.player, deck.legend, deck.champion, deck.main, deck.runes, deck.battlefields]);
    const first = byList.get(key);
    if (!first) {
      byList.set(key, deck);
      return true;
    }
    first.top8 = first.top8 || deck.top8;
    first.bestOf = first.bestOf || deck.bestOf;
    first.overall = first.overall || deck.overall;
    first.legendRank = first.legendRank || deck.legendRank;
    return false;
  });
  event.decks = event.decks.filter(deck => {
    if (!deck.legend) {
      warnings.push(`${event.name}: no Legend for ${deck.player}'s list - left out.`);
      return false;
    }
    if (!deck.unknown.length) delete deck.unknown;
    else warnings.push(`${event.name}: unknown cards in ${deck.player}'s list: ${deck.unknown.join(', ')}`);
    if (!deck.sideboard.length) delete deck.sideboard;
    return true;
  });

  const seen = new Set(event.decks.map(d => d.legend));
  event.share = shareRows.map(r => ({ legend: resolveLegend(r.label, seen), ...r }));
  for (const r of event.share) if (!r.legend) warnings.push(`${event.name}: Legend "${r.label}" in the field table not recognized.`);
  if (event.share.length) {
    event.players = event.share.reduce((s, r) => s + r.day1, 0);
    event.day2Players = event.share.reduce((s, r) => s + r.day2, 0);
  }
  return event;
}

async function main() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const fixes = new Set();
  const resolve = cardResolver(db, fixes);
  const resolveLegend = legendResolver(db);
  const sitemap = await download(SITEMAP_URL);
  const urls = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()).filter(u => ARTICLE_URL.test(u)))];
  if (!urls.length) throw new Error('No "Top Decks" articles found in the sitemap.');

  const warnings = [];
  const events = [];
  for (const url of urls) {
    try {
      const event = parseArticle(url, await download(url), db, resolve, resolveLegend, warnings);
      if (event.decks.length || event.share.length) events.push(event);
      else warnings.push(`${url}: no decklists or field table found - skipped.`);
    } catch (err) {
      warnings.push(err.message);
    }
  }
  events.sort((a, b) => b.published.localeCompare(a.published));

  // Unchanged data keeps its file (and date), so the weekly refresh only
  // commits when there's something new.
  const previous = fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf8')) : null;
  if (previous && JSON.stringify(previous.events) === JSON.stringify(events)) {
    console.log(`Tournament data unchanged (${events.length} events).`);
    for (const w of warnings) console.log(`WARNING - ${w}`);
    return;
  }

  const meta = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'Riot Games organized play "Top Decks" articles (playriftbound.com)',
    events,
  };
  // One event per line: readable in diffs, small to download.
  const lines = events.map(e => '  ' + JSON.stringify(e));
  fs.writeFileSync(META_PATH, `{"generated":${JSON.stringify(meta.generated)},"source":${JSON.stringify(meta.source)},"events":[\n${lines.join(',\n')}\n]}\n`);

  const deckCount = events.reduce((s, e) => s + e.decks.length, 0);
  console.log(`Events: ${events.length} (${events.map(e => `${e.name} ${e.published}`).join(', ')}).`);
  console.log(`Decklists: ${deckCount}.`);
  if (fixes.size) console.log(`Typos in the articles, matched to the nearest card: ${[...fixes].join(", ")}.`);
  for (const w of warnings) console.log(`WARNING - ${w}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
