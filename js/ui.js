// js/ui.js
// All DOM rendering — no game logic, no network calls.

const SUIT_SYM = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS = new Set(['hearts', 'diamonds']);

// ─── Card elements ────────────────────────────────────────────────────────────

/**
 * Build a single card DOM element.
 * @param {{ rank, suit, id }} card
 * @param {{ faceDown?, extraClass? }} opts
 */
export function cardEl(card, { faceDown = false, extraClass = '' } = {}) {
  const el = document.createElement('div');
  const red = !faceDown && RED_SUITS.has(card.suit) ? ' red' : '';
  el.className = `card${faceDown ? ' face-down' : ''}${red}${extraClass ? ' ' + extraClass : ''}`;
  el.dataset.cardId = card.id;

  if (!faceDown) {
    const sym = SUIT_SYM[card.suit];
    el.innerHTML =
      `<span class="rank-top">${card.rank}</span>` +
      `<span class="suit-top">${sym}</span>` +
      `<span class="suit-center">${sym}</span>` +
      `<span class="rank-bot">${card.rank}</span>` +
      `<span class="suit-bot">${sym}</span>`;
  }

  return el;
}

/**
 * Return an HTML string for a card (non-interactive display only).
 * @param {{ rank, suit, id }} card
 * @param {{ faceDown?, extraClass? }} opts
 */
export function cardHTML(card, { faceDown = false, extraClass = '' } = {}) {
  if (faceDown) {
    return `<div class="card face-down" data-card-id="${card.id}"></div>`;
  }
  const sym = SUIT_SYM[card.suit];
  const red = RED_SUITS.has(card.suit) ? ' red' : '';
  const cls = `card${red}${extraClass ? ' ' + extraClass : ''}`;
  return (
    `<div class="${cls}" data-card-id="${card.id}">` +
    `<span class="rank-top">${card.rank}</span>` +
    `<span class="suit-top">${sym}</span>` +
    `<span class="suit-center">${sym}</span>` +
    `<span class="rank-bot">${card.rank}</span>` +
    `<span class="suit-bot">${sym}</span>` +
    `</div>`
  );
}

// ─── Hand rendering ───────────────────────────────────────────────────────────

/**
 * Render a player's hand into a container.
 *
 * @param {object[]} cards        Array of card objects.
 * @param {string}   containerId  ID of the container element.
 * @param {object}   opts
 * @param {boolean}  opts.faceDown    Render cards face-down.
 * @param {boolean}  opts.selectable  Cards are tappable / clickable.
 * @param {number}   opts.maxSelect   Maximum simultaneously selected cards (default 1).
 * @param {Set}      opts.disabledIds Card IDs that cannot be selected (shown dimmed).
 * @param {Function} opts.onSelect    Called with array of selected card IDs whenever selection changes.
 */
export function renderHand(cards, containerId, opts = {}) {
  const {
    faceDown    = false,
    selectable  = false,
    maxSelect   = 1,
    disabledIds = new Set(),
    onSelect    = null,
  } = opts;

  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const selected = new Set();

  for (const card of cards) {
    const disabled = disabledIds.has(card.id);
    const el = cardEl(card, { faceDown });

    if (disabled) el.classList.add('dim');

    if (selectable && !faceDown) {
      el.classList.add('selectable');

      el.addEventListener('click', () => {
        if (disabled) return;

        if (selected.has(card.id)) {
          // Deselect
          selected.delete(card.id);
          el.classList.remove('selected');
        } else if (selected.size < maxSelect) {
          // Select
          selected.add(card.id);
          el.classList.add('selected');
        } else if (maxSelect === 1) {
          // Single-select: swap
          container.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
          selected.clear();
          selected.add(card.id);
          el.classList.add('selected');
        }
        // maxSelect > 1 and at limit: ignore extra taps

        onSelect?.([...selected]);
      });
    }

    container.appendChild(el);
  }
}

// ─── Play-area renderers ──────────────────────────────────────────────────────

/** Show the discard-phase prompt in the play area. */
export function renderDiscardPhase(isDealer) {
  document.getElementById('play-area').innerHTML =
    `<div class="phase-info">` +
    `<div class="phase-icon">🃏</div>` +
    `<p class="phase-info-text">Select 2 cards to discard</p>` +
    `<p class="crib-owner-text">${isDealer ? 'Your crib' : "Opponent's crib"}</p>` +
    `</div>`;
}

/**
 * Show the cut-phase content in the play area.
 * @param {boolean}     isMyTurn   True when the non-dealer (me) should cut.
 * @param {object|null} starter    If set, reveal this card instead of the deck prompt.
 */
export function renderCutPhase(isMyTurn, starter = null) {
  const area = document.getElementById('play-area');

  if (starter) {
    // Reveal the starter card
    area.innerHTML =
      `<div class="starter-display">` +
      `<span class="starter-label-text">STARTER</span>` +
      cardHTML(starter, { extraClass: 'starter-card' }) +
      `</div>`;
    return;
  }

  const msg = isMyTurn ? 'Tap to cut the deck' : 'Opponent is cutting…';
  area.innerHTML =
    `<div class="cut-deck-area">` +
    `<div class="deck-stack"></div>` +
    `<p class="phase-info-text">${msg}</p>` +
    `</div>`;
}

/**
 * Render the pegging phase content in the play area.
 * @param {object[]}    pegStack    Cards played in the current sequence.
 * @param {number}      pegTotal    Running total.
 * @param {object|null} starter     Starter card (shown small at top).
 * @param {boolean}     oppSaidGo   Show the GO badge next to the total.
 */
export function renderPegPhase(pegStack, pegTotal, starter, oppSaidGo) {
  const cardsHTML = pegStack.map(c => cardHTML(c)).join('');
  const goBadge   = oppSaidGo ? '<span class="go-badge">GO</span>' : '';
  const starterHTML = starter
    ? `<div class="starter-display">` +
      `<span class="starter-label-text">STARTER</span>` +
      cardHTML(starter, { extraClass: 'starter-card' }) +
      `</div>`
    : '';

  document.getElementById('play-area').innerHTML =
    `<div class="peg-content">` +
    starterHTML +
    `<div class="peg-total-display">${pegTotal}</div>` +
    `<div class="peg-label">RUNNING TOTAL ${goBadge}</div>` +
    `<div class="peg-cards-row">${cardsHTML}</div>` +
    `</div>`;
}

// ─── Score display ────────────────────────────────────────────────────────────

/**
 * Update both score numbers and progress bars.
 * @param {number[]} scores   [score0, score1]
 * @param {number}   myIndex  0 or 1
 */
export function updateScores(scores, myIndex) {
  const mine = scores[myIndex];
  const theirs = scores[1 - myIndex];

  document.getElementById('score-me').textContent  = mine;
  document.getElementById('score-opp').textContent = theirs;

  const pct = n => `${Math.min(100, (n / 121) * 100).toFixed(1)}%`;
  document.getElementById('my-bar').style.width  = pct(mine);
  document.getElementById('opp-bar').style.width = pct(theirs);
}

/** Set the phase label in the header. */
export function setPhase(text) {
  document.getElementById('phase-label').textContent = text;
}

/** Set the dealer sub-label in the header. */
export function setDealer(text) {
  document.getElementById('dealer-label').textContent = text;
}

/** Set the instructional message in the footer. */
export function setMessage(text) {
  document.getElementById('game-message').textContent = text;
}

// ─── Action button helpers ────────────────────────────────────────────────────

const _btnAction = () => document.getElementById('btn-action');

/** Show the action button with the given label. */
export function showAction(label) {
  const btn = _btnAction();
  btn.textContent = label;
  btn.classList.remove('hidden');
}

/** Hide the action button. */
export function hideAction() {
  _btnAction().classList.add('hidden');
}

// ─── Scoring overlay ──────────────────────────────────────────────────────────

/**
 * Display the scoring modal for one counting stage.
 *
 * @param {object}   opts
 * @param {string}   opts.title       Modal heading.
 * @param {object[]} opts.hand        4-card hand to display.
 * @param {object}   opts.starter     Starter card (shown with gold outline).
 * @param {Array}    opts.items       [{desc, pts}, …] scoring breakdown.
 * @param {number}   opts.total       Total points for this hand.
 * @param {Function} opts.onContinue  Called when the user dismisses the modal.
 */
export function showScoringModal({ title, hand, starter, items, total, onContinue }) {
  document.getElementById('scoring-title').textContent = title;

  // Hand cards + separator + starter
  const handHTML    = hand.map(c => cardHTML(c)).join('');
  const starterPart = starter
    ? `<span class="card-sep">+</span>${cardHTML(starter, { extraClass: 'starter-card' })}`
    : '';
  document.getElementById('scoring-cards').innerHTML = handHTML + starterPart;

  // Breakdown items
  const itemsEl = document.getElementById('scoring-items');
  if (!items || items.length === 0) {
    itemsEl.innerHTML = '<li class="no-points">No score</li>';
  } else {
    itemsEl.innerHTML = items
      .map(it => `<li><span>${it.desc}</span><span class="pts">+${it.pts}</span></li>`)
      .join('');
  }

  document.getElementById('scoring-total').textContent = `Total: ${total} pts`;

  // Show the overlay
  document.getElementById('scoring-overlay').classList.remove('hidden');

  // Wire up the Continue button (one-shot listener)
  const btn = document.getElementById('btn-scoring-continue');
  const handler = () => {
    btn.removeEventListener('click', handler);
    document.getElementById('scoring-overlay').classList.add('hidden');
    onContinue();
  };
  btn.addEventListener('click', handler);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer = null;

/**
 * Briefly show a floating toast message.
 * @param {string} msg
 * @param {number} [duration=2500]  Milliseconds before auto-hide.
 */
export function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
    _toastTimer = null;
  }, duration);
}

// ─── Screen routing ───────────────────────────────────────────────────────────

/** Activate one screen and hide all others. */
export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
