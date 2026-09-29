/*
  engine.js — Riftbound Deck Simulator, browser-native port of RiftboundEngine.psm1
  + the request handlers from WebServer.ps1.

  This is a line-for-line-faithful port, not a rewrite: every rule, threshold,
  formula and piece of advice text below is copied from the PowerShell engine
  (RiftboundEngine.psm1) and the payload-shaping helpers in WebServer.ps1, so
  this version behaves identically to the PC version - same rules, same loss
  diagnostics, same matchup-recommendation heuristic, same Spanish advice
  strings. See RiftboundEngine.psm1's own comments for the full rules
  citations (Victory Score, Final Point restriction, Burn Out, etc.) - not
  repeated here to avoid the two copies drifting apart.

  The one real difference: there is no filesystem here, so decks live in
  IndexedDB instead of CSV files. Everything else - the simulation math, the
  optimization stats, the matchup-recommendation scoring - is the same code,
  just in JavaScript.
*/

// ============================================================================
//  INDEXEDDB — deck storage (replaces Decks\*.csv)
// ============================================================================
const DB_NAME = 'riftbound-db';
const DB_VERSION = 1;
const STORE_DECKS = 'decks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DECKS)) {
        db.createObjectStore(STORE_DECKS, { keyPath: 'id' });
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

// ============================================================================
//  RANDOM HELPERS
// ============================================================================
function shuffle(arr) {
  // Fisher-Yates - statistically equivalent to the PowerShell engine's
  // `Sort-Object { Get-Random }` shuffle, just a cleaner implementation.
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================================
//  CARD DATABASE (CardDatabase.json) + BANNED LIST
// ============================================================================
function normalizeCardName(name) {
  // Mirrors ConvertTo-NormalizedCardName exactly: strip commas/apostrophes/
  // periods/quotes (including curly '’'), collapse whitespace, lowercase.
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
    this.db = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;

    const [cardDbRaw, bannedRaw, decksSeed] = await Promise.all([
      fetch('carddatabase.json').then(r => r.json()),
      fetch('banned.json').then(r => r.json()),
      fetch('decks.json').then(r => r.json()),
    ]);

    // Import-CardDatabase port: index every card by its exact lowercased name
    // AND its punctuation-normalized name (never overwriting an exact-name
    // key), so a paste that drops commas/apostrophes still resolves.
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

    this.db = await openDb();
    const existing = await idbGetAll(this.db, STORE_DECKS);
    if (existing.length === 0) {
      // First run on this device/browser: seed the bundled decks.
      await idbPutAll(this.db, STORE_DECKS, decksSeed);
    }

    this.ready = true;
  }

  // --------------------------------------------------------------------
  //  DECK LISTING  (Get-DecksPayload)
  // --------------------------------------------------------------------
  async listDecks() {
    const all = await idbGetAll(this.db, STORE_DECKS);
    all.sort((a, b) => a.name.localeCompare(b.name));

    const myDecks = all
      .filter(d => d.isMyDeck)
      .map(d => ({ id: d.id, name: d.name }));

    const order = ['Aggro', 'Midrange', 'Control'];
    const opponents = {};
    for (const cat of order) {
      const inCat = all.filter(d => !d.isMyDeck && d.category === cat).map(d => ({ id: d.id, name: d.name }));
      if (inCat.length > 0) opponents[cat] = inCat;
    }
    const otherCats = [...new Set(all.filter(d => !d.isMyDeck && !order.includes(d.category)).map(d => d.category))];
    for (const cat of otherCats) {
      opponents[cat] = all.filter(d => !d.isMyDeck && d.category === cat).map(d => ({ id: d.id, name: d.name }));
    }

    return { myDecks, opponents };
  }

  // --------------------------------------------------------------------
  //  DECK IMPORT  (Import-Deck port - operates on a stored record's rows
  //  instead of reading a CSV file)
  // --------------------------------------------------------------------
  async getResolvedDeck(deckId) {
    const record = await idbGet(this.db, STORE_DECKS, deckId);
    if (!record) throw new Error(`Deck not found: ${deckId}`);
    return this.resolveDeck(record);
  }

  resolveDeck(record) {
    const rows = record.rows;
    const cards = [];
    const displayRows = [];
    let skippedOffDomain = 0;
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
      DisplayRows: displayRows,
      BannedExcluded: [...new Set(bannedFound)],
      SkippedOffDomain: skippedOffDomain,
    };
  }

  categoryFromDeckId(deckId) {
    // Get-CategoryFromDeckId port: second-to-last path segment.
    if (!deckId) return null;
    const parts = deckId.split('/');
    if (parts.length >= 2) return parts[parts.length - 2];
    return null;
  }

  // --------------------------------------------------------------------
  //  PLAYER STATE / SINGLE GAME  (New-PlayerState, Invoke-Draw,
  //  Invoke-LegendAbilityTrigger, Invoke-MainPhase, Invoke-CombatStep,
  //  Get-LossReason, Invoke-SingleGame)
  // --------------------------------------------------------------------
  newPlayerState(deck, label) {
    return {
      Label: label,
      DeckName: deck.Name,
      Domain: deck.Domain,
      Library: shuffle(deck.Cards),
      Hand: [],
      Trash: [],
      BoardMight: [0, 0, 0],
      BattlefieldShield: [0, 0, 0],
      Energy: 0,
      EnergySpent: 0,
      EnergyAvailable: 0,
      Score: 0,
      BurnOutCount: 0,
      PlayLog: [],
      PeakBoardMight: 0,
      EverLed: false,
      LegendName: deck.LegendName,
      LegendAbility: deck.LegendAbility,
    };
  }

  drawCards(player, count = 1) {
    for (let i = 0; i < count; i++) {
      if (player.Library.length === 0) {
        if (player.Trash.length === 0) {
          player.BurnOutCount++;
          return false;
        }
        player.Library = shuffle(player.Trash);
        player.Trash = [];
      }
      const card = player.Library.shift();
      player.Hand.push(card);
    }
    return true;
  }

  triggerLegendAbility(player, trigger, battlefieldIndex = -1) {
    const ability = player.LegendAbility;
    if (!ability || ability.trigger !== trigger) return;
    const amount = ability.amount ? parseInt(ability.amount, 10) : 1;
    switch (ability.effect) {
      case 'BuffBoardMightThisTurn':
        if (battlefieldIndex >= 0) player.BoardMight[battlefieldIndex] += amount;
        break;
      case 'Draw':
        this.drawCards(player, amount);
        break;
      default:
        break;
    }
  }

  mainPhase(player, opponent, battlefieldCount = 3) {
    player.EnergyAvailable = player.Energy;
    const playable = player.Hand.slice().sort((a, b) => b.Energy - a.Energy);

    for (const card of playable) {
      if (card.Energy <= player.EnergyAvailable) {
        player.EnergyAvailable -= card.Energy;
        player.EnergySpent += card.Energy;
        const idx = player.Hand.indexOf(card);
        if (idx >= 0) player.Hand.splice(idx, 1);

        let targetBF = 0;
        let lowest = Infinity;
        for (let b = 0; b < battlefieldCount; b++) {
          if (player.BoardMight[b] < lowest) { lowest = player.BoardMight[b]; targetBF = b; }
        }
        player.BoardMight[targetBF] += card.Might;

        if (card.Type === 'Unit') {
          this.triggerLegendAbility(player, 'OnUnitPlayed', targetBF);
        }

        if (card.Tag) {
          const parts = card.Tag.split(':');
          const tagName = parts[0];
          const tagVal = parts.length > 1 ? (parseInt(parts[1], 10) || 0) : 0;

          switch (tagName) {
            case 'Remove': {
              let remaining = tagVal;
              for (let b = 0; b < battlefieldCount && remaining > 0; b++) {
                const take = Math.min(remaining, opponent.BoardMight[b]);
                opponent.BoardMight[b] -= take;
                remaining -= take;
              }
              break;
            }
            case 'Buff':
              player.BoardMight[targetBF] += tagVal;
              break;
            case 'Draw':
              this.drawCards(player, tagVal);
              break;
            case 'Shield':
              player.BattlefieldShield[targetBF] += tagVal;
              break;
            default:
              break;
          }
        }

        player.Trash.push(card);
        player.PlayLog.push(card.Name);
      }
    }
  }

  combatStep(active, defender, battlefieldCount = 3, victoryScore = 8) {
    const winners = new Array(battlefieldCount).fill(null);
    for (let b = 0; b < battlefieldCount; b++) {
      const mightActive = active.BoardMight[b];
      const mightDefender = defender.BoardMight[b] + defender.BattlefieldShield[b];
      if (mightActive > mightDefender) winners[b] = active;
      else if (mightDefender > mightActive) winners[b] = defender;
      else winners[b] = null;
    }

    for (const side of [active, defender]) {
      const other = side === active ? defender : active;
      const wonIdx = [];
      for (let b = 0; b < battlefieldCount; b++) {
        if (winners[b] === side) wonIdx.push(b);
      }
      if (wonIdx.length === 0) continue;

      this.triggerLegendAbility(side, 'OnCombatWin');

      if (side.Score >= victoryScore - 1) {
        if (wonIdx.length === battlefieldCount) {
          side.Score = Math.min(side.Score + 1, victoryScore);
        } else {
          this.drawCards(side, 1);
        }
      } else {
        side.Score = Math.min(side.Score + wonIdx.length, victoryScore);
      }

      for (const b of wonIdx) {
        other.BoardMight[b] = 0;
      }
    }
  }

  getLossReason(loser, winner) {
    const pointGap = winner.Score - loser.Score;
    const totalEnergySeen = loser.EnergySpent + loser.EnergyAvailable;
    const energyUsedPct = totalEnergySeen > 0 ? loser.EnergySpent / totalEnergySeen : 1.0;
    const cardsStuckInHand = loser.Hand.length;

    if (loser.BurnOutCount > 0) {
      return {
        Category: 'BurnOut',
        Text: "Deck ran out of cards (Burn Out) and conceded a point on every subsequent draw - the deck is likely too thin for how long this game ran, or too much Energy went unspent early instead of refilling the board.",
      };
    }
    if (loser.PeakBoardMight > 0 && winner.PeakBoardMight > 0 && loser.PeakBoardMight < winner.PeakBoardMight * 0.7) {
      return {
        Category: 'MightMismatch',
        Text: `Out-classed on peak board Might (your best turn reached ${loser.PeakBoardMight} vs the opponent's ${winner.PeakBoardMight}) - the deck likely needs a higher average Might curve, or more Buff/Shield effects to compete for Battlefields.`,
      };
    }
    if (energyUsedPct < 0.75) {
      const pct = Math.round((1 - energyUsedPct) * 100);
      return {
        Category: 'EnergyUnspent',
        Text: `Left Energy unspent on ${pct}% of the game on average - your hand likely had too many expensive cards clogging the curve early, or not enough cheap plays to use up Channel each turn.`,
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

  singleGame(deckA, deckB, opts = {}) {
    const victoryScore = opts.victoryScore ?? 8;
    const energyPerTurn = opts.energyPerTurn ?? 2;
    const battlefieldCount = opts.battlefieldCount ?? 3;
    const maxTurns = opts.maxTurns ?? 40;

    const playerA = this.newPlayerState(deckA, 'You');
    const playerB = this.newPlayerState(deckB, 'Opponent');

    this.drawCards(playerA, 7);
    this.drawCards(playerB, 7);
    playerB.Energy += 1;

    let turn = 0;
    let winner = null;

    while (turn < maxTurns) {
      turn++;
      for (const [active, defender] of [[playerA, playerB], [playerB, playerA]]) {
        active.Energy += energyPerTurn;
        const drewOk = this.drawCards(active, 1);
        if (!drewOk) {
          defender.Score = Math.min(defender.Score + 1, victoryScore);
        }

        this.mainPhase(active, defender, battlefieldCount);

        const activeMightNow = active.BoardMight.reduce((s, v) => s + v, 0);
        if (activeMightNow > active.PeakBoardMight) active.PeakBoardMight = activeMightNow;

        this.combatStep(active, defender, battlefieldCount, victoryScore);

        if (active.Score > defender.Score) active.EverLed = true;
        if (defender.Score > active.Score) defender.EverLed = true;

        if (active.Score >= victoryScore && active.Score > defender.Score) { winner = active; break; }
        if (defender.Score >= victoryScore && defender.Score > active.Score) { winner = defender; break; }
      }
      if (winner) break;
    }

    if (!winner) {
      if (playerA.Score !== playerB.Score) {
        winner = playerA.Score > playerB.Score ? playerA : playerB;
      } else {
        const mA = playerA.BoardMight.reduce((s, v) => s + v, 0);
        const mB = playerB.BoardMight.reduce((s, v) => s + v, 0);
        winner = mA >= mB ? playerA : playerB;
      }
    }

    const result = {
      Winner: winner.Label,
      ScoreA: playerA.Score,
      ScoreB: playerB.Score,
      PlayLogA: playerA.PlayLog,
      LossReason: null,
    };
    if (winner.Label !== 'You') {
      result.LossReason = this.getLossReason(playerA, playerB);
    }
    return result;
  }

  // --------------------------------------------------------------------
  //  OPTIMIZATION STATS  (Get-OptimizationStats)
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
  //  MATCHUP RECOMMENDATION + SIDEBOARD  (Get-MatchupRecommendation)
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
  //  BATCHES / MATCHES / MATRIX  (Invoke-GameBatch, Invoke-Match,
  //  Invoke-MatchBatch, Get-MatchupMatrix)
  // --------------------------------------------------------------------
  gameBatch(deckA, deckB, gameCount = 50) {
    const results = [];
    for (let g = 0; g < gameCount; g++) results.push(this.singleGame(deckA, deckB));
    const wins = results.filter(r => r.Winner === 'You').length;
    const winrate = gameCount > 0 ? Math.round((wins / gameCount) * 1000) / 10 : 0;
    return { Results: results, Wins: wins, GameCount: gameCount, Winrate: winrate };
  }

  matchOf(deckA, deckB, bestOf = 3) {
    const gamesToWin = Math.ceil(bestOf / 2.0);
    const games = [];
    let winsA = 0, winsB = 0;
    while (winsA < gamesToWin && winsB < gamesToWin) {
      const g = this.singleGame(deckA, deckB);
      games.push(g);
      if (g.Winner === 'You') winsA++; else winsB++;
    }
    return { Winner: winsA >= gamesToWin ? 'You' : 'Opponent', GamesWonA: winsA, GamesWonB: winsB, BestOf: bestOf, Games: games };
  }

  matchBatch(deckA, deckB, matchCount = 10, bestOf = 3) {
    const matches = [];
    for (let i = 0; i < matchCount; i++) matches.push(this.matchOf(deckA, deckB, bestOf));
    const matchWins = matches.filter(m => m.Winner === 'You').length;
    const matchWinrate = matchCount > 0 ? Math.round((matchWins / matchCount) * 1000) / 10 : 0;
    return { Matches: matches, MatchWins: matchWins, MatchCount: matchCount, MatchWinrate: matchWinrate, BestOf: bestOf };
  }

  async matchupMatrixRows(myDeck, gameCount = 50) {
    const all = await idbGetAll(this.db, STORE_DECKS);
    const opponents = all.filter(d => !d.isMyDeck);
    const rows = [];
    for (const record of opponents) {
      const oppDeck = this.resolveDeck(record);
      const batch = this.gameBatch(myDeck, oppDeck, gameCount);
      rows.push({ Name: oppDeck.Name, Category: record.category, Winrate: batch.Winrate, Wins: batch.Wins, Total: batch.GameCount });
    }
    rows.sort((a, b) => (a.Category || '').localeCompare(b.Category || '') || a.Name.localeCompare(b.Name));
    return rows;
  }

  // --------------------------------------------------------------------
  //  TEXT-LIST DECK IMPORT  (ConvertFrom-DeckText, Resolve-DeckList,
  //  Export-DeckCsv -> saved to IndexedDB instead of a CSV file)
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
      const domainStr = (rec.Domains || []).join(',') === 'Colorless' ? '' : (rec.Domains || []).join('/');
      rows.push({ Quantity: qty, Name: rec.Name, Type: rec.Type, Energy: rec.Energy, Power: rec.Power, Might: rec.Might, Domain: domainStr, Tag: '' });
    }

    const legendCount = rows.filter(r => r.Type === 'Legend').length;
    const runeTotal = rows.filter(r => r.Type === 'Rune').reduce((s, r) => s + r.Quantity, 0);
    const bfCount = rows.filter(r => r.Type === 'Battlefield').length;
    const mainTotal = rows.filter(r => ['Unit', 'Spell', 'Gear'].includes(r.Type)).reduce((s, r) => s + r.Quantity, 0);

    if (legendCount !== 1) warnings.push(`Deck has ${legendCount} Legend card(s) - a legal deck needs exactly 1.`);
    if (bfCount !== 3) warnings.push(`Deck has ${bfCount} Battlefield(s) - a legal deck needs exactly 3.`);
    if (runeTotal !== 12) warnings.push(`Rune Deck has ${runeTotal} card(s) - a legal Rune Deck is exactly 12.`);
    if (mainTotal < 40) warnings.push(`Main Deck has ${mainTotal} card(s) - the official minimum is 40.`);

    return { Rows: rows, Warnings: warnings, LegendCount: legendCount, RuneTotal: runeTotal, BattlefieldCount: bfCount, MainDeckTotal: mainTotal };
  }

  // ========================================================================
  //  PUBLIC API — mirrors WebServer.ps1's /api/* handlers exactly, same
  //  camelCase JSON shapes, so app.js's existing render*() functions don't
  //  need to change at all.
  // ========================================================================

  async simulate(myDeckId, opponentDeckId, gameCount = 50, sideboardSize = 10) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const opponentDeck = await this.getResolvedDeck(opponentDeckId);
    const opponentCategory = this.categoryFromDeckId(opponentDeckId);

    const batch = this.gameBatch(myDeck, opponentDeck, gameCount);

    const games = batch.Results.map((r, i) => ({
      n: i + 1,
      win: r.Winner === 'You',
      scoreA: r.ScoreA,
      scoreB: r.ScoreB,
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
      wins: batch.Wins,
      totalGames: batch.GameCount,
      winrate: batch.Winrate,
      games,
      optimization,
      opponentDecklist,
      recommendation,
    };
  }

  async simulateMatch(myDeckId, opponentDeckId, matchCount = 20, bestOf = 3, sideboardSize = 10) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const opponentDeck = await this.getResolvedDeck(opponentDeckId);
    const opponentCategory = this.categoryFromDeckId(opponentDeckId);

    const matchBatch = this.matchBatch(myDeck, opponentDeck, matchCount, bestOf);

    const matches = [];
    const allGames = [];
    matchBatch.Matches.forEach((m, i) => {
      matches.push({ n: i + 1, win: m.Winner === 'You', gamesWonA: m.GamesWonA, gamesWonB: m.GamesWonB });
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
      bestOf: matchBatch.BestOf,
      matchWins: matchBatch.MatchWins,
      matchCount: matchBatch.MatchCount,
      matchWinrate: matchBatch.MatchWinrate,
      matches,
      optimization,
      opponentDecklist,
      recommendation,
    };
  }

  async matchupMatrix(myDeckId, gameCount = 50) {
    const myDeck = await this.getResolvedDeck(myDeckId);
    const rows = await this.matchupMatrixRows(myDeck, gameCount);
    const averageWinrate = rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.Winrate, 0) / rows.length) * 10) / 10
      : 0;

    return {
      myDeckName: myDeck.Name,
      bannedExcludedMy: myDeck.BannedExcluded,
      rows: rows.map(r => ({ name: r.Name, category: r.Category, winrate: r.Winrate, wins: r.Wins, total: r.Total })),
      averageWinrate,
    };
  }

  async importDeck({ text, category, deckName }) {
    if (!text || !text.trim()) throw new Error('No decklist text was provided.');

    const validCategories = ['MyDeck', 'Aggro', 'Midrange', 'Control'];
    if (!validCategories.includes(category)) {
      throw new Error(`Invalid destination '${category}'. Must be one of: ${validCategories.join(', ')}.`);
    }

    let rawName = deckName || '';
    if (!rawName.trim()) rawName = 'Imported Deck';
    let safeName = rawName.replace(/[^A-Za-z0-9 ,'-]/g, '').replace(/\s+/g, '_');
    safeName = safeName.replace(/^_+|_+$/g, '');
    if (!safeName) {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      safeName = `Imported_Deck_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    }

    const id = category === 'MyDeck' ? `MyDeck/${safeName}` : `Opponents/${category}/${safeName}`;
    const existing = await idbGet(this.db, STORE_DECKS, id);
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
      name: safeName.replace(/_/g, ' '),
      category: category === 'MyDeck' ? null : category,
      isMyDeck: category === 'MyDeck',
      rows: resolved.Rows,
    };
    await idbPut(this.db, STORE_DECKS, record);

    return {
      success: true,
      deckId: id,
      fileName: `${safeName}.csv`,
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
  //  PAYLOAD SHAPING  (Get-OptimizationPayload, Get-DecklistPayload,
  //  Get-RecommendationPayload)
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
