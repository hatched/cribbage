// crib/js/game.js
// Complete cribbage game engine — no DOM dependencies.

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['hearts','diamonds','clubs','spades'];

function cardValue(rank) {
  if (rank === 'A') return 1;
  if (['J','Q','K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function cardOrder(rank) {
  return RANKS.indexOf(rank); // A=0 … K=12
}

function makeCard(rank, suit) {
  return {
    rank,
    suit,
    value: cardValue(rank),
    order: cardOrder(rank),
    id: `${rank}_${suit[0]}`,
  };
}

// ---------------------------------------------------------------------------
// createDeck
// ---------------------------------------------------------------------------

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}

// ---------------------------------------------------------------------------
// shuffle — Fisher-Yates, returns a new array
// ---------------------------------------------------------------------------

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// scoreHand
// ---------------------------------------------------------------------------

export function scoreHand(hand, starter, isCrib) {
  const cards = [...hand, starter]; // 5 cards
  const items = [];

  // --- Fifteens ---
  // Every non-empty subset of 5 cards that sums to 15 = 2pts each.
  const n = cards.length; // 5
  let fifteenCount = 0;
  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) sum += cards[i].value;
    }
    if (sum === 15) fifteenCount++;
  }
  if (fifteenCount > 0) {
    items.push({ desc: `Fifteens (${fifteenCount}×2)`, pts: fifteenCount * 2 });
  }

  // --- Pairs ---
  // Every unique pair (i < j) with same rank = 2pts.
  let pairCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cards[i].rank === cards[j].rank) pairCount++;
    }
  }
  if (pairCount > 0) {
    items.push({ desc: `Pairs (${pairCount}×2)`, pts: pairCount * 2 });
  }

  // --- Runs ---
  // Multiplicative algorithm:
  // 1. Build a frequency map of orders present.
  // 2. Find every maximal window of consecutive orders of length >= 3.
  // 3. Score = runLength × product of frequencies of each order in run.
  // We enumerate all starting points and lengths; take only maximal runs
  // (i.e. not a sub-run of a longer one).

  const freqMap = {};
  for (const c of cards) {
    freqMap[c.order] = (freqMap[c.order] || 0) + 1;
  }

  // Collect all distinct orders present.
  const ordersPresent = Object.keys(freqMap).map(Number).sort((a, b) => a - b);

  let runPts = 0;
  let runDesc = '';

  // Find maximal consecutive sequences of length >= 3 in ordersPresent.
  // A sequence is consecutive if each element differs by exactly 1 from the previous.
  // We split ordersPresent into maximal consecutive runs, then score each.
  const sequences = [];
  let seq = [ordersPresent[0]];
  for (let i = 1; i < ordersPresent.length; i++) {
    if (ordersPresent[i] === ordersPresent[i - 1] + 1) {
      seq.push(ordersPresent[i]);
    } else {
      sequences.push(seq);
      seq = [ordersPresent[i]];
    }
  }
  sequences.push(seq);

  for (const s of sequences) {
    if (s.length < 3) continue;
    // Product of frequencies across the entire consecutive sequence.
    const mult = s.reduce((prod, order) => prod * freqMap[order], 1);
    const pts = s.length * mult;
    runPts += pts;
    if (runDesc) runDesc += ', ';
    runDesc += `run of ${s.length}`;
    if (mult > 1) runDesc += `×${mult}`;
  }
  if (runPts > 0) {
    items.push({ desc: `Runs (${runDesc}) = ${runPts}`, pts: runPts });
  }

  // --- Flush ---
  const handSuit = hand[0].suit;
  const handFlush = hand.every(c => c.suit === handSuit);
  if (handFlush && starter.suit === handSuit) {
    // 5-card flush — valid for hand and crib.
    items.push({ desc: 'Flush (5)', pts: 5 });
  } else if (handFlush && !isCrib) {
    // 4-card flush — only for hand, not crib.
    items.push({ desc: 'Flush (4)', pts: 4 });
  }

  // --- Nobs ---
  // A Jack in hand whose suit matches the starter = 1pt.
  for (const c of hand) {
    if (c.rank === 'J' && c.suit === starter.suit) {
      items.push({ desc: 'Nobs (J in hand matches starter suit)', pts: 1 });
      break; // at most one nobs
    }
  }

  const total = items.reduce((s, i) => s + i.pts, 0);
  return { items, total };
}

// ---------------------------------------------------------------------------
// scorePeg
// ---------------------------------------------------------------------------

export function scorePeg(pegStack, total) {
  const items = [];

  // --- Fifteen ---
  if (total === 15) {
    items.push({ desc: 'Fifteen', pts: 2 });
  }

  // --- Thirty-one ---
  if (total === 31) {
    items.push({ desc: 'Thirty-one', pts: 2 });
  }

  // --- Pairs ---
  // Count trailing streak of cards with the same rank as the last card played.
  if (pegStack.length >= 2) {
    const lastRank = pegStack[pegStack.length - 1].rank;
    let streak = 1;
    for (let i = pegStack.length - 2; i >= 0; i--) {
      if (pegStack[i].rank === lastRank) streak++;
      else break;
    }
    if (streak === 2) items.push({ desc: 'Pair', pts: 2 });
    else if (streak === 3) items.push({ desc: 'Three of a kind', pts: 6 });
    else if (streak === 4) items.push({ desc: 'Four of a kind', pts: 12 });
  }

  // --- Runs ---
  // Check if the last N cards (N from min(length,7) down to 3) form a run.
  // A run requires all cards to have UNIQUE consecutive orders.
  // Score the longest qualifying run only.
  const maxLen = Math.min(pegStack.length, 7);
  let runFound = false;
  for (let len = maxLen; len >= 3 && !runFound; len--) {
    const slice = pegStack.slice(pegStack.length - len);
    const orders = slice.map(c => c.order);
    const uniqueOrders = [...new Set(orders)];
    // All must be unique.
    if (uniqueOrders.length !== slice.length) continue;
    // All must be consecutive (sorted, each differs by 1).
    uniqueOrders.sort((a, b) => a - b);
    let consecutive = true;
    for (let i = 1; i < uniqueOrders.length; i++) {
      if (uniqueOrders[i] !== uniqueOrders[i - 1] + 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      items.push({ desc: `Run of ${len}`, pts: len });
      runFound = true;
    }
  }

  const pts = items.reduce((s, i) => s + i.pts, 0);
  return { items, pts };
}

// ---------------------------------------------------------------------------
// CribbageGame
// ---------------------------------------------------------------------------

export class CribbageGame {
  constructor() {
    this.scores = [0, 0];
    this.dealer = 0;
    this.phase = 'WAITING';

    // Per-hand state (initialised in startHand)
    this.hands = [[], []];
    this.cutDeck = [];
    this.crib = [];
    this.starter = null;
    this.discards = [null, null];
    this.pegStack = [];
    this.pegTotal = 0;
    this.playedCards = [[], []];
    this.goFlags = [false, false];
    this.lastToPlay = null;
    this.currentPlayer = null;
    this.countingStage = 0;
  }

  // -------------------------------------------------------------------------
  // startHand
  // -------------------------------------------------------------------------

  startHand(shuffledDeck, dealer) {
    this.dealer = dealer;

    // Deal 6 cards to each player.
    this.hands = [
      shuffledDeck.slice(0, 6),
      shuffledDeck.slice(6, 12),
    ];
    this.cutDeck = shuffledDeck.slice(12);

    // Reset per-hand state.
    this.crib = [];
    this.starter = null;
    this.discards = [null, null];
    this.pegStack = [];
    this.pegTotal = 0;
    this.playedCards = [[], []];
    this.goFlags = [false, false];
    this.lastToPlay = null;
    this.countingStage = 0;

    // Non-dealer leads pegging.
    this.currentPlayer = 1 - dealer;

    this.phase = 'DISCARDING';
  }

  // -------------------------------------------------------------------------
  // discard
  // -------------------------------------------------------------------------

  discard(playerIndex, cardIds) {
    if (cardIds.length !== 2) throw new Error('Must discard exactly 2 cards');

    const hand = this.hands[playerIndex];
    const removed = [];
    for (const id of cardIds) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx === -1) throw new Error(`Card ${id} not in hand[${playerIndex}]`);
      removed.push(...hand.splice(idx, 1));
    }
    this.crib.push(...removed);
    this.discards[playerIndex] = cardIds;

    if (this.discards[0] !== null && this.discards[1] !== null) {
      this.phase = 'CUTTING';
    }
  }

  // -------------------------------------------------------------------------
  // cut
  // -------------------------------------------------------------------------

  cut(index) {
    const i = ((index % this.cutDeck.length) + this.cutDeck.length) % this.cutDeck.length;
    this.starter = this.cutDeck[i];

    let nibs = null;
    if (this.starter.rank === 'J') {
      this.scores[this.dealer] += 2;
      nibs = { player: this.dealer, pts: 2 };
    }

    this.phase = 'PEGGING';
    this.currentPlayer = 1 - this.dealer;

    return { starter: this.starter, nibs };
  }

  // -------------------------------------------------------------------------
  // canPlay
  // -------------------------------------------------------------------------

  canPlay(playerIndex) {
    return this.hands[playerIndex].some(c => c.value <= 31 - this.pegTotal);
  }

  // -------------------------------------------------------------------------
  // play
  // -------------------------------------------------------------------------

  play(playerIndex, cardId) {
    if (this.currentPlayer !== playerIndex) {
      throw new Error(`It is not player ${playerIndex}'s turn`);
    }

    const hand = this.hands[playerIndex];
    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) throw new Error(`Card ${cardId} not in hand[${playerIndex}]`);

    const card = hand.splice(cardIdx, 1)[0];
    if (card.value > 31 - this.pegTotal) {
      // Put it back.
      hand.splice(cardIdx, 0, card);
      throw new Error(`Playing ${cardId} would exceed 31`);
    }

    this.pegStack.push(card);
    this.playedCards[playerIndex].push(card);
    this.pegTotal += card.value;

    // goFlags reset whenever a card is played.
    this.goFlags = [false, false];
    this.lastToPlay = playerIndex;

    const pegScore = scorePeg(this.pegStack, this.pegTotal);
    if (pegScore.pts > 0) {
      this.scores[playerIndex] += pegScore.pts;
    }

    const result = {
      card,
      pegScore,
      newTotal: this.pegTotal,
      scoringPlayer: playerIndex,
      nextPlayer: null,
    };

    // Check winner after pegging score.
    if (this.scores[playerIndex] >= 121) {
      result.winner = playerIndex;
      this.phase = 'GAME_OVER';
      return result;
    }

    const other = 1 - playerIndex;

    if (this.pegTotal === 31) {
      // Hit 31 — already scored 2pts above.
      result.hit31 = true;
      result.resetPeg = true;
      this._resetPegSequence();
      if (this._checkAllPlayed()) {
        this._startCounting();
        result.startCounting = true;
      } else {
        this.currentPlayer = other;
        result.nextPlayer = other;
      }
      return result;
    }

    // Not 31 — determine who plays next.
    if (this.canPlay(other)) {
      this.currentPlayer = other;
      result.nextPlayer = other;
    } else if (this.canPlay(playerIndex)) {
      // Other cannot play; playerIndex keeps playing.
      this.currentPlayer = playerIndex;
      result.nextPlayer = playerIndex;
      result.otherMustGo = true;
    } else {
      // Neither can play — last card point.
      this.scores[playerIndex] += 1;
      result.lastCard = true;

      if (this.scores[playerIndex] >= 121) {
        result.winner = playerIndex;
        this.phase = 'GAME_OVER';
        return result;
      }

      this._resetPegSequence();
      result.resetPeg = true;

      if (this._checkAllPlayed()) {
        this._startCounting();
        result.startCounting = true;
      } else {
        this._advancePegPlayer(other);
        result.nextPlayer = this.currentPlayer;
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // go
  // -------------------------------------------------------------------------

  go(playerIndex) {
    if (this.currentPlayer !== playerIndex) {
      throw new Error(`It is not player ${playerIndex}'s turn`);
    }

    this.goFlags[playerIndex] = true;
    const other = 1 - playerIndex;

    if (this.canPlay(other)) {
      this.currentPlayer = other;
      return { continuing: true, nextPlayer: other };
    }

    // Neither can play — award go point to lastToPlay.
    const goScorer = this.lastToPlay !== null ? this.lastToPlay : playerIndex;
    this.scores[goScorer] += 1;
    this._resetPegSequence();

    const result = {
      goPoint: true,
      scoringPlayer: goScorer,
      nextPlayer: null,
    };

    if (this.scores[goScorer] >= 121) {
      result.winner = goScorer;
      this.phase = 'GAME_OVER';
      return result;
    }

    if (this._checkAllPlayed()) {
      this._startCounting();
      result.startCounting = true;
    } else {
      this._advancePegPlayer(playerIndex);
      result.resetPeg = true;
      result.nextPlayer = this.currentPlayer;
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // countNext
  // -------------------------------------------------------------------------

  countNext() {
    if (this.countingStage > 2) throw new Error('Counting is already done');

    const nonDealer = 1 - this.dealer;
    let scoringPlayer, hand, isCrib;

    if (this.countingStage === 0) {
      scoringPlayer = nonDealer;
      hand = this.playedCards[nonDealer];
      isCrib = false;
    } else if (this.countingStage === 1) {
      scoringPlayer = this.dealer;
      hand = this.playedCards[this.dealer];
      isCrib = false;
    } else {
      // stage 2 — crib belongs to dealer.
      scoringPlayer = this.dealer;
      hand = this.crib;
      isCrib = true;
    }

    const { items, total } = scoreHand(hand, this.starter, isCrib);
    this.scores[scoringPlayer] += total;

    const stage = this.countingStage;
    this.countingStage++;

    let winner = -1;
    if (this.scores[scoringPlayer] >= 121) {
      winner = scoringPlayer;
      this.phase = 'GAME_OVER';
    }

    return { stage, hand, isCrib, scoringPlayer, items, total, winner };
  }

  // -------------------------------------------------------------------------
  // isCountingDone
  // -------------------------------------------------------------------------

  isCountingDone() {
    return this.countingStage > 2;
  }

  // -------------------------------------------------------------------------
  // nextHand
  // -------------------------------------------------------------------------

  nextHand() {
    this.dealer = 1 - this.dealer;
    this.phase = 'WAITING';
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  _resetPegSequence() {
    this.pegStack = [];
    this.pegTotal = 0;
    this.goFlags = [false, false];
  }

  _checkAllPlayed() {
    return this.hands[0].length === 0 && this.hands[1].length === 0;
  }

  _startCounting() {
    this.phase = 'COUNTING';
    this.countingStage = 0;
  }

  _advancePegPlayer(preferred) {
    if (this.canPlay(preferred)) {
      this.currentPlayer = preferred;
    } else if (this.canPlay(1 - preferred)) {
      this.currentPlayer = 1 - preferred;
    } else {
      this._startCounting();
    }
  }
}
