import { engine, RUN_SIZES } from './engine.js';

const myDeckSelect = document.getElementById('myDeck');
const opponentDeckSelect = document.getElementById('opponentDeck');
const opponentField = document.getElementById('opponentField');
const simModeSelect = document.getElementById('simMode');
const simulateBtn = document.getElementById('simulateBtn');
const statusLine = document.getElementById('statusLine');
const resultsSection = document.getElementById('results');

// ---- Top-level nav (Simulate / Meta / Journal / Decks / Import) ----
const topNav = document.getElementById('topNav');
const topPanels = {
  simulate: document.getElementById('panel-simulate'),
  meta: document.getElementById('panel-meta'),
  journal: document.getElementById('panel-journal'),
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
    addMetaOpponentOption();

    if (myDecksCache.some(d => d.id === previousMy)) myDeckSelect.value = previousMy;
    if (opponentEntries().some(d => d.id === previousOpponent)) opponentDeckSelect.value = previousOpponent;

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
    populateMyDeckSelects();
  }
}

// The saved opponent decks, plus the tournament list picked from the Meta
// tab (if any).
function opponentEntries() {
  const saved = Object.values(opponentsCache).flat();
  return metaOpponentEntry ? saved.concat([metaOpponentEntry]) : saved;
}

// The "Your deck" pickers outside the Simulate tab (field test, journal).
function populateMyDeckSelects() {
  [fieldTestDeckSelect, jMyDeck, jCompareDeck].forEach(select => {
    if (!select) return;
    const keep = select.value || myDeckSelect.value;
    select.innerHTML = '';
    myDecksCache.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      select.appendChild(opt);
    });
    if (myDecksCache.some(d => d.id === keep)) select.value = keep;
  });
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
    // Tournament data and the journal load the first time their tab opens.
    if (btn.dataset.panel === 'meta') openMetaPanel();
    if (btn.dataset.panel === 'journal') openJournalPanel();
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
  const flatCache = target === 'my' ? myDecksCache : opponentEntries();
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
    + chip('Main deck', `${check.mainDeckTotal}/40+`, check.mainDeckTotal >= 40)
    + chip('Champion', check.champion ? '1/1' : '0/1', !!check.champion);
  editorProblems.innerHTML = check.problems.map(p => `<li>${escapeHtml(p)}</li>`).join('');
  editorProblems.classList.toggle('hidden', check.problems.length === 0);
}

function renderEditor() {
  let html = '';
  const championOptions = engine.championOptions(editor.rows);
  const chosen = engine.checkDeck(editor.rows).champion;
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
      let championChip = '';
      if (r.Name === chosen) {
        championChip = '<span class="champion-chip chosen">Chosen Champion</span>';
      } else if (championOptions.includes(r.Name)) {
        championChip = `<button type="button" class="champion-chip" data-champion-index="${i}">Make Chosen Champion</button>`;
      }
      html += `<div class="editor-row${tagInput ? ' has-tag' : ''}">`
        + `<div class="editor-card"><button type="button" class="card-link editor-card-name" data-card="${escapeHtml(r.Name)}" data-tag="${escapeHtml(r.Tag || '')}">${escapeHtml(r.Name)}</button>`
        + `<span class="editor-card-stats">${escapeHtml(cardStatsText(r) + keywords)}</span>${championChip}</div>`
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

// The engine takes the deck's first eligible row as the Chosen Champion, so
// choosing one moves its row right after the Legend.
function chooseChampion(index) {
  const [row] = editor.rows.splice(index, 1);
  const legendIndex = editor.rows.findIndex(r => r.Type === 'Legend');
  editor.rows.splice(legendIndex + 1, 0, row);
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
    const champion = evt.target.closest('[data-champion-index]');
    if (champion) {
      chooseChampion(Number(champion.dataset.championIndex));
      return;
    }
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
  if (![replayOverlay, cardOverlay, deckPickerOverlay, metaDeckOverlay].some(o => o && !o.classList.contains('hidden'))) {
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
  keywords: 'Fully modeled - it has no rules text beyond its keywords',
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
      + `<p class="card-view-type">${info.supertype && info.supertype !== 'Token' ? `${escapeHtml(info.supertype)} ` : ''}${escapeHtml(info.type)}${info.code ? ` · ${escapeHtml(info.code)}` : ''}</p>`
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
    else if (!metaDeckOverlay.classList.contains('hidden')) closeOverlay(metaDeckOverlay);
  });
}

// ===================== Meta ("Meta" tab: tournament results) =====================
//
// docs/meta.json (built weekly by tools/build-meta-data.mjs from Riot's
// "Top Decks" articles) holds each event's Day 1 / Day 2 Legend counts and
// its published lists. A list plays as an opponent through its
// "meta:<event>/<n>" id, without being saved, or can be saved as a deck.

const metaEventSelect = document.getElementById('metaEvent');
const metaGenerated = document.getElementById('metaGenerated');
const metaHeader = document.getElementById('metaHeader');
const metaPanels = document.getElementById('metaPanels');
const metaShare = document.getElementById('metaShare');
const metaDecks = document.getElementById('metaDecks');
const metaTrend = document.getElementById('metaTrend');
const fieldTestDeckSelect = document.getElementById('fieldTestDeck');
const fieldTestBtn = document.getElementById('fieldTestBtn');
const fieldTestStatus = document.getElementById('fieldTestStatus');
const fieldTestResult = document.getElementById('fieldTestResult');
const metaDeckOverlay = document.getElementById('metaDeckOverlay');
const metaDeckTitle = document.getElementById('metaDeckTitle');
const metaDeckBody = document.getElementById('metaDeckBody');
const metaDeckClose = document.getElementById('metaDeckClose');

// How much of a list's card text the simulator plays, at a glance.
const COVERAGE_GOOD = 70;
const COVERAGE_FAIR = 40;

let metaLoaded = false;
let metaCurrent = null;        // the event on screen (engine.metaEvent)
let metaOpponentEntry = null;  // a tournament list picked as the Simulate opponent

const shortLegend = name => (name || '').split(',')[0];

function coverageChip(c) {
  if (!c) return '';
  const level = c.fullPct >= COVERAGE_GOOD ? 'good' : (c.fullPct >= COVERAGE_FAIR ? 'fair' : 'low');
  const partial = c.partialPct ? ` +${c.partialPct}%` : '';
  return `<span class="coverage-chip ${level}" title="Card text modeled: ${c.fullPct}% fully${c.partialPct ? `, ${c.partialPct}% in part` : ''} (of ${c.total} cards)${c.legendModeled ? '' : '; the Legend\'s ability is not modeled'}">text ${c.fullPct}%${partial}</span>`;
}

function setFieldTestStatus(text, isError) {
  fieldTestStatus.textContent = text || '';
  fieldTestStatus.classList.toggle('error', !!isError);
}

async function openMetaPanel() {
  if (metaLoaded) return;
  metaLoaded = true;
  try {
    const data = await engine.metaEvents();
    if (!data.events.length) {
      metaHeader.innerHTML = '<p class="import-help">No tournament data yet - it arrives with the next weekly refresh.</p>';
      return;
    }
    metaGenerated.textContent = data.generated ? `Updated ${data.generated}; checked for new events every week.` : '';
    metaEventSelect.innerHTML = data.events.map(e =>
      `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} - ${escapeHtml(e.published)}${e.players ? ` (${e.players} players)` : ''}</option>`).join('');
    await showMetaEvent(data.events[0].id);
    await renderMetaTrend();
  } catch (err) {
    metaLoaded = false;
    metaHeader.innerHTML = `<p class="status error">Could not load the tournament data: ${escapeHtml(err.message)}</p>`;
  }
}

async function showMetaEvent(id) {
  metaCurrent = await engine.metaEvent(id);
  const e = metaCurrent;
  const counts = e.players ? `${e.players} players, ${e.day2Players} on Day 2` : 'No player counts published';
  metaHeader.innerHTML = `<p class="meta-header-line">${escapeHtml(counts)} · article of ${escapeHtml(e.published)} · `
    + `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Riot's article</a></p>`;
  renderMetaShare();
  renderMetaDecks();
  fieldTestResult.innerHTML = '';
  setFieldTestStatus('');
}

function renderMetaShare() {
  const rows = metaCurrent.share;
  if (!rows.length) {
    metaShare.innerHTML = '<p class="import-help">This article has no Day 1 / Day 2 table.</p>';
    return;
  }
  const max = Math.max(...rows.map(r => r.day2Pct), 1);
  let html = '<div class="share-head"><span>Legend</span><span>Day 2</span></div>';
  rows.forEach(r => {
    const conv = r.conversion === null ? '' : ` · ${r.conversion}&times;`;
    const cls = r.conversion === null ? '' : (r.conversion >= 1.2 ? ' up' : (r.conversion <= 0.8 ? ' down' : ''));
    html += `<div class="share-row">`
      + `<span class="share-name">${escapeHtml(r.label)}</span>`
      + `<span class="share-bar"><span style="width:${Math.round(100 * r.day2Pct / max)}%"></span></span>`
      + `<span class="share-num">${r.day2Pct}%</span>`
      + `<span class="share-sub${cls}">${r.day2} on Day 2 · Day 1 ${r.day1Pct}% (${r.day1})${conv}${r.top8 ? ` · ${r.top8} in Top 8` : ''}</span>`
      + `</div>`;
  });
  metaShare.innerHTML = html;
}

function metaDeckRow(d) {
  const place = d.top8 && d.overall ? `#${d.overall}` : (d.bestOf ? 'Best-Of' : '');
  return `<li><button type="button" class="log-row meta-deck-row" data-deck-id="${escapeHtml(d.id)}">`
    + `<span><strong>${escapeHtml(place)}</strong> ${escapeHtml(shortLegend(d.legend))} <span class="meta-player">${escapeHtml(d.player)}</span></span>`
    + (d.banned.length ? `<span class="coverage-chip low" title="Banned since: ${escapeHtml(d.banned.join(', '))}">${d.banned.length} banned</span>` : '')
    + `${coverageChip(d.coverage)}</button></li>`;
}

function renderMetaDecks() {
  const decks = metaCurrent.decks;
  const top8 = decks.filter(d => d.top8);
  const bestOf = decks.filter(d => !d.top8 && d.bestOf);
  const other = decks.filter(d => !d.top8 && !d.bestOf);
  let html = '';
  if (top8.length) html += `<h4 class="meta-group">Top 8</h4><ul class="game-list meta-deck-list">${top8.map(metaDeckRow).join('')}</ul>`;
  if (bestOf.length) html += `<h4 class="meta-group">Best-Of each Legend</h4><ul class="game-list meta-deck-list">${bestOf.map(metaDeckRow).join('')}</ul>`;
  if (other.length) html += `<h4 class="meta-group">Other lists</h4><ul class="game-list meta-deck-list">${other.map(metaDeckRow).join('')}</ul>`;
  metaDecks.innerHTML = html || '<p class="import-help">This article has no decklists.</p>';
}

async function openMetaDeck(id) {
  const entry = metaCurrent.decks.find(d => d.id === id);
  metaDeckTitle.textContent = entry ? entry.name : 'Tournament list';
  metaDeckBody.innerHTML = '<p class="import-help">Loading...</p>';
  metaDeckOverlay.classList.remove('hidden');
  document.body.classList.add('deck-picker-open');
  try {
    const list = await engine.metaDecklist(id);
    const c = list.coverage;
    let html = `<p class="import-help">${escapeHtml(entry.player)}`
      + (entry.top8 && entry.overall ? ` · finished #${entry.overall}` : '')
      + (entry.legendRank ? ` · best ${escapeHtml(shortLegend(entry.legend))} #${escapeHtml(entry.legendRank)}` : '')
      + (list.champion ? ` · Chosen Champion: ${escapeHtml(list.champion)}` : '') + '</p>';
    html += `<p class="import-help">${coverageChip(c)} The simulator plays ${c.fullPct}% of this list's card text${c.partialPct ? ` (and ${c.partialPct}% in part)` : ''}${c.legendModeled ? '' : ', not its Legend\'s ability'}; the rest counts only for its cost, Might and keywords.</p>`;
    if (list.unknown.length) html += `<p class="status error">Not in the card database (left out): ${escapeHtml(list.unknown.join(', '))}</p>`;
    if (list.banned.length) html += `<p class="status error">Banned since this event, so left out when simulating: ${escapeHtml(list.banned.join(', '))}.</p>`;
    html += `<div class="meta-deck-actions">`
      + `<button type="button" id="metaSimulateBtn">Simulate against it</button>`
      + `<div class="meta-save"><select id="metaSaveCategory" aria-label="Save to">`
      + ['Aggro', 'Midrange', 'Control'].map(cat => `<option value="${cat}">Opponents - ${cat}</option>`).join('')
      + `</select><button type="button" class="ghost-btn" id="metaSaveBtn">Save as opponent deck</button></div>`
      + `</div><div class="status" id="metaDeckStatus"></div>`;
    html += '<div id="metaDecklist"></div>';
    if (list.sideboard.length) {
      html += `<div class="deck-group"><h4>Sideboard</h4><table class="deck-table"><tr><th>Qty</th><th>Name</th></tr>`
        + list.sideboard.map(s => `<tr><td>${s.quantity}</td><td><button type="button" class="card-link" data-card="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button></td></tr>`).join('')
        + '</table></div>';
    }
    metaDeckBody.innerHTML = html;
    renderDecklist(list, document.getElementById('metaDecklist'));
    document.getElementById('metaSimulateBtn').addEventListener('click', () => simulateAgainstMeta(entry));
    document.getElementById('metaSaveBtn').addEventListener('click', () => saveMetaDeck(entry));
  } catch (err) {
    metaDeckBody.innerHTML = `<p class="status error">Could not open the list: ${escapeHtml(err.message)}</p>`;
  }
}

function addMetaOpponentOption() {
  const old = document.getElementById('metaOptgroup');
  if (old) old.remove();
  if (!metaOpponentEntry) return;
  const group = document.createElement('optgroup');
  group.id = 'metaOptgroup';
  group.label = 'Tournament list';
  const opt = document.createElement('option');
  opt.value = metaOpponentEntry.id;
  opt.textContent = metaOpponentEntry.name;
  group.appendChild(opt);
  opponentDeckSelect.appendChild(group);
}

// Makes a tournament list the Simulate tab's opponent and goes there.
function simulateAgainstMeta(entry) {
  metaOpponentEntry = { id: entry.id, name: entry.name, legend: entry.legend };
  addMetaOpponentOption();
  if (simModeSelect.value === 'matrix') selectMode('single');
  opponentDeckSelect.value = entry.id;
  opponentDeckSelect.dispatchEvent(new Event('change'));
  closeOverlay(metaDeckOverlay);
  showTopPanel('simulate');
  resetToSetup();
  setStatus(`Opponent: the tournament list ${entry.name}.`);
}

async function saveMetaDeck(entry) {
  const status = document.getElementById('metaDeckStatus');
  const category = document.getElementById('metaSaveCategory').value;
  status.textContent = 'Saving...';
  try {
    const saved = await engine.saveMetaDeck(entry.id, { category });
    await loadDecks();
    status.textContent = engine.storageKind === 'files' ? `Saved to Decks/${saved.id}.csv.` : `Saved as "${saved.name}".`;
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
}

async function runFieldTest() {
  if (!metaCurrent) return;
  const deckId = fieldTestDeckSelect.value;
  if (!deckId) {
    setFieldTestStatus('Pick your deck first.', true);
    return;
  }
  fieldTestBtn.disabled = true;
  fieldTestResult.innerHTML = '';
  setFieldTestStatus('Playing the field...');
  try {
    const r = await engine.fieldTest(deckId, metaCurrent.id, {
      onProgress: (done, total) => setFieldTestStatus(`Playing the field... ${done} of ${total} Legends`),
    });
    setFieldTestStatus('');
    renderFieldTest(r);
  } catch (err) {
    setFieldTestStatus('Error: ' + err.message, true);
  } finally {
    fieldTestBtn.disabled = false;
  }
}

function renderFieldTest(r) {
  if (!r.rows.length) {
    fieldTestResult.innerHTML = '<p class="import-help">No usable lists in this event to test against.</p>';
    return;
  }
  const weightSum = r.rows.reduce((s, x) => s + x.weight, 0);
  const coverage = Math.round(r.rows.reduce((s, x) => s + x.weight * x.coverage.fullPct, 0) / weightSum);
  const goodBad = r.expectedWinrate >= 50 ? 'good' : 'bad';
  let html = `<div class="field-test-head"><div class="winrate-number ${goodBad}">${r.expectedWinrate}%</div>`
    + `<div class="winrate-sub">expected winrate against the Day 2 field of ${escapeHtml(r.eventName)} (the ${r.rows.length} Legends tested were ${r.fieldCovered}% of it)</div>`
    + `<div class="winrate-meta">${r.gamesPerOpponent} games per Legend · seed ${r.seed}</div></div>`;
  if (r.fieldCovered < 50) {
    html += `<p class="warn-box field-test-warning">This covers only ${r.fieldCovered}% of the Day 2 field: the other Legends had no published list, or their lists have cards banned since. A more recent event says more about today's meta.</p>`;
  }
  if (coverage < COVERAGE_GOOD) {
    html += `<p class="warn-box field-test-warning">Only about ${coverage}% of these lists' card text is modeled, so many of their cards play as plain stats - these numbers likely overrate your deck. Each list's share is shown on its row.</p>`;
  }
  html += '<div class="matrix-group">';
  r.rows.forEach(x => {
    html += `<div class="matrix-row field-test-row">`
      + `<span class="matrix-name">${escapeHtml(shortLegend(x.legend))} <span class="meta-player">${x.weight}% of Day 2</span></span>`
      + coverageChip(x.coverage)
      + `<span class="matrix-winrate ${x.winrate >= 50 ? 'good' : 'bad'}">${x.winrate}%</span>`
      + `<span class="matrix-range" title="95% range">${x.winrateLow}-${x.winrateHigh}%</span>`
      + `<button type="button" class="ghost-btn field-test-open" data-deck-id="${escapeHtml(x.deckId)}" title="${escapeHtml(x.deckName)}">Simulate</button>`
      + `</div>`;
  });
  html += '</div>';
  fieldTestResult.innerHTML = html;
}

async function renderMetaTrend() {
  const t = await engine.metaTrend({ events: 6 });
  if (!t.rows.length) {
    metaTrend.innerHTML = '<p class="import-help">Not enough events with Day 2 counts yet.</p>';
    return;
  }
  const max = Math.max(...t.rows.flatMap(r => r.points.map(p => p.day2Pct || 0)), 1);
  let html = '<div class="table-scroll"><table class="trend-table"><tr><th>Legend</th>'
    + t.events.map(e => `<th title="${escapeHtml(e.published)}">${escapeHtml(e.name)}</th>`).join('') + '</tr>';
  t.rows.forEach(r => {
    html += `<tr><td class="trend-legend">${escapeHtml(shortLegend(r.legend))}</td>`;
    r.points.forEach(p => {
      if (p.day2Pct === null) {
        html += '<td class="trend-empty">-</td>';
        return;
      }
      const alpha = (0.08 + 0.5 * p.day2Pct / max).toFixed(2);
      html += `<td style="background: rgba(108, 140, 255, ${alpha})">${p.day2Pct}%${p.top8 ? `<sup>${p.top8}</sup>` : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</table></div>';
  metaTrend.innerHTML = html;
}

function initMeta() {
  initPillNav(document.getElementById('metaPillNav'), metaPanels);
  metaEventSelect.addEventListener('change', () => showMetaEvent(metaEventSelect.value));
  metaDecks.addEventListener('click', evt => {
    const row = evt.target.closest('.meta-deck-row');
    if (row) openMetaDeck(row.dataset.deckId);
  });
  fieldTestBtn.addEventListener('click', runFieldTest);
  fieldTestResult.addEventListener('click', evt => {
    const btn = evt.target.closest('.field-test-open');
    if (!btn) return;
    const entry = metaCurrent.decks.find(d => d.id === btn.dataset.deckId);
    if (entry) simulateAgainstMeta(entry);
  });
  metaDeckClose.addEventListener('click', () => closeOverlay(metaDeckOverlay));
  metaDeckOverlay.addEventListener('click', evt => {
    if (evt.target === metaDeckOverlay) closeOverlay(metaDeckOverlay);
  });
}

// ===================== Journal ("Journal" tab: real games) =====================
//
// Real games, logged by hand: on the PC they go to Journal/Games.csv
// (published with the repo), on the phone to this device. Export/Import
// moves games between the two without duplicates.

const jForm = {
  title: document.getElementById('journalFormTitle'),
  date: document.getElementById('jDate'),
  result: document.getElementById('jResult'),
  myDeck: document.getElementById('jMyDeck'),
  opponentLegend: document.getElementById('jOpponentLegend'),
  opponentDeck: document.getElementById('jOpponentDeck'),
  wentFirst: document.getElementById('jWentFirst'),
  myScore: document.getElementById('jMyScore'),
  opponentScore: document.getElementById('jOpponentScore'),
  event: document.getElementById('jEvent'),
  myBattlefield: document.getElementById('jMyBattlefield'),
  opponentBattlefield: document.getElementById('jOpponentBattlefield'),
  notes: document.getElementById('jNotes'),
  save: document.getElementById('jSave'),
  cancel: document.getElementById('jCancel'),
  remove: document.getElementById('jDelete'),
  status: document.getElementById('jStatus'),
};
const jMyDeck = jForm.myDeck;
const jCompareDeck = document.getElementById('jCompareDeck');
const jCompareBtn = document.getElementById('jCompareBtn');
const jCompareStatus = document.getElementById('jCompareStatus');
const jCompareResult = document.getElementById('jCompareResult');
const journalStatsEl = document.getElementById('journalStats');
const journalList = document.getElementById('journalList');
const journalStorageNote = document.getElementById('journalStorageNote');
const journalSyncNote = document.getElementById('journalSyncNote');
const jExportBtn = document.getElementById('jExport');
const jImportBtn = document.getElementById('jImportBtn');
const jImportFile = document.getElementById('jImportFile');
const jSyncStatus = document.getElementById('jSyncStatus');

let journalEntries = [];
let journalEditing = null; // id of the game being edited
let journalLoaded = false;

function localDateIso(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setSegmented(el, value) {
  Array.from(el.querySelectorAll('button')).forEach(b => b.classList.toggle('active', b.dataset.value === value));
}

function segmentedValue(el) {
  const active = el.querySelector('button.active');
  return active ? active.dataset.value : '';
}

function deckNameOf(id) {
  const deck = myDecksCache.find(d => d.id === id);
  return deck ? deck.name : (id || '').split('/').pop().replace(/_/g, ' ');
}

function setJournalStatus(el, text, isError) {
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

// After a save the date, deck and event stay (several games in a row are
// usually the same day and event); the game's own fields clear.
function resetJournalForm({ keepContext = true } = {}) {
  journalEditing = null;
  jForm.title.textContent = 'Log a real game';
  jForm.save.textContent = 'Save game';
  jForm.cancel.classList.add('hidden');
  jForm.remove.classList.add('hidden');
  if (!keepContext) {
    jForm.date.value = localDateIso();
    jForm.event.value = '';
  }
  if (!jForm.date.value) jForm.date.value = localDateIso();
  setSegmented(jForm.result, '');
  setSegmented(jForm.wentFirst, '');
  ['opponentLegend', 'opponentDeck', 'myScore', 'opponentScore', 'myBattlefield', 'opponentBattlefield', 'notes'].forEach(k => { jForm[k].value = ''; });
}

function fillJournalForm(e) {
  journalEditing = e.id;
  jForm.title.textContent = 'Edit game';
  jForm.save.textContent = 'Save changes';
  jForm.cancel.classList.remove('hidden');
  jForm.remove.classList.remove('hidden');
  jForm.date.value = e.date;
  setSegmented(jForm.result, e.result);
  setSegmented(jForm.wentFirst, e.wentFirst);
  if (myDecksCache.some(d => d.id === e.myDeck)) jForm.myDeck.value = e.myDeck;
  ['opponentLegend', 'opponentDeck', 'myScore', 'opponentScore', 'event', 'myBattlefield', 'opponentBattlefield', 'notes'].forEach(k => { jForm[k].value = e[k] || ''; });
  setJournalStatus(jForm.status, '');
  document.getElementById('journalFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// A typed card name -> the database's exact name of that type, or null.
function exactCardName(typed, type) {
  const info = typed ? engine.cardInfo(typed.trim()) : null;
  return info && info.type === type ? info.name : null;
}

async function saveJournalGame() {
  const legend = exactCardName(jForm.opponentLegend.value, 'Legend');
  if (!legend) {
    setJournalStatus(jForm.status, "Pick the opponent's Legend from the list (e.g. \"Kennen, Heart of the Tempest\").", true);
    return;
  }
  const myDeck = jForm.myDeck.value;
  const deck = myDecksCache.find(d => d.id === myDeck);
  const entry = {
    id: journalEditing || '',
    date: jForm.date.value,
    myDeck,
    myLegend: deck ? deck.legend : '',
    opponentLegend: legend,
    opponentDeck: jForm.opponentDeck.value,
    result: segmentedValue(jForm.result),
    wentFirst: segmentedValue(jForm.wentFirst),
    myScore: jForm.myScore.value,
    opponentScore: jForm.opponentScore.value,
    myBattlefield: exactCardName(jForm.myBattlefield.value, 'Battlefield') || jForm.myBattlefield.value,
    opponentBattlefield: exactCardName(jForm.opponentBattlefield.value, 'Battlefield') || jForm.opponentBattlefield.value,
    event: jForm.event.value,
    notes: jForm.notes.value,
  };
  jForm.save.disabled = true;
  try {
    const wasEditing = !!journalEditing;
    await engine.saveJournalEntry(entry);
    resetJournalForm();
    await refreshJournal();
    setJournalStatus(jForm.status, wasEditing ? 'Game updated.' : `Saved: ${entry.result} vs ${shortLegend(legend)}.`);
  } catch (err) {
    setJournalStatus(jForm.status, err.message, true);
  } finally {
    jForm.save.disabled = false;
  }
}

async function deleteJournalGame() {
  if (!journalEditing || !window.confirm('Delete this game from the journal?')) return;
  try {
    await engine.deleteJournalEntry(journalEditing);
    resetJournalForm();
    await refreshJournal();
    setJournalStatus(jForm.status, 'Game deleted.');
  } catch (err) {
    setJournalStatus(jForm.status, 'Error: ' + err.message, true);
  }
}

async function refreshJournal() {
  journalEntries = await engine.journalEntries();
  renderJournalStats();
  renderJournalList();
}

function recordText(t) {
  return `${t.wins}-${t.losses}${t.draws ? `-${t.draws}` : ''}`;
}

function renderJournalStats() {
  if (!journalEntries.length) {
    journalStatsEl.innerHTML = '<p class="import-help">No games logged yet.</p>';
    return;
  }
  const s = engine.journalStats(journalEntries);
  const groupRows = (groups, label) => groups.map(g => `<div class="matrix-row">`
    + `<span class="matrix-name">${escapeHtml(label(g.key))}</span>`
    + `<span class="journal-record">${recordText(g)}</span>`
    + `<span class="matrix-winrate ${g.winrate >= 50 ? 'good' : 'bad'}">${g.winrate}%</span>`
    + `</div>`).join('');
  let html = `<div class="journal-headline"><span class="winrate-number ${s.winrate >= 50 ? 'good' : 'bad'}">${s.winrate}%</span>`
    + `<span class="winrate-sub">${recordText(s)} in ${s.n} game${s.n === 1 ? '' : 's'} · 95% range ${s.winrateLow}-${s.winrateHigh}%</span></div>`;
  const firstSecond = [];
  if (s.first.n) firstSecond.push(`going first ${s.first.winrate}% (${recordText(s.first)})`);
  if (s.second.n) firstSecond.push(`going second ${s.second.winrate}% (${recordText(s.second)})`);
  if (firstSecond.length) html += `<p class="import-help">${firstSecond.join(' · ')}</p>`;
  if (s.recent) html += `<p class="journal-recent">Last games, newest first: ${s.recent.split('').map(c => `<span class="badge ${c === 'W' ? 'win' : (c === 'L' ? 'loss' : 'draw')}">${c}</span>`).join('')}</p>`;
  html += `<div class="matrix-group"><h4>By opponent Legend</h4>${groupRows(s.byOpponent, k => k)}</div>`;
  if (s.byDeck.length > 1 || (s.byDeck[0] && s.byDeck[0].key !== '(not set)')) html += `<div class="matrix-group"><h4>By your deck</h4>${groupRows(s.byDeck, k => (k === '(not set)' ? k : deckNameOf(k)))}</div>`;
  if (s.byEvent.length > 1 || (s.byEvent[0] && s.byEvent[0].key !== '(not set)')) html += `<div class="matrix-group"><h4>By event</h4>${groupRows(s.byEvent, k => k)}</div>`;
  journalStatsEl.innerHTML = html;
}

function renderJournalList() {
  journalList.innerHTML = '';
  if (!journalEntries.length) {
    journalList.innerHTML = '<li class="journal-empty">No games yet.</li>';
    return;
  }
  journalEntries.forEach(e => {
    const score = e.myScore !== '' && e.opponentScore !== '' ? ` ${e.myScore}-${e.opponentScore}` : '';
    const deck = e.myDeck ? `${deckNameOf(e.myDeck)} ` : '';
    journalList.appendChild(logRow(
      `${e.date} · ${deck}vs ${shortLegend(e.opponentLegend)}${score}`,
      resultBadge(e.result === 'Win', e.result === 'Draw', ['WIN', 'LOSS', 'DRAW']),
      () => fillJournalForm(e),
    ));
  });
}

async function exportJournal() {
  try {
    const data = await engine.exportJournal();
    const name = `riftbound-journal-${localDateIso()}.json`;
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    // On a phone the share sheet is the easy way to get the file to the PC.
    if (file && matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Riftbound journal' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    setJournalStatus(jSyncStatus, `Exported ${data.entries.length} game${data.entries.length === 1 ? '' : 's'} (${name}).`);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    setJournalStatus(jSyncStatus, 'Could not export: ' + err.message, true);
  }
}

async function importJournalFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const r = await engine.importJournal(data);
    await refreshJournal();
    const parts = [`${r.added} added`, `${r.updated} updated`, `${r.unchanged} already here`];
    if (r.skipped) parts.push(`${r.skipped} skipped (not valid games)`);
    setJournalStatus(jSyncStatus, `Imported: ${parts.join(', ')}.`);
  } catch (err) {
    setJournalStatus(jSyncStatus, 'Could not import: ' + (err instanceof SyntaxError ? "that file isn't JSON." : err.message), true);
  } finally {
    jImportFile.value = '';
  }
}

async function compareJournalWithSim() {
  const deckId = jCompareDeck.value;
  if (!deckId) return;
  jCompareBtn.disabled = true;
  jCompareResult.innerHTML = '';
  setJournalStatus(jCompareStatus, 'Simulating...');
  try {
    const r = await engine.journalVsSim(deckId, {
      onProgress: (done, total) => setJournalStatus(jCompareStatus, `Simulating... ${done} of ${total} Legends`),
    });
    setJournalStatus(jCompareStatus, '');
    if (!r.rows.length) {
      jCompareResult.innerHTML = `<p class="import-help">No logged games with ${escapeHtml(r.myDeckName)} yet.</p>`;
      return;
    }
    let html = `<p class="import-help">${r.games} real game${r.games === 1 ? '' : 's'} with ${escapeHtml(r.myDeckName)} · ${r.gamesPerOpponent} simulated games per Legend · seed ${r.seed}</p>`;
    html += '<div class="compare-head"><span>Opponent</span><span>Real</span><span>Simulator</span></div>';
    r.rows.forEach(x => {
      const real = `${x.real.winrate}% <span class="meta-player">${recordText(x.real)}</span>`;
      const sim = x.sim
        ? `${x.sim.winrate}% <span class="meta-player">${x.sim.winrateLow}-${x.sim.winrateHigh}%</span>`
        : '<span class="meta-player">no deck of this Legend</span>';
      const gap = x.sim ? Math.round(x.sim.winrate - x.real.winrate) : null;
      const gapText = gap === null ? '' : `<span class="compare-gap ${Math.abs(gap) >= 20 ? 'big' : ''}">${gap > 0 ? '+' : ''}${gap}</span>`;
      html += `<div class="compare-row">`
        + `<span class="matrix-name" title="${escapeHtml(x.deckName || '')}">${escapeHtml(shortLegend(x.legend))}${x.coverage ? ` ${coverageChip(x.coverage)}` : ''}</span>`
        + `<span>${real}</span><span>${sim} ${gapText}</span></div>`;
    });
    html += '<p class="import-help">A handful of real games swings a lot - with fewer than about 10 games against a Legend, a big gap says little. The number after the simulator\'s winrate is how far it is from your real one.</p>';
    jCompareResult.innerHTML = html;
  } catch (err) {
    setJournalStatus(jCompareStatus, 'Error: ' + err.message, true);
  } finally {
    jCompareBtn.disabled = false;
  }
}

async function openJournalPanel() {
  if (journalLoaded) return;
  journalLoaded = true;
  try {
    await refreshJournal();
  } catch (err) {
    journalLoaded = false;
    journalStatsEl.innerHTML = `<p class="status error">Could not read the journal: ${escapeHtml(err.message)}</p>`;
  }
}

function initJournal() {
  resetJournalForm({ keepContext: false });
  [jForm.result, jForm.wentFirst].forEach(el => el.addEventListener('click', evt => {
    const btn = evt.target.closest('button');
    if (btn) setSegmented(el, btn.dataset.value);
  }));
  jForm.save.addEventListener('click', saveJournalGame);
  jForm.cancel.addEventListener('click', () => { resetJournalForm(); setJournalStatus(jForm.status, ''); });
  jForm.remove.addEventListener('click', deleteJournalGame);
  jCompareBtn.addEventListener('click', compareJournalWithSim);
  jExportBtn.addEventListener('click', exportJournal);
  jImportBtn.addEventListener('click', () => jImportFile.click());
  jImportFile.addEventListener('change', () => {
    if (jImportFile.files && jImportFile.files[0]) importJournalFile(jImportFile.files[0]);
  });
}

// The journal form's suggestion lists, from the card database.
function fillJournalDatalists() {
  const fill = (id, names) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  };
  fill('legendNames', engine.legendNames());
  fill('battlefieldNames', engine.battlefieldNames());
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
  if (engine.storageKind !== 'files') {
    journalStorageNote.textContent = 'Games are saved on this phone (or browser). To keep them with the PC\x27s, use Export below and Import the file on the PC.';
    journalSyncNote.textContent = 'Export moves games to the PC (Import there); games logged on the PC arrive here with its next publish.';
    return;
  }
  journalStorageNote.textContent = 'Games are saved to Journal/Games.csv on this PC. PushToGitHub.bat publishes it with the repo - which is public - so it reaches the phone.';
  journalSyncNote.textContent = 'Games logged on the phone: Export them there, then Import the file here.';
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
  initMeta();
  initJournal();
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
  fillJournalDatalists();

  simulateBtn.disabled = false;
  await loadDecks();
  updateStepper();
}

start();
