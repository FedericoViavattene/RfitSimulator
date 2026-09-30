import { engine } from './engine.js';

const myDeckSelect = document.getElementById('myDeck');
const opponentDeckSelect = document.getElementById('opponentDeck');
const opponentField = document.getElementById('opponentField');
const simModeSelect = document.getElementById('simMode');
const simulateBtn = document.getElementById('simulateBtn');
const statusLine = document.getElementById('statusLine');
const resultsSection = document.getElementById('results');

// ---- Top-level nav (Simulate / Import) ----
const topNav = document.getElementById('topNav');
const topPanels = {
  simulate: document.getElementById('panel-simulate'),
  import: document.getElementById('panel-import'),
};

// ---- Stepper ----
const stepper = document.getElementById('stepper');
const stepEls = stepper ? Array.from(stepper.querySelectorAll('.step')) : [];
const stepOpponentLi = document.getElementById('stepOpponentLi');

// ---- Mode cards ----
const modeCards = Array.from(document.querySelectorAll('.mode-card'));

// ---- "New simulation" buttons ----
const newSimBtn = document.getElementById('newSimBtn');
const newMatchSimBtn = document.getElementById('newMatchSimBtn');
const newMatrixSimBtn = document.getElementById('newMatrixSimBtn');
const bannedWarnings = document.getElementById('bannedWarnings');
const winrateNumber = document.getElementById('winrateNumber');
const winrateSub = document.getElementById('winrateSub');
const gameList = document.getElementById('gameList');
const lossDetails = document.getElementById('lossDetails');
const lossList = document.getElementById('lossList');
const optimization = document.getElementById('optimization');
const opponentDecklist = document.getElementById('opponentDecklist');
const recommendation = document.getElementById('recommendation');

const matchResultsSection = document.getElementById('matchResults');
const matchBannedWarnings = document.getElementById('matchBannedWarnings');
const matchWinrateNumber = document.getElementById('matchWinrateNumber');
const matchWinrateSub = document.getElementById('matchWinrateSub');
const matchList = document.getElementById('matchList');
const matchOptimization = document.getElementById('matchOptimization');
const matchOpponentDecklist = document.getElementById('matchOpponentDecklist');
const matchRecommendation = document.getElementById('matchRecommendation');

const matrixResultsSection = document.getElementById('matrixResults');
const matrixBannedWarnings = document.getElementById('matrixBannedWarnings');
const matrixAverageNumber = document.getElementById('matrixAverageNumber');
const matrixTable = document.getElementById('matrixTable');

const offlineNotice = document.getElementById('offlineNotice');

// Labels for the one shared "Simulate" button, keyed by mode - so adding a
// future mode only means adding one entry here, not more branching below.
const MODE_BUTTON_LABEL = {
  single: 'Simulate 50 games',
  match:  'Simulate 20 best-of-3 matches',
  matrix: 'Run matchup matrix',
};

const importCategory = document.getElementById('importCategory');
const importName = document.getElementById('importName');
const importText = document.getElementById('importText');
const importBtn = document.getElementById('importBtn');
const importStatus = document.getElementById('importStatus');
const importResult = document.getElementById('importResult');

// Cached, richer copies of the last engine.listDecks() payload (id + name +
// legend), kept alongside the plain <select> elements above. The selects
// stay the real source of truth for which deck is picked (every existing
// render/simulate function still just reads myDeckSelect.value/
// opponentDeckSelect.value) - these two just feed the deck-picker overlay
// below without a second call into the engine.
let myDecksCache = [];
let opponentsCache = {};

function setStatus(text, isError) {
  statusLine.textContent = text || '';
  statusLine.classList.toggle('error', !!isError);
}

async function loadDecks() {
  setStatus('Loading decks...');
  try {
    const data = await engine.listDecks();

    myDecksCache = data.myDecks || [];
    opponentsCache = data.opponents || {};

    myDeckSelect.innerHTML = '';
    myDecksCache.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      myDeckSelect.appendChild(opt);
    });

    opponentDeckSelect.innerHTML = '';
    Object.keys(opponentsCache).forEach(category => {
      const group = document.createElement('optgroup');
      group.label = category;
      opponentsCache[category].forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        group.appendChild(opt);
      });
      opponentDeckSelect.appendChild(group);
    });

    if (!myDeckSelect.options.length || !opponentDeckSelect.options.length) {
      setStatus('No decks found - import one from the "Import a deck" tab.', true);
      simulateBtn.disabled = true;
      return;
    }
    setStatus('');
  } catch (err) {
    setStatus('Could not load decks: ' + err.message, true);
  } finally {
    updateTriggerPreview('my');
    updateTriggerPreview('opponent');
  }
}

function renderBannedWarnings(data, target) {
  const my = data.bannedExcludedMy || [];
  const opp = data.bannedExcludedOpponent || [];
  if (my.length === 0 && opp.length === 0) {
    target.classList.add('hidden');
    target.innerHTML = '';
    return;
  }
  let html = '<h2 class="warn-box">Banned cards excluded</h2>';
  if (my.length) html += `<p class="warn-box">Your deck: ${my.join(', ')}</p>`;
  if (opp.length) html += `<p class="warn-box">Opponent deck: ${opp.join(', ')}</p>`;
  target.innerHTML = html;
  target.classList.remove('hidden');
}

function renderWinrate(data) {
  winrateNumber.textContent = data.winrate + '%';
  winrateNumber.classList.toggle('good', data.winrate >= 50);
  winrateNumber.classList.toggle('bad', data.winrate < 50);
  winrateSub.textContent = `${data.wins} / ${data.totalGames} wins - ${data.myDeckName} vs ${data.opponentDeckName}`;
}

function renderGameList(games) {
  gameList.innerHTML = '';
  games.forEach(g => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (g.win ? 'win' : 'loss');
    badge.textContent = g.win ? 'WIN' : 'LOSS';
    const scoreSpan = document.createElement('span');
    scoreSpan.textContent = `Game ${g.n}: You ${g.scoreA} - ${g.scoreB} Opponent`;
    li.appendChild(scoreSpan);
    li.appendChild(badge);
    gameList.appendChild(li);
  });
}

function renderLossBreakdown(games) {
  const losses = games.filter(g => !g.win);
  if (losses.length === 0) {
    lossDetails.classList.add('hidden');
    return;
  }
  lossDetails.classList.remove('hidden');
  lossList.innerHTML = '';
  losses.forEach(g => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>Game ${g.n}:</strong> ${g.lossReason}`;
    lossList.appendChild(li);
  });
}

function renderOptimization(stats, target) {
  let html = '';

  html += '<div class="opt-block"><h3>Most played cards</h3><ul>';
  if (stats.mostPlayed && stats.mostPlayed.length) {
    stats.mostPlayed.forEach(c => {
      html += `<li>${c.name} - played ${c.count} times</li>`;
    });
  } else {
    html += '<li>No data</li>';
  }
  html += '</ul></div>';

  html += '<div class="opt-block"><h3>Never played (cut candidates)</h3>';
  if (stats.neverPlayed && stats.neverPlayed.length) {
    html += '<ul>' + stats.neverPlayed.map(n => `<li>${n}</li>`).join('') + '</ul>';
  } else {
    html += '<p>None - every card got played at least once.</p>';
  }
  html += '</div>';

  html += `<div class="opt-block"><h3>Average Energy cost</h3><p>${stats.averageEnergy.toFixed(2)}</p></div>`;

  if (stats.curveSuggestion) {
    html += `<div class="suggestion">${stats.curveSuggestion}</div>`;
  }

  target.innerHTML = html;
}

function renderDecklist(decklist, target) {
  let html = '';
  const groups = decklist.groups || {};
  Object.keys(groups).forEach(type => {
    const rows = groups[type];
    html += `<div class="deck-group"><h4>${type}</h4><table class="deck-table">`;
    if (type === 'Unit' || type === 'Spell' || type === 'Gear') {
      html += '<tr><th>Qty</th><th>Name</th><th>E</th><th>P</th><th>M</th><th>Domain</th><th>Tag</th></tr>';
      rows.forEach(r => {
        html += `<tr><td>${r.quantity}</td><td>${r.name}</td><td>${r.energy}</td><td>${r.power}</td><td>${r.might}</td><td>${r.domain || ''}</td><td>${r.tag || ''}</td></tr>`;
      });
    } else {
      html += '<tr><th>Qty</th><th>Name</th><th>Domain</th></tr>';
      rows.forEach(r => {
        html += `<tr><td>${r.quantity}</td><td>${r.name}</td><td>${r.domain || ''}</td></tr>`;
      });
    }
    html += '</table></div>';
  });
  target.innerHTML = html;
}

function renderMatchList(matches) {
  matchList.innerHTML = '';
  matches.forEach(m => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (m.win ? 'win' : 'loss');
    badge.textContent = m.win ? 'WON' : 'LOST';
    const scoreSpan = document.createElement('span');
    scoreSpan.textContent = `Match ${m.n}: You ${m.gamesWonA} - ${m.gamesWonB} Opponent (games)`;
    li.appendChild(scoreSpan);
    li.appendChild(badge);
    matchList.appendChild(li);
  });
}

function renderRecommendation(rec, target) {
  if (!rec) {
    target.innerHTML = '';
    return;
  }

  let html = '<ul class="advice-list">';
  (rec.advice || []).forEach(line => {
    html += `<li>${line}</li>`;
  });
  html += '</ul>';

  const sideboardIn = rec.sideboardIn || [];
  const sideboardOut = rec.sideboardOut || [];

  if (sideboardIn.length === 0) {
    html += '<p>No legal sideboard candidates were found for this deck\'s domain(s).</p>';
    target.innerHTML = html;
    return;
  }

  html += `<div class="opt-block"><h3>Sideboard IN (max ${sideboardIn.length})</h3><ul class="sideboard-list">`;
  sideboardIn.forEach(c => {
    html += `<li><span class="sideboard-card-name">${c.name}</span> <span class="sideboard-card-stats">[${c.energy}E / ${c.might}M] ${c.domain || ''}</span></li>`;
  });
  html += '</ul></div>';

  if (sideboardOut.length > 0) {
    html += '<div class="opt-block"><h3>Sideboard OUT</h3><ul class="sideboard-list sideboard-out">';
    sideboardOut.forEach(c => {
      const playedNote = c.timesPlayed === 0 ? 'never played' : `played ${c.timesPlayed}x`;
      html += `<li><span class="sideboard-card-name">${c.name}</span> <span class="sideboard-card-stats">[${c.energy}E / ${c.might}M] ${c.domain || ''} (${playedNote})</span></li>`;
    });
    html += '</ul></div>';
  }

  target.innerHTML = html;
}

function renderMatrix(data) {
  matrixAverageNumber.textContent = data.averageWinrate + '%';
  matrixAverageNumber.classList.toggle('good', data.averageWinrate >= 50);
  matrixAverageNumber.classList.toggle('bad', data.averageWinrate < 50);

  const rows = data.rows || [];
  if (rows.length === 0) {
    matrixTable.innerHTML = '<p>No saved opponent decks were found. Import one from the "Import a deck" tab.</p>';
    return;
  }

  const byCategory = {};
  rows.forEach(r => {
    const cat = r.category || 'Opponents';
    (byCategory[cat] = byCategory[cat] || []).push(r);
  });

  let html = '';
  Object.keys(byCategory).forEach(cat => {
    html += `<div class="matrix-group"><h4>${cat}</h4>`;
    byCategory[cat].forEach(r => {
      const goodBad = r.winrate >= 50 ? 'good' : 'bad';
      html += `<div class="matrix-row">`
        + `<span class="matrix-name">${r.name}</span>`
        + `<span class="matrix-winrate ${goodBad}">${r.winrate}%</span>`
        + `<span class="matrix-record">${r.wins}/${r.total}</span>`
        + `</div>`;
    });
    html += '</div>';
  });
  matrixTable.innerHTML = html;
}

function renderMatchWinrate(data) {
  matchWinrateNumber.textContent = data.matchWinrate + '%';
  matchWinrateNumber.classList.toggle('good', data.matchWinrate >= 50);
  matchWinrateNumber.classList.toggle('bad', data.matchWinrate < 50);
  matchWinrateSub.textContent = `${data.matchWins} / ${data.matchCount} matches won (best of ${data.bestOf}) - ${data.myDeckName} vs ${data.opponentDeckName}`;
}

async function runSingleOpponentSimulation(myDeckId, opponentDeckId) {
  const data = await engine.simulate(myDeckId, opponentDeckId);

  renderBannedWarnings(data, bannedWarnings);
  renderWinrate(data);
  renderGameList(data.games);
  renderLossBreakdown(data.games);
  renderOptimization(data.optimization, optimization);
  renderRecommendation(data.recommendation, recommendation);
  renderDecklist(data.opponentDecklist, opponentDecklist);
  resultsSection.classList.remove('hidden');
}

async function runMatchSimulation(myDeckId, opponentDeckId) {
  const data = await engine.simulateMatch(myDeckId, opponentDeckId);

  renderBannedWarnings(data, matchBannedWarnings);
  renderMatchWinrate(data);
  renderMatchList(data.matches);
  renderOptimization(data.optimization, matchOptimization);
  renderRecommendation(data.recommendation, matchRecommendation);
  renderDecklist(data.opponentDecklist, matchOpponentDecklist);
  matchResultsSection.classList.remove('hidden');
}

async function runMatchupMatrix(myDeckId) {
  const data = await engine.matchupMatrix(myDeckId);

  renderBannedWarnings(data, matrixBannedWarnings);
  renderMatrix(data);
  matrixResultsSection.classList.remove('hidden');
}

async function runSimulation() {
  const myDeckId = myDeckSelect.value;
  const opponentDeckId = opponentDeckSelect.value;
  const mode = simModeSelect.value;

  if (!myDeckId) {
    setStatus('Pick your deck first.', true);
    return;
  }
  if (mode !== 'matrix' && !opponentDeckId) {
    setStatus('Pick both a deck and an opponent first.', true);
    return;
  }

  simulateBtn.disabled = true;
  setStatus(mode === 'matrix' ? 'Running the matchup matrix...' : 'Simulating...');
  resultsSection.classList.add('hidden');
  matchResultsSection.classList.add('hidden');
  matrixResultsSection.classList.add('hidden');

  try {
    if (mode === 'match') {
      await runMatchSimulation(myDeckId, opponentDeckId);
    } else if (mode === 'matrix') {
      await runMatchupMatrix(myDeckId);
    } else {
      await runSingleOpponentSimulation(myDeckId, opponentDeckId);
    }
    setStatus('');
    markRunStepDone();
    resultsForActiveMode(mode).scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('Error: ' + err.message, true);
  } finally {
    simulateBtn.disabled = false;
  }
}

function resultsForActiveMode(mode) {
  if (mode === 'match') return matchResultsSection;
  if (mode === 'matrix') return matrixResultsSection;
  return resultsSection;
}

function applyModeToUi() {
  const mode = simModeSelect.value;
  simulateBtn.textContent = MODE_BUTTON_LABEL[mode] || MODE_BUTTON_LABEL.single;
  opponentField.classList.toggle('hidden', mode === 'matrix');
}

async function importDeck() {
  const text = importText.value;
  if (!text || !text.trim()) {
    setImportStatus('Paste a decklist first.', true);
    return;
  }

  importBtn.disabled = true;
  setImportStatus('Importing...');
  importResult.classList.add('hidden');
  importResult.classList.remove('success', 'failure');

  try {
    const data = await engine.importDeck({
      text,
      category: importCategory.value,
      deckName: importName.value,
    });

    renderImportResult(data);
    setImportStatus('');
    await loadDecks(); // refresh the dropdowns so the new deck shows up right away
    updateStepper();
  } catch (err) {
    setImportStatus('Error: ' + err.message, true);
  } finally {
    importBtn.disabled = false;
  }
}

function setImportStatus(text, isError) {
  importStatus.textContent = text || '';
  importStatus.classList.toggle('error', !!isError);
}

function renderImportResult(data) {
  const ok = data.legendCount === 1 && data.battlefieldCount === 3 &&
             data.runeTotal === 12 && data.mainDeckTotal >= 40 &&
             (!data.warnings || data.warnings.length === 0);

  let html = `<h4>${ok ? 'Imported' : 'Imported with warnings'}: ${data.fileName}</h4>`;
  html += `<div class="import-summary">${data.cardsMatched} card row(s) matched - `
    + `${data.legendCount} Legend, ${data.battlefieldCount} Battlefield(s), `
    + `${data.runeTotal} Rune(s), ${data.mainDeckTotal} Main Deck card(s)`
    + `${data.overwritten ? ' (replaced an existing deck with this name on this device)' : ''}.</div>`;

  if (data.warnings && data.warnings.length) {
    html += '<ul>' + data.warnings.map(w => `<li>${w}</li>`).join('') + '</ul>';
  }

  importResult.innerHTML = html;
  importResult.classList.remove('hidden');
  importResult.classList.add(ok ? 'success' : 'failure');
}

// ===================== Navigation: top-level tabs, stepper, mode cards, result pills =====================

function showTopPanel(name) {
  Object.keys(topPanels).forEach(key => {
    topPanels[key].classList.toggle('hidden', key !== name);
  });
  Array.from(topNav.querySelectorAll('.top-nav-btn')).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === name);
  });
}

function initTopNav() {
  topNav.addEventListener('click', evt => {
    const btn = evt.target.closest('.top-nav-btn');
    if (!btn) return;
    showTopPanel(btn.dataset.panel);
  });
}

function setStep(name, state) {
  // state: 'done' | 'active' | '' (not yet reached)
  const el = stepEls.find(s => s.dataset.step === name);
  if (!el) return;
  el.classList.toggle('done', state === 'done');
  el.classList.toggle('active', state === 'active');
}

function updateStepper() {
  updateTriggerPreview('my');
  updateTriggerPreview('opponent');

  const mode = simModeSelect.value;
  const isMatrix = mode === 'matrix';

  stepOpponentLi.classList.toggle('hidden', isMatrix);

  setStep('deck', myDeckSelect.value ? 'done' : 'active');
  setStep('mode', myDeckSelect.value ? 'done' : '');

  if (!isMatrix) {
    setStep('opponent', opponentDeckSelect.value ? 'done' : (myDeckSelect.value ? 'active' : ''));
  }

  const ready = myDeckSelect.value && (isMatrix || opponentDeckSelect.value);
  setStep('run', ready ? 'active' : '');
}

function markRunStepDone() {
  setStep('run', 'done');
}

function selectMode(mode) {
  simModeSelect.value = mode;
  modeCards.forEach(card => card.classList.toggle('active', card.dataset.mode === mode));
  simModeSelect.dispatchEvent(new Event('change'));
}

function initModeCards() {
  modeCards.forEach(card => {
    card.addEventListener('click', () => selectMode(card.dataset.mode));
  });
}

function initPillNav(navEl, panelsContainer) {
  if (!navEl || !panelsContainer) return;
  navEl.addEventListener('click', evt => {
    const pill = evt.target.closest('.pill');
    if (!pill) return;
    const tab = pill.dataset.tab;

    Array.from(navEl.querySelectorAll('.pill')).forEach(p => {
      p.classList.toggle('active', p === pill);
    });
    Array.from(panelsContainer.querySelectorAll('.result-panel')).forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.tab !== tab);
    });
  });
}

// ===================== Deck picker (category step + legend photo mosaic) =====================
//
// Replaces the flat <select> dropdowns with a two-step picker: for the
// opponent deck, first the 3 known archetype categories, then a mosaic of
// legend tiles (official card art + how many saved decks exist for that
// legend) within the chosen category; for "your deck" (no categories),
// straight to the mosaic. The underlying <select id="myDeck">/#opponentDeck
// stay the real, hidden source of truth - a tile click just sets .value and
// fires 'change', same trick as selectMode() above for the mode cards.

// Official card art, hotlinked from Piltover Archive's public card database
// (https://piltoverarchive.com) - a fan-run card gallery for this game, not
// something we host. Keyed by the exact Legend name as it appears on that
// Legend's own row (CardDatabase.json / the deck's Legend row). If a
// newly-added Legend has no entry here, its tile just falls back to a plain
// initial-letter placeholder - nothing breaks, and it's a one-line add here
// once you know the real card art URL. Add new legends here as they're added.
// This same fetch also gets opportunistically cached by sw.js the first time
// it's loaded online, so it keeps showing up offline afterwards too.
const LEGEND_ART = {
  'Rengar, Pridestalker': 'https://cdn.piltoverarchive.com/cards/UNL-183.webp?width=420',
  'Shen, Eye of Twilight': 'https://cdn.piltoverarchive.com/cards/VEN-147.webp?width=420',
  'Akali, Rogue Assassin': 'https://cdn.piltoverarchive.com/cards/VEN-139.webp?width=420',
  'Fiora, Grand Duelist': 'https://cdn.piltoverarchive.com/cards/SFD-205.webp?width=420',
  "Kha'Zix, Voidreaver": 'https://cdn.piltoverarchive.com/cards/UNL-201.webp?width=420',
  'Master Yi, Wuju Bladesman': 'https://cdn.piltoverarchive.com/cards/OGS-019.webp?width=420',
  'Sett, The Boss': 'https://cdn.piltoverarchive.com/cards/OGN-269.webp?width=420',
  'Azir, Emperor of the Sands': 'https://cdn.piltoverarchive.com/cards/SFD-197.webp?width=420',
  'Ezreal, Prodigal Explorer': 'https://cdn.piltoverarchive.com/cards/SFD-199.webp?width=420',
  'Lillia, Bashful Bloom': 'https://cdn.piltoverarchive.com/cards/UNL-189.webp?width=420',
  'Vex, Gloomist': 'https://cdn.piltoverarchive.com/cards/UNL-193.webp?width=420',
  'Draven, Glorious Executioner': 'https://cdn.piltoverarchive.com/cards/SFD-185.webp?width=420',
  'Irelia, Blade Dancer': 'https://cdn.piltoverarchive.com/cards/SFD-195.webp?width=420',
  'Kennen, Heart of the Tempest': 'https://cdn.piltoverarchive.com/cards/VEN-155.webp?width=420',
};

function legendArtUrl(legendName) {
  if (!legendName) return null;
  const key = Object.keys(LEGEND_ART).find(k => k.toLowerCase() === legendName.toLowerCase());
  return key ? LEGEND_ART[key] : null;
}

function legendInitial(legendName) {
  return (legendName || '?').trim().charAt(0).toUpperCase();
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Groups a flat deck list by their Legend's name, so a future second (or
// third...) deck sharing the same Legend collapses into one mosaic tile
// with a "N decks available" count instead of one tile per deck.
function groupByLegend(decks) {
  const groups = [];
  const byKey = new Map();
  (decks || []).forEach(d => {
    const legend = d.legend || d.name;
    const key = legend.toLowerCase();
    if (!byKey.has(key)) {
      const group = { legend, decks: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).decks.push(d);
  });
  groups.sort((a, b) => a.legend.localeCompare(b.legend));
  return groups;
}

const deckPickerOverlay = document.getElementById('deckPickerOverlay');
const deckPickerBody = document.getElementById('deckPickerBody');
const deckPickerTitle = document.getElementById('deckPickerTitle');
const deckPickerBack = document.getElementById('deckPickerBack');
const deckPickerClose = document.getElementById('deckPickerClose');
const myDeckTrigger = document.getElementById('myDeckTrigger');
const opponentDeckTrigger = document.getElementById('opponentDeckTrigger');

const CATEGORY_ORDER = ['Aggro', 'Midrange', 'Control'];
const CATEGORY_DESC = {
  Aggro: 'Fast, low-curve decks that race for an early lead.',
  Midrange: 'Flexible decks that trade efficiently and scale into the mid-game.',
  Control: 'Slow, high-value decks that win the long game.',
};

let pickerState = null; // { target: 'my'|'opponent', view: 'category'|'mosaic'|'variants', category, groups }

function openDeckPicker(target) {
  pickerState = { target, view: null, category: null, groups: [] };
  if (target === 'opponent') {
    renderCategoryView();
  } else {
    renderMosaicView(myDecksCache, null);
  }
  deckPickerOverlay.classList.remove('hidden');
  document.body.classList.add('deck-picker-open');
}

function closeDeckPicker() {
  deckPickerOverlay.classList.add('hidden');
  document.body.classList.remove('deck-picker-open');
  pickerState = null;
}

function renderCategoryView() {
  pickerState.view = 'category';
  pickerState.category = null;
  deckPickerTitle.textContent = 'Choose a category';
  deckPickerBack.classList.add('hidden');

  const cats = Object.keys(opponentsCache);
  const ordered = CATEGORY_ORDER.filter(c => cats.includes(c))
    .concat(cats.filter(c => !CATEGORY_ORDER.includes(c)));

  if (ordered.length === 0) {
    deckPickerBody.innerHTML = '<p class="deck-picker-empty">No opponent decks found yet.</p>';
    return;
  }

  let html = '<div class="deck-picker-category-grid">';
  ordered.forEach(cat => {
    const legendCount = groupByLegend(opponentsCache[cat] || []).length;
    html += `
      <button type="button" class="deck-picker-category-card category-${cat.toLowerCase()}" data-category="${escapeAttr(cat)}">
        <span class="deck-picker-category-name">${cat}</span>
        <span class="deck-picker-category-desc">${CATEGORY_DESC[cat] || ''}</span>
        <span class="deck-picker-category-count">${legendCount} legend${legendCount === 1 ? '' : 's'}</span>
      </button>`;
  });
  html += '</div>';
  deckPickerBody.innerHTML = html;
}

function renderMosaicView(decks, category) {
  pickerState.view = 'mosaic';
  pickerState.category = category || null;
  deckPickerTitle.textContent = category ? `${category} - choose a legend` : 'Choose your legend';
  deckPickerBack.classList.toggle('hidden', !category);

  const groups = groupByLegend(decks);
  pickerState.groups = groups;

  if (groups.length === 0) {
    deckPickerBody.innerHTML = '<p class="deck-picker-empty">No decks found here yet.</p>';
    return;
  }

  let html = '<div class="legend-grid">';
  groups.forEach(g => {
    const art = legendArtUrl(g.legend);
    const count = g.decks.length;
    html += `
      <button type="button" class="legend-tile" data-legend="${escapeAttr(g.legend)}">
        <span class="legend-tile-img-wrap">
          ${art ? `<img src="${art}" alt="${escapeAttr(g.legend)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.legend-tile').classList.add('img-fallback')">` : ''}
          <span class="legend-tile-fallback">${legendInitial(g.legend)}</span>
        </span>
        <span class="legend-tile-name">${g.legend}</span>
        <span class="legend-tile-count">${count} deck${count === 1 ? '' : 's'} available</span>
      </button>`;
  });
  html += '</div>';
  deckPickerBody.innerHTML = html;
}

function renderVariantsView(group) {
  pickerState.view = 'variants';
  deckPickerTitle.textContent = group.legend;
  deckPickerBack.classList.remove('hidden');

  let html = '<div class="deck-picker-variant-list">';
  group.decks.forEach(d => {
    html += `<button type="button" class="deck-picker-variant" data-deck-id="${escapeAttr(d.id)}">${d.name}</button>`;
  });
  html += '</div>';
  deckPickerBody.innerHTML = html;
}

function selectDeckId(target, deckId) {
  const select = target === 'my' ? myDeckSelect : opponentDeckSelect;
  select.value = deckId;
  select.dispatchEvent(new Event('change'));
  closeDeckPicker();
}

function updateTriggerPreview(target) {
  const select = target === 'my' ? myDeckSelect : opponentDeckSelect;
  const trigger = target === 'my' ? myDeckTrigger : opponentDeckTrigger;
  if (!select || !trigger) return;
  const flatCache = target === 'my' ? myDecksCache : Object.values(opponentsCache).flat();
  const deck = flatCache.find(d => d.id === select.value);

  if (!deck) {
    trigger.innerHTML = '<span class="deck-picker-trigger-placeholder">Choose a deck&hellip;</span>';
    trigger.classList.remove('has-selection');
    return;
  }
  const art = legendArtUrl(deck.legend);
  trigger.classList.add('has-selection');
  trigger.innerHTML = `
    <span class="deck-picker-trigger-thumb">
      ${art ? `<img src="${art}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.deck-picker-trigger-thumb').classList.add('img-fallback')">` : ''}
      <span class="deck-picker-trigger-fallback">${legendInitial(deck.legend)}</span>
    </span>
    <span class="deck-picker-trigger-text">${deck.name}</span>
    <span class="deck-picker-trigger-chevron">&#9662;</span>`;
}

function initDeckPicker() {
  if (!deckPickerOverlay) return;

  myDeckTrigger.addEventListener('click', () => openDeckPicker('my'));
  opponentDeckTrigger.addEventListener('click', () => openDeckPicker('opponent'));
  deckPickerClose.addEventListener('click', closeDeckPicker);
  deckPickerOverlay.addEventListener('click', evt => {
    if (evt.target === deckPickerOverlay) closeDeckPicker();
  });
  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape' && pickerState) closeDeckPicker();
  });

  deckPickerBack.addEventListener('click', () => {
    if (!pickerState) return;
    if (pickerState.view === 'variants') {
      if (pickerState.target === 'opponent' && pickerState.category) {
        renderMosaicView(opponentsCache[pickerState.category] || [], pickerState.category);
      } else {
        renderMosaicView(myDecksCache, null);
      }
    } else if (pickerState.view === 'mosaic' && pickerState.target === 'opponent') {
      renderCategoryView();
    }
  });

  deckPickerBody.addEventListener('click', evt => {
    const catBtn = evt.target.closest('.deck-picker-category-card');
    if (catBtn) {
      const cat = catBtn.dataset.category;
      renderMosaicView(opponentsCache[cat] || [], cat);
      return;
    }
    const tile = evt.target.closest('.legend-tile');
    if (tile && pickerState) {
      const group = (pickerState.groups || []).find(g => g.legend === tile.dataset.legend);
      if (!group) return;
      if (group.decks.length === 1) {
        selectDeckId(pickerState.target, group.decks[0].id);
      } else {
        renderVariantsView(group);
      }
      return;
    }
    const variantBtn = evt.target.closest('.deck-picker-variant');
    if (variantBtn && pickerState) {
      selectDeckId(pickerState.target, variantBtn.dataset.deckId);
    }
  });
}

function resetToSetup() {
  resultsSection.classList.add('hidden');
  matchResultsSection.classList.add('hidden');
  matrixResultsSection.classList.add('hidden');
  setStep('run', myDeckSelect.value && (simModeSelect.value === 'matrix' || opponentDeckSelect.value) ? 'active' : '');
  document.querySelector('.picker').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===================== Offline indicator =====================

function updateOfflineNotice() {
  if (offlineNotice) offlineNotice.classList.toggle('hidden', navigator.onLine);
}

// ===================== Service worker (installability + offline caching) =====================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Without this, an update can look "stuck": sw.js's own network-first
  // rule always hands back fresh index.html, but everything ELSE (app.js,
  // style.css, engine.js...) is cache-first, so the FIRST time you reopen
  // the app after an update you'd get the new HTML paired with the still-
  // cached OLD JS - e.g. new deck-picker buttons in the markup with no old
  // app.js code wired up to open them, which looks like the buttons just
  // don't do anything. sw.js's install/activate handlers already call
  // skipWaiting()/clients.claim(), so the new service worker takes over
  // this page automatically once it's ready; 'controllerchange' fires at
  // that exact moment, and reloading once then guarantees the page and
  // its scripts are the same (new) version. Guarded so it only ever fires
  // once per load, never a reload loop.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('sw.js').catch(() => {
    // Non-fatal: the app still works without the service worker, just
    // without offline caching / the "add to home screen" prompt on some
    // browsers.
  });
}

// ===================== Startup =====================

async function start() {
  initTopNav();
  initModeCards();
  initDeckPicker();
  initPillNav(document.getElementById('resultsPillNav'), resultsSection);
  initPillNav(document.getElementById('matchResultsPillNav'), matchResultsSection);

  myDeckSelect.addEventListener('change', updateStepper);
  opponentDeckSelect.addEventListener('change', updateStepper);
  newSimBtn.addEventListener('click', resetToSetup);
  newMatchSimBtn.addEventListener('click', resetToSetup);
  newMatrixSimBtn.addEventListener('click', resetToSetup);

  importBtn.addEventListener('click', importDeck);
  simulateBtn.addEventListener('click', runSimulation);
  simModeSelect.addEventListener('change', () => { applyModeToUi(); updateStepper(); });
  applyModeToUi();
  updateStepper();

  window.addEventListener('online', updateOfflineNotice);
  window.addEventListener('offline', updateOfflineNotice);
  updateOfflineNotice();

  registerServiceWorker();

  setStatus('Setting up...');
  try {
    await engine.init();
  } catch (err) {
    setStatus('Could not start the simulator: ' + err.message, true);
    return;
  }

  simulateBtn.disabled = false;
  await loadDecks();
  updateStepper();
}

start();
