const myDeckSelect = document.getElementById('myDeck');
const opponentDeckSelect = document.getElementById('opponentDeck');
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

function renderBannedWarnings(data) {
  const my = data.bannedExcludedMy || [];
  const opp = data.bannedExcludedOpponent || [];
  if (my.length === 0 && opp.length === 0) {
    bannedWarnings.classList.add('hidden');
    bannedWarnings.innerHTML = '';
    return;
  }
  let html = '<h2 class="warn-box">Banned cards excluded</h2>';
  if (my.length) html += `<p class="warn-box">Your deck: ${my.join(', ')}</p>`;
  if (opp.length) html += `<p class="warn-box">Opponent deck: ${opp.join(', ')}</p>`;
  bannedWarnings.innerHTML = html;
  bannedWarnings.classList.remove('hidden');
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

function renderOptimization(stats) {
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

  optimization.innerHTML = html;
}

function renderDecklist(decklist) {
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
  opponentDecklist.innerHTML = html;
}

async function runSimulation() {
  const myDeckId = myDeckSelect.value;
  const opponentDeckId = opponentDeckSelect.value;
  if (!myDeckId || !opponentDeckId) {
    setStatus('Pick both a deck and an opponent first.', true);
    return;
  }

  simulateBtn.disabled = true;
  setStatus('Simulating 10 games...');
  resultsSection.classList.add('hidden');

  try {
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

    renderBannedWarnings(data);
    renderWinrate(data);
    renderGameList(data.games);
    renderLossBreakdown(data.games);
    renderOptimization(data.optimization);
    renderDecklist(data.opponentDecklist);

    resultsSection.classList.remove('hidden');
    setStatus('');
  } catch (err) {
    setStatus('Error: ' + err.message, true);
  } finally {
    simulateBtn.disabled = false;
  }
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
loadDecks();
