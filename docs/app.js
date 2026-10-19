import { engine, RUN_SIZES } from './engine.js';

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
  decks: document.getElementById('panel-decks'),
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
const seedInput = document.getElementById('seedInput');
const winrateNumber = document.getElementById('winrateNumber');
const winrateSub = document.getElementById('winrateSub');
const winrateMeta = document.getElementById('winrateMeta');
const gameList = document.getElementById('gameList');
const gameListNote = document.getElementById('gameListNote');
const lossDetails = document.getElementById('lossDetails');
const lossList = document.getElementById('lossList');
const optimization = document.getElementById('optimization');
const opponentDecklist = document.getElementById('opponentDecklist');
const recommendation = document.getElementById('recommendation');

const matchResultsSection = document.getElementById('matchResults');
const matchBannedWarnings = document.getElementById('matchBannedWarnings');
const matchWinrateNumber = document.getElementById('matchWinrateNumber');
const matchWinrateSub = document.getElementById('matchWinrateSub');
const matchWinrateMeta = document.getElementById('matchWinrateMeta');
const matchList = document.getElementById('matchList');
const matchOptimization = document.getElementById('matchOptimization');
const matchOpponentDecklist = document.getElementById('matchOpponentDecklist');
const matchRecommendation = document.getElementById('matchRecommendation');

const matrixResultsSection = document.getElementById('matrixResults');
const matrixBannedWarnings = document.getElementById('matrixBannedWarnings');
const matrixAverageNumber = document.getElementById('matrixAverageNumber');
const matrixTable = document.getElementById('matrixTable');
const matrixMeta = document.getElementById('matrixMeta');

const offlineNotice = document.getElementById('offlineNotice');

// Labels for the one shared "Simulate" button, keyed by mode - so adding a
// future mode only means adding one entry here, not more branching below.
// The counts come from engine.js (RUN_SIZES).
const MODE_BUTTON_LABEL = {
  single: `Simulate ${RUN_SIZES.single} games`,
  match:  `Simulate ${RUN_SIZES.match} best-of-3 matches`,
  matrix: 'Run matchup matrix',
};

// The game log only lists the first games; the winrate and the loss
// breakdown always cover all of them.
const GAME_LOG_LIMIT = 50;

const LOSS_CATEGORY_LABEL = {
  BurnOut: 'Burn Out',
  MightMismatch: 'Out-classed on board Might',
  EnergyUnspent: 'Energy left unspent early',
  HandClogged: 'Cards stuck in hand',
  NeverLed: 'Never took the lead',
  CloseLoss: 'Lost by a single point',
  Tempo: 'Fell behind on tempo',
};

const importCategory = document.getElementById('importCategory');
const importName = document.getElementById('importName');
const importText = document.getElementById('importText');
const importBtn = document.getElementById('importBtn');
const importStatus = document.getElementById('importStatus');
const importResult = document.getElementById('importResult');
const importStorageNote = document.getElementById('importStorageNote');

// Cached, richer copies of the last engine.listDecks() payload (id + name +
// legend), kept alongside the plain <select> elements above. The selects
// stay the real source of truth for which deck is picked (every existing
// render/simulate function still just reads myDeckSelect.value/
// opponentDeckSelect.value) - these two just feed the deck-picker overlay
// below without a second call into the engine.
let myDecksCache = [];
let opponentsCache = {};

// The run the results on screen came from (decks, mode, seed) - what a
// replay re-runs to rebuild one of its games.
let lastRun = null;

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

    // Keep the current picks when the list is refreshed (after an import or
    // an edit), as long as those decks still exist.
    const previousMy = myDeckSelect.value;
    const previousOpponent = opponentDeckSelect.value;

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

    if (myDecksCache.some(d => d.id === previousMy)) myDeckSelect.value = previousMy;
    if (Object.values(opponentsCache).flat().some(d => d.id === previousOpponent)) opponentDeckSelect.value = previousOpponent;

    if (!myDeckSelect.options.length || !opponentDeckSelect.options.length) {
      setStatus('No decks found - import one from the "Import" tab.', true);
      simulateBtn.disabled = true;
      return;
    }
    setStatus('');
  } catch (err) {
    setStatus('Could not load decks: ' + err.message, true);
  } finally {
    updateTriggerPreview('my');
    updateTriggerPreview('opponent');
    populateEditorDeckSelect();
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

// "95% range 51.8% - 58% · seed 123" - how far this winrate could move on
// another run, and the seed that replays this one exactly.
function runMetaText(low, high, seed, extra) {
  const parts = [];
  if (low !== undefined) parts.push(`95% range ${low}% - ${high}%`);
  if (extra) parts.push(extra);
  parts.push(`seed ${seed}`);
  return parts.join(' · ');
}

function renderWinrate(data) {
  winrateNumber.textContent = data.winrate + '%';
  winrateNumber.classList.toggle('good', data.winrate >= 50);
  winrateNumber.classList.toggle('bad', data.winrate < 50);
  const drawsText = data.draws ? `, ${data.draws} draws` : '';
  winrateSub.textContent = `${data.wins} / ${data.totalGames} wins${drawsText} - ${data.myDeckName} vs ${data.opponentDeckName}`;
  winrateMeta.textContent = runMetaText(data.winrateLow, data.winrateHigh, data.seed);
}

function resultBadge(win, draw, labels) {
  const badge = document.createElement('span');
  badge.className = 'badge ' + (draw ? 'draw' : (win ? 'win' : 'loss'));
  badge.textContent = draw ? labels[2] : (win ? labels[0] : labels[1]);
  return badge;
}

// One clickable row of a game/match list (opens the replay).
function logRow(text, badge, onClick) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'log-row';
  const span = document.createElement('span');
  span.textContent = text;
  btn.appendChild(span);
  btn.appendChild(badge);
  btn.addEventListener('click', onClick);
  li.appendChild(btn);
  return li;
}

function renderGameList(games) {
  gameList.innerHTML = '';
  const shown = games.slice(0, GAME_LOG_LIMIT);
  gameListNote.textContent = (games.length > shown.length ? `Showing the first ${shown.length} of ${games.length} games. ` : '')
    + 'Tap a game to replay it turn by turn.';
  shown.forEach(g => {
    gameList.appendChild(logRow(
      `Game ${g.n}: You ${g.scoreA} - ${g.scoreB} Opponent`,
      resultBadge(g.win, g.draw, ['WIN', 'LOSS', 'DRAW']),
      () => openReplay([{ label: `Game ${g.n}`, index: g.index, score: `${g.scoreA}-${g.scoreB}` }], 0),
    ));
  });
}

// One line per loss reason: how many losses it explains, with the first
// game's full explanation as the example.
function renderLossBreakdown(games) {
  const losses = games.filter(g => !g.win && !g.draw && g.lossCategory);
  if (losses.length === 0) {
    lossDetails.classList.add('hidden');
    return;
  }
  const byCategory = new Map();
  losses.forEach(g => {
    if (!byCategory.has(g.lossCategory)) byCategory.set(g.lossCategory, { count: 0, example: g });
    byCategory.get(g.lossCategory).count++;
  });

  lossDetails.classList.remove('hidden');
  lossList.innerHTML = '';
  [...byCategory.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([category, info]) => {
      const pct = Math.round((info.count / losses.length) * 100);
      const li = document.createElement('li');
      li.innerHTML = `<strong>${LOSS_CATEGORY_LABEL[category] || category}</strong>`
        + ` <span class="loss-share">${info.count} of ${losses.length} losses (${pct}%)</span>`
        + `<div class="loss-example">e.g. game ${info.example.n}: ${info.example.lossReason}</div>`;
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
    const nameCell = r => `<button type="button" class="card-link" data-card="${escapeHtml(r.name)}" data-tag="${escapeHtml(r.tag || '')}">${escapeHtml(r.name)}</button>`;
    if (type === 'Unit' || type === 'Spell' || type === 'Gear') {
      html += '<tr><th>Qty</th><th>Name</th><th>E</th><th>P</th><th>M</th><th>Domain</th></tr>';
      rows.forEach(r => {
        html += `<tr><td>${r.quantity}</td><td>${nameCell(r)}</td><td>${r.energy}</td><td>${r.power}</td><td>${r.might}</td><td>${r.domain || ''}</td></tr>`;
      });
    } else {
      html += '<tr><th>Qty</th><th>Name</th><th>Domain</th></tr>';
      rows.forEach(r => {
        html += `<tr><td>${r.quantity}</td><td>${nameCell(r)}</td><td>${r.domain || ''}</td></tr>`;
      });
    }
    html += '</table></div>';
  });
  target.innerHTML = html;
}

function renderMatchList(matches) {
  matchList.innerHTML = '';
  matches.forEach(m => {
    const games = (m.games || []).map((g, i) => ({ label: `Game ${i + 1}`, index: g.index, score: `${g.scoreA}-${g.scoreB}` }));
    matchList.appendChild(logRow(
      `Match ${m.n}: You ${m.gamesWonA} - ${m.gamesWonB} Opponent (games)`,
      resultBadge(m.win, m.draw, ['WON', 'LOST', 'DRAW']),
      () => openReplay(games, 0, `Match ${m.n}`),
    ));
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
  matrixMeta.textContent = runMetaText(undefined, undefined, data.seed, `${data.gamesPerOpponent} games per opponent, same seed for each`);

  const rows = data.rows || [];
  if (rows.length === 0) {
    matrixTable.innerHTML = '<p>No saved opponent decks were found. Import one from the "Import" tab.</p>';
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
        + `<span class="matrix-range" title="95% range">${r.winrateLow}-${r.winrateHigh}%</span>`
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
  matchWinrateMeta.textContent = runMetaText(data.matchWinrateLow, data.matchWinrateHigh, data.seed);
}

// Blank -> undefined (the engine picks a random seed); otherwise the number.
function seedFromInput() {
  const raw = (seedInput.value || '').trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error('The seed must be a whole number (or leave it blank).');
  return Number(raw);
}

async function runSingleOpponentSimulation(myDeckId, opponentDeckId, seed) {
  const data = await engine.simulate(myDeckId, opponentDeckId, { seed });
  lastRun = { mode: 'single', myDeckId, opponentDeckId, seed: data.seed, myDeckName: data.myDeckName, opponentDeckName: data.opponentDeckName };

  renderBannedWarnings(data, bannedWarnings);
  renderWinrate(data);
  renderGameList(data.games);
  renderLossBreakdown(data.games);
  renderOptimization(data.optimization, optimization);
  renderRecommendation(data.recommendation, recommendation);
  renderDecklist(data.opponentDecklist, opponentDecklist);
  resultsSection.classList.remove('hidden');
}

async function runMatchSimulation(myDeckId, opponentDeckId, seed) {
  const data = await engine.simulateMatch(myDeckId, opponentDeckId, { seed });
  lastRun = { mode: 'match', myDeckId, opponentDeckId, seed: data.seed, myDeckName: data.myDeckName, opponentDeckName: data.opponentDeckName };

  renderBannedWarnings(data, matchBannedWarnings);
  renderMatchWinrate(data);
  renderMatchList(data.matches);
  renderOptimization(data.optimization, matchOptimization);
  renderRecommendation(data.recommendation, matchRecommendation);
  renderDecklist(data.opponentDecklist, matchOpponentDecklist);
  matchResultsSection.classList.remove('hidden');
}

async function runMatchupMatrix(myDeckId, seed) {
  const data = await engine.matchupMatrix(myDeckId, { seed });

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

  let seed;
  try {
    seed = seedFromInput();
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  simulateBtn.disabled = true;
  setStatus(mode === 'matrix' ? 'Running the matchup matrix...' : 'Simulating...');
  resultsSection.classList.add('hidden');
  matchResultsSection.classList.add('hidden');
  matrixResultsSection.classList.add('hidden');

  try {
    // Let the status line paint before the (synchronous) simulation runs.
    await new Promise(resolve => setTimeout(resolve, 30));
    if (mode === 'match') {
      await runMatchSimulation(myDeckId, opponentDeckId, seed);
    } else if (mode === 'matrix') {
      await runMatchupMatrix(myDeckId, seed);
    } else {
      await runSingleOpponentSimulation(myDeckId, opponentDeckId, seed);
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
    + `${data.overwritten ? ' (replaced an existing deck with this name)' : ''}.</div>`;

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

// Official card art, hotlinked from Piltover Archive's public card gallery
// (https://piltoverarchive.com) - a fan-run card gallery for this game, not
// something we host - using the Legend's collector code from
// carddatabase.json, so any Legend in the database gets its art without a
// per-legend table. A Legend without a code (or offline, before its image
// was ever viewed) falls back to a plain initial-letter placeholder. sw.js
// caches each image the first time it's loaded online.
function legendArtUrl(legendName) {
  if (!legendName) return null;
  const info = engine.cardInfo(legendName);
  return info ? info.imageUrl : null;
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

// ===================== Deck editor ("Decks" tab) =====================
//
// Edits one deck's rows in memory (`editor.rows`), re-checking legality on
// every change, and only writes through engine.saveDeck when asked - so on
// the PC nothing touches the CSV until "Save changes".

const editorDeckSelect = document.getElementById('editorDeck');
const editorBody = document.getElementById('editorBody');
const editorCounts = document.getElementById('editorCounts');
const editorProblems = document.getElementById('editorProblems');
const editorRowsEl = document.getElementById('editorRows');
const cardSearch = document.getElementById('cardSearch');
const cardResults = document.getElementById('cardResults');
const editorSaveBtn = document.getElementById('editorSave');
const editorSaveAsToggle = document.getElementById('editorSaveAsToggle');
const editorDeleteBtn = document.getElementById('editorDelete');
const editorSaveAsPanel = document.getElementById('editorSaveAs');
const saveAsName = document.getElementById('saveAsName');
const saveAsCategory = document.getElementById('saveAsCategory');
const saveAsBtn = document.getElementById('saveAsBtn');
const editorStatus = document.getElementById('editorStatus');
const editorStorageNote = document.getElementById('editorStorageNote');

const EDITOR_TYPE_ORDER = ['Legend', 'Battlefield', 'Rune', 'Unit', 'Spell', 'Gear'];
const EDITOR_TYPE_TITLE = { Legend: 'Legend', Battlefield: 'Battlefields', Rune: 'Runes', Unit: 'Units', Spell: 'Spells', Gear: 'Gear' };
const TAGGABLE_TYPES = ['Unit', 'Spell', 'Gear'];

let editor = null; // { id, name, category, rows, dirty }

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setEditorStatus(text, isError) {
  editorStatus.textContent = text || '';
  editorStatus.classList.toggle('error', !!isError);
}

function allDeckEntries() {
  const opponents = Object.keys(opponentsCache).flatMap(cat => opponentsCache[cat].map(d => ({ ...d, group: `Opponents - ${cat}` })));
  return myDecksCache.map(d => ({ ...d, group: 'Your decks' })).concat(opponents);
}

function populateEditorDeckSelect() {
  if (!editorDeckSelect) return;
  const keep = editor ? editor.id : editorDeckSelect.value;
  editorDeckSelect.innerHTML = '<option value="">Choose a deck&hellip;</option>';
  const groups = new Map();
  allDeckEntries().forEach(d => {
    if (!groups.has(d.group)) {
      const og = document.createElement('optgroup');
      og.label = d.group;
      groups.set(d.group, og);
      editorDeckSelect.appendChild(og);
    }
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    groups.get(d.group).appendChild(opt);
  });
  editorDeckSelect.value = allDeckEntries().some(d => d.id === keep) ? keep : '';
}

function confirmDiscardEdits() {
  return !editor || !editor.dirty || window.confirm(`Discard your unsaved changes to "${editor.name}"?`);
}

async function openEditorDeck(id) {
  setEditorStatus('');
  editorSaveAsPanel.classList.add('hidden');
  cardSearch.value = '';
  cardResults.innerHTML = '';
  if (!id) {
    editor = null;
    editorBody.classList.add('hidden');
    return;
  }
  try {
    const deck = await engine.getDeck(id);
    editor = { ...deck, dirty: false };
    editorBody.classList.remove('hidden');
    renderEditor();
  } catch (err) {
    editor = null;
    editorBody.classList.add('hidden');
    setEditorStatus('Could not open the deck: ' + err.message, true);
  }
}

function markEditorDirty() {
  editor.dirty = true;
  setEditorStatus('Unsaved changes.');
}

function legendDomains() {
  const legend = editor && editor.rows.find(r => r.Type === 'Legend');
  return legend && legend.Domain ? legend.Domain.split('/').map(s => s.trim()) : [];
}

function cardStatsText(r) {
  if (TAGGABLE_TYPES.includes(r.Type)) {
    return [`${r.Energy ?? 0}E`, Number(r.Power) ? `${r.Power}P` : null, `${r.Might ?? 0}M`, r.Domain || null].filter(Boolean).join(' · ');
  }
  return r.Domain || '';
}

function renderEditorChecks() {
  const check = engine.checkDeck(editor.rows);
  const chip = (label, value, ok) => `<span class="count-chip ${ok ? 'ok' : 'bad'}">${label} <strong>${value}</strong></span>`;
  editorCounts.innerHTML =
    chip('Legend', `${check.legendCount}/1`, check.legendCount === 1)
    + chip('Battlefields', `${check.battlefieldCount}/3`, check.battlefieldCount === 3)
    + chip('Runes', `${check.runeTotal}/12`, check.runeTotal === 12)
    + chip('Main deck', `${check.mainDeckTotal}/40+`, check.mainDeckTotal >= 40);
  editorProblems.innerHTML = check.problems.map(p => `<li>${escapeHtml(p)}</li>`).join('');
  editorProblems.classList.toggle('hidden', check.problems.length === 0);
}

function renderEditor() {
  let html = '';
  EDITOR_TYPE_ORDER.forEach(type => {
    const indexes = editor.rows
      .map((r, i) => i)
      .filter(i => editor.rows[i].Type === type)
      .sort((a, b) => editor.rows[a].Name.localeCompare(editor.rows[b].Name));
    if (indexes.length === 0) return;
    const total = indexes.reduce((s, i) => s + (parseInt(editor.rows[i].Quantity, 10) || 0), 0);
    html += `<div class="editor-group"><h4>${EDITOR_TYPE_TITLE[type]} <span class="editor-group-count">${total}</span></h4>`;
    indexes.forEach(i => {
      const r = editor.rows[i];
      const info = engine.cardInfo(r.Name, r.Tag);
      const fromText = info && (info.modeled === 'text' || info.modeled === 'partial');
      let tagInput = '';
      if (TAGGABLE_TYPES.includes(r.Type)) {
        tagInput = fromText
          ? `<span class="modeled-chip${info.modeled === 'partial' ? ' partial' : ''}" title="${escapeHtml(info.abilityText)}">${info.modeled === 'partial' ? 'card text (part)' : 'card text'}</span>`
          : `<input type="text" class="editor-tag" data-index="${i}" value="${escapeHtml(r.Tag)}" placeholder="Tag" aria-label="Tag for ${escapeHtml(r.Name)}" autocomplete="off">`;
      }
      const keywords = info && info.keywords.length ? ` · ${info.keywords.join(', ')}` : '';
      html += `<div class="editor-row${tagInput ? ' has-tag' : ''}">`
        + `<div class="editor-card"><button type="button" class="card-link editor-card-name" data-card="${escapeHtml(r.Name)}" data-tag="${escapeHtml(r.Tag || '')}">${escapeHtml(r.Name)}</button>`
        + `<span class="editor-card-stats">${escapeHtml(cardStatsText(r) + keywords)}</span></div>`
        + tagInput
        + `<div class="qty-control">`
        + `<button type="button" class="qty-btn" data-action="dec" data-index="${i}" aria-label="One less ${escapeHtml(r.Name)}">&minus;</button>`
        + `<span class="qty-value">${r.Quantity}</span>`
        + `<button type="button" class="qty-btn" data-action="inc" data-index="${i}" aria-label="One more ${escapeHtml(r.Name)}">+</button>`
        + `</div></div>`;
    });
    html += '</div>';
  });
  editorRowsEl.innerHTML = html || '<p class="import-help">This deck has no cards yet - add some below.</p>';
  renderEditorChecks();
}

function changeQuantity(index, delta) {
  const row = editor.rows[index];
  row.Quantity = (parseInt(row.Quantity, 10) || 0) + delta;
  if (row.Quantity <= 0) editor.rows.splice(index, 1);
  markEditorDirty();
  renderEditor();
}

function addCardToDeck(name) {
  const existing = editor.rows.find(r => r.Name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.Quantity = (parseInt(existing.Quantity, 10) || 0) + 1;
  } else {
    editor.rows.push(engine.cardRow(name));
  }
  markEditorDirty();
  renderEditor();
}

function renderCardResults() {
  const q = cardSearch.value.trim();
  if (q.length < 2) {
    cardResults.innerHTML = '';
    return;
  }
  const results = engine.searchCards(q, { domains: legendDomains(), limit: 15 });
  if (results.length === 0) {
    cardResults.innerHTML = '<li class="card-results-empty">No matching card in this Legend\'s domains.</li>';
    return;
  }
  cardResults.innerHTML = results.map(c => {
    const stats = cardStatsText({ Type: c.type, Energy: c.energy, Power: c.power, Might: c.might, Domain: c.domain });
    return `<li><button type="button" class="card-result" data-name="${escapeHtml(c.name)}">`
      + `<span class="card-result-name">${escapeHtml(c.name)}</span>`
      + `<span class="card-result-meta">${escapeHtml(c.type)}${stats ? ' · ' + escapeHtml(stats) : ''}</span>`
      + `<span class="card-result-add">+ Add</span></button></li>`;
  }).join('');
}

async function saveEditorDeck() {
  setEditorStatus('Saving...');
  editorSaveBtn.disabled = true;
  try {
    await engine.saveDeck({ id: editor.id, rows: editor.rows });
    editor.dirty = false;
    await loadDecks();
    setEditorStatus(engine.storageKind === 'files' ? `Saved to Decks/${editor.id}.csv.` : 'Saved.');
  } catch (err) {
    setEditorStatus('Error: ' + err.message, true);
  } finally {
    editorSaveBtn.disabled = false;
  }
}

async function saveEditorDeckAsNew() {
  const category = saveAsCategory.value;
  const name = saveAsName.value;
  if (!name.trim()) {
    setEditorStatus('Give the new deck a name first.', true);
    return;
  }
  let target;
  try {
    target = engine.deckIdFor(category, name, 'New Deck');
  } catch (err) {
    setEditorStatus('Error: ' + err.message, true);
    return;
  }
  if (allDeckEntries().some(d => d.id === target.id) &&
      !window.confirm(`A deck called "${target.name}" already exists there. Replace it?`)) {
    return;
  }
  setEditorStatus('Saving...');
  saveAsBtn.disabled = true;
  try {
    const saved = await engine.saveDeck({ category, name, rows: editor.rows });
    editor.dirty = false;
    await loadDecks();
    editorDeckSelect.value = saved.id;
    await openEditorDeck(saved.id);
    setEditorStatus(`Saved as "${saved.name}".`);
  } catch (err) {
    setEditorStatus('Error: ' + err.message, true);
  } finally {
    saveAsBtn.disabled = false;
  }
}

async function deleteEditorDeck() {
  const where = engine.storageKind === 'files'
    ? `This deletes Decks/${editor.id}.csv on this PC.`
    : 'This removes it from this device.';
  if (!window.confirm(`Delete "${editor.name}"? ${where}`)) return;
  try {
    const name = editor.name;
    await engine.deleteDeck(editor.id);
    editor = null;
    await loadDecks();
    await openEditorDeck('');
    setEditorStatus(`Deleted "${name}".`);
  } catch (err) {
    setEditorStatus('Error: ' + err.message, true);
  }
}

function initDeckEditor() {
  if (!editorDeckSelect) return;

  editorDeckSelect.addEventListener('change', () => {
    if (!confirmDiscardEdits()) {
      editorDeckSelect.value = editor.id;
      return;
    }
    openEditorDeck(editorDeckSelect.value);
  });

  editorRowsEl.addEventListener('click', evt => {
    const btn = evt.target.closest('.qty-btn');
    if (!btn) return;
    changeQuantity(Number(btn.dataset.index), btn.dataset.action === 'inc' ? 1 : -1);
  });

  // Tags are typed in place: update the row and the checks, but don't
  // re-render the rows (that would steal the input's focus).
  editorRowsEl.addEventListener('input', evt => {
    const input = evt.target.closest('.editor-tag');
    if (!input) return;
    editor.rows[Number(input.dataset.index)].Tag = input.value;
    markEditorDirty();
    renderEditorChecks();
  });

  let searchTimer = null;
  cardSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderCardResults, 150);
  });
  cardResults.addEventListener('click', evt => {
    const btn = evt.target.closest('.card-result');
    if (btn) addCardToDeck(btn.dataset.name);
  });

  editorSaveBtn.addEventListener('click', saveEditorDeck);
  editorSaveAsToggle.addEventListener('click', () => {
    editorSaveAsPanel.classList.toggle('hidden');
    if (!editorSaveAsPanel.classList.contains('hidden')) {
      saveAsName.value = `${editor.name} copy`;
      saveAsCategory.value = editor.category || 'MyDeck';
      saveAsName.focus();
    }
  });
  saveAsBtn.addEventListener('click', saveEditorDeckAsNew);
  editorDeleteBtn.addEventListener('click', deleteEditorDeck);

  window.addEventListener('beforeunload', evt => {
    if (editor && editor.dirty) {
      evt.preventDefault();
      evt.returnValue = '';
    }
  });
}

// ===================== Replay (turn by turn) =====================
//
// A game isn't stored: the engine re-runs the same seeded run up to that
// game and records its events (engine.replayGame).

const replayOverlay = document.getElementById('replayOverlay');
const replayTitle = document.getElementById('replayTitle');
const replayTabs = document.getElementById('replayTabs');
const replayBody = document.getElementById('replayBody');
const replayClose = document.getElementById('replayClose');

let replayGames = [];
let replayHeading = '';

function closeOverlay(overlay) {
  overlay.classList.add('hidden');
  if (![replayOverlay, cardOverlay, deckPickerOverlay].some(o => o && !o.classList.contains('hidden'))) {
    document.body.classList.remove('deck-picker-open');
  }
}

function openReplay(games, position, heading = '') {
  if (!lastRun || !games.length) return;
  replayGames = games;
  replayHeading = heading;
  replayTabs.innerHTML = games.length > 1
    ? games.map((g, i) => `<button type="button" class="pill" data-pos="${i}">${escapeHtml(g.label)} (${escapeHtml(g.score)})</button>`).join('')
    : '';
  replayTabs.classList.toggle('hidden', games.length < 2);
  replayOverlay.classList.remove('hidden');
  document.body.classList.add('deck-picker-open');
  showReplayGame(position);
}

async function showReplayGame(position) {
  const game = replayGames[position];
  Array.from(replayTabs.querySelectorAll('.pill')).forEach(p => p.classList.toggle('active', Number(p.dataset.pos) === position));
  replayTitle.textContent = `${replayHeading ? replayHeading + ' - ' : ''}${game.label}: You ${game.score.replace('-', ' - ')} Opponent`;
  replayBody.innerHTML = '<p class="import-help">Replaying...</p>';
  try {
    const replay = await engine.replayGame(lastRun.myDeckId, lastRun.opponentDeckId, { mode: lastRun.mode, seed: lastRun.seed, gameIndex: game.index });
    renderReplay(replay.events);
  } catch (err) {
    replayBody.innerHTML = `<p class="status error">Could not replay this game: ${escapeHtml(err.message)}</p>`;
  }
}

// Events grouped by round; each player's turn opens with its header line.
function renderReplay(events) {
  let html = '';
  let round = -1;
  for (const e of events) {
    if (e.round !== round) {
      if (round !== -1) html += '</ol></section>';
      round = e.round;
      html += `<section class="replay-round"><h4>${round === 0 ? 'Setup' : `Round ${round}`}</h4><ol class="replay-events">`;
    }
    const side = e.who === 'You' ? 'you' : (e.who === 'Opponent' ? 'opp' : 'neutral');
    const turnHeader = /^--- turn (\d+) \(score (\d+)-(\d+)\) ---$/.exec(e.text);
    if (turnHeader) {
      html += `<li class="replay-turn ${side}">${e.who === 'You' ? 'Your' : "Opponent's"} turn ${turnHeader[1]} <span>score ${turnHeader[2]}-${turnHeader[3]}</span></li>`;
      continue;
    }
    const who = e.who ? `<span class="replay-who">${e.who === 'You' ? 'You' : 'Opp'}</span>` : '';
    html += `<li class="replay-event ${side}">${who}<span>${escapeHtml(e.text)}</span></li>`;
  }
  if (round !== -1) html += '</ol></section>';
  replayBody.innerHTML = html || '<p class="import-help">No events recorded.</p>';
  replayBody.scrollTop = 0;
}

function initReplay() {
  replayClose.addEventListener('click', () => closeOverlay(replayOverlay));
  replayOverlay.addEventListener('click', evt => {
    if (evt.target === replayOverlay) closeOverlay(replayOverlay);
  });
  replayTabs.addEventListener('click', evt => {
    const pill = evt.target.closest('.pill');
    if (pill) showReplayGame(Number(pill.dataset.pos));
  });
}

// ===================== Card viewer =====================
//
// The official card image (it carries the full rules text) plus what the
// simulator models of the card.

const cardOverlay = document.getElementById('cardOverlay');
const cardTitle = document.getElementById('cardTitle');
const cardBody = document.getElementById('cardBody');
const cardClose = document.getElementById('cardClose');

const MODELED_LABEL = {
  text: 'Modeled from the card text',
  partial: 'Partly modeled from the card text',
  tag: 'Modeled from the deck\'s Tag',
  none: 'Its rules text isn\'t modeled - only its cost, Might and keywords count',
};

function openCard(name, tag = '') {
  const info = engine.cardInfo(name, tag);
  cardTitle.textContent = name;
  if (!info) {
    cardBody.innerHTML = '<p class="import-help">This card isn\'t in the card database.</p>';
  } else {
    cardBody.innerHTML = `<div class="card-view">`
      + (info.imageUrl ? `<img class="card-view-img${info.type === 'Battlefield' ? ' landscape' : ''}" src="${info.imageUrl}" alt="${escapeHtml(info.name)}" referrerpolicy="no-referrer" onerror="this.remove()">` : '')
      + `<div class="card-view-info">`
      + `<p class="card-view-type">${escapeHtml(info.type)}${info.code ? ` · ${escapeHtml(info.code)}` : ''}</p>`
      + (info.keywords.length ? `<p class="card-view-keywords">${info.keywords.map(k => `<span class="count-chip">${escapeHtml(k)}</span>`).join(' ')}</p>` : '')
      + `<p class="card-view-modeled ${info.modeled}">${MODELED_LABEL[info.modeled]}</p>`
      + (info.abilityText ? `<p class="card-view-ability">${escapeHtml(info.abilityText)}</p>` : '')
      + `</div></div>`;
  }
  cardOverlay.classList.remove('hidden');
  document.body.classList.add('deck-picker-open');
}

function initCardViewer() {
  cardClose.addEventListener('click', () => closeOverlay(cardOverlay));
  cardOverlay.addEventListener('click', evt => {
    if (evt.target === cardOverlay) closeOverlay(cardOverlay);
  });
  // Any card name rendered as .card-link opens the viewer.
  document.addEventListener('click', evt => {
    const link = evt.target.closest('.card-link');
    if (link) openCard(link.dataset.card, link.dataset.tag || '');
  });
  document.addEventListener('keydown', evt => {
    if (evt.key !== 'Escape') return;
    if (!cardOverlay.classList.contains('hidden')) closeOverlay(cardOverlay);
    else if (!replayOverlay.classList.contains('hidden')) closeOverlay(replayOverlay);
  });
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

// On the PC (WebServer.ps1) there's nothing to cache for offline use, and a
// cache-first service worker would keep serving old copies of files edited
// on disk - so drop any registration a previous static serve of docs/ on
// this same address may have left behind.
function unregisterServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(reg => reg.unregister()))
    .catch(() => {});
}

// ===================== Storage-specific wording =====================

function applyStorageKindToUi() {
  if (engine.storageKind !== 'files') return;
  if (importStorageNote) importStorageNote.textContent = 'Imported decks are saved as CSV files under the Decks folder on this PC.';
  if (editorStorageNote) editorStorageNote.textContent = 'Changes are saved to the deck\'s CSV file under the Decks folder on this PC.';
}

// ===================== Startup =====================

// Mode-card descriptions show the run sizes from engine.js.
function applyRunSizes() {
  document.querySelectorAll('[data-run-size]').forEach(el => {
    el.textContent = RUN_SIZES[el.dataset.runSize];
  });
}

async function start() {
  applyRunSizes();
  initTopNav();
  initModeCards();
  initDeckPicker();
  initDeckEditor();
  initReplay();
  initCardViewer();
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

  setStatus('Setting up...');
  try {
    await engine.init();
  } catch (err) {
    setStatus('Could not start the simulator: ' + err.message, true);
    return;
  }

  if (engine.storageKind === 'files') unregisterServiceWorkers();
  else registerServiceWorker();
  applyStorageKindToUi();

  simulateBtn.disabled = false;
  await loadDecks();
  updateStepper();
}

start();
