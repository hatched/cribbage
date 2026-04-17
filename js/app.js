// js/app.js — Main application controller
// Ties together game logic (game.js), networking (peer.js) and rendering (ui.js).

import { CribbageGame, createDeck, shuffle } from './game.js';
import * as Net from './peer.js';
import * as UI  from './ui.js';

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

let game            = new CribbageGame();
let myIndex         = -1;              // 0 = host, 1 = guest
let selectedCards   = [];              // card IDs currently selected in my hand
let nextHandReady   = [false, false];  // both true → host deals next hand
let countingStarted = false;           // guard against double-starting counting

// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════

const btnAction  = document.getElementById('btn-action');
const codeInput  = document.getElementById('code-input');
const joinStatus = document.getElementById('join-status');

// ═══════════════════════════════════════════════════════════
// SCREEN MANAGEMENT
// ═══════════════════════════════════════════════════════════

function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ═══════════════════════════════════════════════════════════
// ACTION BUTTON HELPERS
// ═══════════════════════════════════════════════════════════

function showAction(label) {
  btnAction.textContent = label;
  btnAction.classList.remove('hidden');
}

function hideAction() {
  btnAction.classList.add('hidden');
}

btnAction.addEventListener('click', () => {
  const label = btnAction.textContent.trim();
  if      (label === 'Confirm Discard') doDiscard();
  else if (label === 'Cut Deck')        doCut();
  else if (label === 'Play Card')       doPlaySelected();
  else if (label === 'Go!')             doGo();
});

// ═══════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════

document.getElementById('btn-start').addEventListener('click', () => {
  goTo('screen-hosting');

  Net.initHost(
    (code) => {
      document.getElementById('room-code').textContent = code;
    },
    () => {
      // Guest connected — we are player 0 (host)
      myIndex = 0;
      goTo('screen-game');
      startNewGame();
    },
    handleMessage,
    (reason) => {
      UI.showToast(`Disconnected: ${reason}`);
      Net.disconnect();
      goTo('screen-home');
    }
  );
});

document.getElementById('btn-join').addEventListener('click', () => {
  goTo('screen-join');
  joinStatus.textContent = '';
  codeInput.value = '';
  setTimeout(() => codeInput.focus(), 100);
});

document.getElementById('btn-cancel-host').addEventListener('click', () => {
  Net.disconnect();
  goTo('screen-home');
});

document.getElementById('btn-back').addEventListener('click', () => {
  Net.disconnect();
  goTo('screen-home');
});

// Force uppercase-only input, strip non-alpha characters
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
});

document.getElementById('btn-join-game').addEventListener('click', doJoin);
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

function doJoin() {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length !== 4) {
    joinStatus.textContent = 'Enter a 4-letter code';
    return;
  }

  joinStatus.textContent = 'Connecting…';

  Net.initGuest(
    code,
    () => {
      // Connected — we are player 1 (guest)
      myIndex = 1;
      goTo('screen-game');
      UI.setMessage('Waiting for host to deal…');
      UI.setPhase('Connected');
      UI.setDealer('');
    },
    handleMessage,
    (reason) => {
      joinStatus.textContent = reason;
    }
  );
}

// ═══════════════════════════════════════════════════════════
// GAME OVER SCREEN
// ═══════════════════════════════════════════════════════════

document.getElementById('btn-play-again').addEventListener('click', () => {
  goTo('screen-game');
  if (Net.isHost()) {
    startNewGame();
  } else {
    // Guest resets local state and waits for host's GAME_START
    game           = new CribbageGame();
    nextHandReady  = [false, false];
    countingStarted = false;
    selectedCards  = [];
    UI.updateScores([0, 0], myIndex);
    UI.setPhase('—');
    UI.setDealer('');
    UI.setMessage('Waiting for host to deal…');
    hideAction();
  }
});

document.getElementById('btn-go-home').addEventListener('click', () => {
  Net.disconnect();
  goTo('screen-home');
});

// ═══════════════════════════════════════════════════════════
// GAME START / NEW HAND
// ═══════════════════════════════════════════════════════════

function startNewGame() {
  game            = new CribbageGame();
  nextHandReady   = [false, false];
  countingStarted = false;
  dealHand();
}

// Host only — shuffles deck and notifies guest
function dealHand() {
  const deck = shuffle(createDeck());
  game.startHand(deck, game.dealer);
  Net.send({ type: 'GAME_START', deck, dealer: game.dealer });
  onHandStarted();
}

// Called on both sides once game.startHand() has been applied
function onHandStarted() {
  selectedCards   = [];
  countingStarted = false;
  nextHandReady   = [false, false];

  UI.updateScores(game.scores, myIndex);
  UI.setDealer(
    game.dealer === myIndex
      ? '🃏 You deal — your crib'
      : '🃏 Opponent deals — their crib'
  );

  renderOppHand();
  showDiscardUI();
}

// ═══════════════════════════════════════════════════════════
// OPPONENT HAND HELPER
// ═══════════════════════════════════════════════════════════

function renderOppHand() {
  const count = game.hands[1 - myIndex].length;
  // Fake card objects — only count matters; they render face-down
  const fakeCards = Array.from({ length: count }, (_, i) => ({
    id: `_back${i}`, rank: '', suit: 'spades', value: 0, order: 0,
  }));
  UI.renderHand(fakeCards, 'opp-hand', { faceDown: true });
}

// ═══════════════════════════════════════════════════════════
// DISCARD PHASE
// ═══════════════════════════════════════════════════════════

function showDiscardUI() {
  UI.setPhase('Discard');
  UI.renderDiscardPhase(myIndex === game.dealer);
  UI.setMessage('Select 2 cards to discard to the crib');
  selectedCards = [];
  hideAction();

  UI.renderHand(game.hands[myIndex], 'my-hand', {
    selectable: true,
    maxSelect: 2,
    onSelect: (ids) => {
      selectedCards = ids;
      if (ids.length === 2) showAction('Confirm Discard');
      else hideAction();
    },
  });
}

function doDiscard() {
  if (selectedCards.length !== 2) return;
  const ids = [...selectedCards];
  selectedCards = [];

  game.discard(myIndex, ids);
  Net.send({ type: 'DISCARD', cardIds: ids });

  // Re-render remaining 4 cards (non-selectable)
  UI.renderHand(game.hands[myIndex], 'my-hand', { selectable: false });
  hideAction();

  if (game.phase === 'CUTTING') {
    afterBothDiscarded();
  } else {
    UI.setMessage('Waiting for opponent to discard…');
  }
}

// ═══════════════════════════════════════════════════════════
// CUT PHASE
// ═══════════════════════════════════════════════════════════

function afterBothDiscarded() {
  const iCut = myIndex !== game.dealer; // non-dealer always cuts

  UI.setPhase('Cut');
  UI.renderCutPhase(iCut);

  if (iCut) {
    UI.setMessage('Tap to cut the deck for the starter card');
    showAction('Cut Deck');
  } else {
    UI.setMessage('Opponent is cutting the deck…');
    hideAction();
  }
}

function doCut() {
  hideAction();
  const idx = Math.floor(Math.random() * game.cutDeck.length);
  Net.send({ type: 'CUT', index: idx });
  const result = game.cut(idx);
  handleCutResult(result);
}

function handleCutResult(result) {
  UI.renderCutPhase(false, result.starter);
  UI.updateScores(game.scores, myIndex);

  if (result.nibs) {
    const who = result.nibs.player === myIndex ? 'You score' : 'Opponent scores';
    UI.showToast(`${who} 2 — His Heels! (J cut)`);
  }

  // Short pause to let both players see the starter card before pegging
  setTimeout(() => startPegging(), 1800);
}

// ═══════════════════════════════════════════════════════════
// PEGGING PHASE
// ═══════════════════════════════════════════════════════════

function startPegging() {
  UI.setPhase('Peg');
  selectedCards = [];
  renderPeggingState();
}

function renderPeggingState() {
  if (game.phase !== 'PEGGING') return;

  const isMyTurn  = game.currentPlayer === myIndex;
  const iCanPlay  = game.canPlay(myIndex);
  const oppSaidGo = game.goFlags[1 - myIndex];

  // Cards I hold but can't legally play right now
  const unplayableIds = new Set(
    game.hands[myIndex]
      .filter(c => game.pegTotal + c.value > 31)
      .map(c => c.id)
  );

  UI.renderPegPhase(game.pegStack, game.pegTotal, game.starter, oppSaidGo);
  renderOppHand();

  if (isMyTurn) {
    if (!iCanPlay) {
      // Must say Go (or auto-go if hand is already empty)
      UI.renderHand(game.hands[myIndex], 'my-hand', { selectable: false });
      UI.setMessage("You can't play — tap Go");
      showAction('Go!');
      selectedCards = [];

      if (game.hands[myIndex].length === 0) {
        setTimeout(() => {
          if (game.phase === 'PEGGING' && game.currentPlayer === myIndex) doGo();
        }, 350);
      }
    } else {
      UI.renderHand(game.hands[myIndex], 'my-hand', {
        selectable: true,
        maxSelect: 1,
        disabledIds: unplayableIds,
        onSelect: (ids) => {
          selectedCards = ids;
          if (ids.length === 1) showAction('Play Card');
          else hideAction();
        },
      });
      UI.setMessage(oppSaidGo ? 'Opponent says Go — play a card' : 'Your turn — select a card');
      hideAction();
      selectedCards = [];
    }
  } else {
    UI.renderHand(game.hands[myIndex], 'my-hand', { selectable: false });
    UI.setMessage("Opponent's turn…");
    hideAction();
    selectedCards = [];
  }

  UI.updateScores(game.scores, myIndex);
}

function doPlaySelected() {
  if (selectedCards.length !== 1) return;
  const cardId = selectedCards[0];
  selectedCards = [];
  hideAction();

  let result;
  try {
    result = game.play(myIndex, cardId);
  } catch (err) {
    console.error('[app] play error:', err);
    UI.showToast('Invalid play — try again');
    renderPeggingState();
    return;
  }

  Net.send({ type: 'PLAY', cardId });
  handlePlayResult(result, myIndex);
}

function doGo() {
  hideAction();

  let result;
  try {
    result = game.go(myIndex);
  } catch (err) {
    console.error('[app] go error:', err);
    return;
  }

  Net.send({ type: 'GO' });
  handleGoResult(result, myIndex);
}

// ─── Peg result handlers ──────────────────────────────────────────────────────

function handlePlayResult(result, playerIndex) {
  UI.updateScores(game.scores, myIndex);

  if (result.pegScore?.pts > 0) {
    const who   = playerIndex === myIndex ? 'You' : 'Opponent';
    const descs = result.pegScore.items.map(i => i.desc).join(', ');
    UI.showToast(`${who}: ${descs} (+${result.pegScore.pts})`);
  }

  if (result.lastCard) {
    const who = playerIndex === myIndex ? 'You' : 'Opponent';
    UI.showToast(`${who}: Last card (+1)`, 1800);
    UI.updateScores(game.scores, myIndex);
  }

  if (result.winner !== undefined) {
    showGameOver(result.winner);
    return;
  }

  if (result.startCounting) {
    startCounting();
    return;
  }

  renderPeggingState();
}

function handleGoResult(result, playerIndex) {
  UI.updateScores(game.scores, myIndex);

  if (result.goPoint) {
    const who = result.scoringPlayer === myIndex ? 'You' : 'Opponent';
    UI.showToast(`${who}: Go (+1)`, 1800);
    UI.updateScores(game.scores, myIndex);
  }

  if (result.winner !== undefined) {
    showGameOver(result.winner);
    return;
  }

  if (result.startCounting) {
    startCounting();
    return;
  }

  renderPeggingState();
}

// ═══════════════════════════════════════════════════════════
// COUNTING (SHOW) PHASE
// ═══════════════════════════════════════════════════════════

function startCounting() {
  if (countingStarted) return;
  countingStarted = true;

  UI.setPhase('Show');
  hideAction();
  selectedCards = [];

  // Brief pause so both players see pegging wrap up before modal
  setTimeout(() => showNextCountStage(), 400);
}

function showNextCountStage() {
  if (game.isCountingDone()) {
    endHand();
    return;
  }

  const result = game.countNext();
  UI.updateScores(game.scores, myIndex);

  const whose = result.scoringPlayer === myIndex ? 'Your' : "Opponent's";
  const title = result.isCrib ? `${whose} Crib` : `${whose} Hand`;

  UI.showScoringModal({
    title,
    hand:    result.hand,
    starter: game.starter,
    items:   result.items,
    total:   result.total,
    onContinue: () => {
      // Check for a mid-count winning score (e.g. dealer pegs out on their crib)
      if (result.winner !== undefined && result.winner !== -1) {
        showGameOver(result.winner);
        return;
      }
      if (game.isCountingDone()) {
        endHand();
      } else {
        showNextCountStage();
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════
// BETWEEN HANDS
// ═══════════════════════════════════════════════════════════

function endHand() {
  countingStarted = false;
  nextHandReady[myIndex] = true;
  Net.send({ type: 'NEXT_HAND_READY' });
  UI.setMessage('Waiting for opponent…');
  hideAction();
  checkBothReady();
}

function checkBothReady() {
  if (!nextHandReady[0] || !nextHandReady[1]) return;

  nextHandReady   = [false, false];
  countingStarted = false;

  if (Net.isHost()) {
    game.nextHand();
    dealHand();
  }
  // Guest waits for the incoming GAME_START message
}

// ═══════════════════════════════════════════════════════════
// GAME OVER
// ═══════════════════════════════════════════════════════════

function showGameOver(winner) {
  const iWon = winner === myIndex;
  document.getElementById('gameover-emoji').textContent  = iWon ? '🏆' : '😔';
  document.getElementById('gameover-title').textContent  = iWon ? 'You win!' : 'You lose';
  document.getElementById('gameover-scores').textContent =
    `You: ${game.scores[myIndex]}  —  Opponent: ${game.scores[1 - myIndex]}`;
  goTo('screen-gameover');
}

// ═══════════════════════════════════════════════════════════
// INCOMING MESSAGE HANDLER  (peer → us)
// ═══════════════════════════════════════════════════════════

function handleMessage(msg) {
  switch (msg.type) {

    case 'GAME_START': {
      // Host dealt a new hand — apply state and show discard UI
      game.startHand(msg.deck, msg.dealer);
      onHandStarted();
      break;
    }

    case 'DISCARD': {
      game.discard(1 - myIndex, msg.cardIds);
      if (game.phase === 'CUTTING') {
        afterBothDiscarded();
      } else {
        // Opponent discarded before us; keep discard UI but update message
        UI.setMessage("Opponent discarded — select your 2 cards");
      }
      break;
    }

    case 'CUT': {
      const cutResult = game.cut(msg.index);
      handleCutResult(cutResult);
      break;
    }

    case 'PLAY': {
      let result;
      try {
        result = game.play(1 - myIndex, msg.cardId);
      } catch (err) {
        console.error('[app] remote PLAY error:', err);
        return;
      }
      handlePlayResult(result, 1 - myIndex);
      break;
    }

    case 'GO': {
      let result;
      try {
        result = game.go(1 - myIndex);
      } catch (err) {
        console.error('[app] remote GO error:', err);
        return;
      }
      handleGoResult(result, 1 - myIndex);
      break;
    }

    case 'NEXT_HAND_READY': {
      nextHandReady[1 - myIndex] = true;
      checkBothReady();
      break;
    }

    default:
      console.warn('[app] unknown message type:', msg.type);
  }
}
