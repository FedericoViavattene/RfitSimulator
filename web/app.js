const myDeckSelect = document.getElementById('myDeck');
const opponentDeckSelect = document.getElementById('opponentDeck');
const opponentField = document.getElementById('opponentField');
const simModeSelect = document.getElementById('simMode');
const simulateBtn = document.getElementById('simulateBtn');
const statusLine = document.getElementById('statusLine');
const resultsSection = document.getElementById('results');
const bannedWarnings = document.getElementById('bannedWarnings');
const winrateNumber = document.getElementById('winrateNumber');
const winrateSub = document.getElementById('winrateSub');
const gameList = document.getElementById('gameList');
const lossDetails = document.getElementById('lossDetails');
const lossList = document.getElementById('lossList');
const optimization = document.getElementById('optimization');
const opponentDecklist = document.getElementById('opponentDecklist');

const matchResultsSection = document.getElementById('matchResults');
const matchBannedWarnings = document.getElementById('matchBannedWarnings');
const matchWinrateNumber = document.getElementById('matchWinrateNumber');
const matchWinrateSub = document.getElementById('matchWinrateSub');
const matchList = document.getElementById('matchList');
const matchOptimization = document.getElementById('matchOptimization');
const matchOpponentDecklist = document.getElementById('matchOpponentDecklist');

const matrixResultsSection = document.getElementById('matrixResults');
const matrixBannedWarnings = document.getElementById('matrixBannedWarnings');
const matrixAverageNumber = document.getElementById('matrixAverageNumber');
const matrixTable = document.getElementById('matrixTable');

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

function setStatus(text, isError) {
  statusLine.textContent = text || '';
  statusLine.classList.toggle('error', !!isError);
}

async function loadDecks() {
  setStatus('Loading decks...');
  try {
    const res = await fetch('/api/decks');
    if (!res.ok) throw new Error('Failed to load decks (' + res.status + ')');
    const data = await res.json();

    myDeckSelect.innerHTML = '';
    (data.myDecks || []).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      myDeckSelect.appendChild(opt);
    });

    opponentDeckSelect.innerHTML = '';
    const opponents = data.opponents || {};
    Object.keys(opponents).forEach(category => {
      const group = document.createElement('optgroup');
      group.label = category;
      opponents[category].forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        group.appendChild(opt);
      });
      opponentDeckSelect.appendChild(group);
    });

    if (!myDeckSelect.options.length || !opponentDeckSelect.options.length) {
      setStatus('No decks found. Add CSV files under Decks\\MyDeck or Decks\\Opponents.', true);
      simulateBtn.disabled = true;
      return;
    }
    setStatus('');
  } catch (err) {
    setStatus('Could not load decks: ' + err.message, true);
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

function renderMatrix(data) {
  matrixAverageNumber.textContent = data.averageWinrate + '%';
  matrixAverageNumber.classList.toggle('good', data.averageWinrate >= 50);
  matrixAverageNumber.classList.toggle('bad', data.averageWinrate < 50);

  const rows = data.rows || [];
  if (rows.length === 0) {
    matrixTable.innerHTML = '<p>No saved opponent decks were found under Decks\\Opponents.</p>';
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
  const res = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ myDeckId, opponentDeckId })
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || ('Simulation failed (' + res.status + ')'));
  }
  const data = await res.json();

  renderBannedWarnings(data, bannedWarnings);
  renderWinrate(data);
  renderGameList(data.games);
  renderLossBreakdown(data.games);
  renderOptimization(data.optimization, optimization);
  renderDecklist(data.opponentDecklist, opponentDecklist);
  resultsSection.classList.remove('hidden');
}

async function runMatchSimulation(myDeckId, opponentDeckId) {
  const res = await fetch('/api/simulate-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ myDeckId, opponentDeckId })
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || ('Match simulation failed (' + res.status + ')'));
  }
  const data = await res.json();

  renderBannedWarnings(data, matchBannedWarnings);
  renderMatchWinrate(data);
  renderMatchList(data.matches);
  renderOptimization(data.optimization, matchOptimization);
  renderDecklist(data.opponentDecklist, matchOpponentDecklist);
  matchResultsSection.classList.remove('hidden');
}

async function runMatchupMatrix(myDeckId) {
  const res = await fetch('/api/matchup-matrix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ myDeckId })
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || ('Matchup matrix failed (' + res.status + ')'));
  }
  const data = await res.json();

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
  } catch (err) {
    setStatus('Error: ' + err.message, true);
  } finally {
    simulateBtn.disabled = false;
  }
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
    const res = await fetch('/api/import-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        category: importCategory.value,
        deckName: importName.value,
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || ('Import failed (' + res.status + ')'));
    }

    renderImportResult(data);
    setImportStatus('');
    await loadDecks(); // refresh the dropdowns so the new deck shows up right away
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
    + `${data.overwritten ? ' (replaced an existing file with this name)' : ''}.</div>`;

  if (data.warnings && data.warnings.length) {
    html += '<ul>' + data.warnings.map(w => `<li>${w}</li>`).join('') + '</ul>';
  }

  importResult.innerHTML = html;
  importResult.classList.remove('hidden');
  importResult.classList.add(ok ? 'success' : 'failure');
}

importBtn.addEventListener('click', importDeck);
simulateBtn.addEventListener('click', runSimulation);
simModeSelect.addEventListener('change', applyModeToUi);
applyModeToUi();
loadDecks();
