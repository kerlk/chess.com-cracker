/* Chess.com cracker — (c) 2026 kerlk (https://t.me/kerlk)
   Licensed under the Custom License v1.0+ (evergreen).
   The current version of the license is always available at:
   https://github.com/<nick>/<repo>/blob/main/LICENSE
   Modification prohibited. See LICENSE for details. */

const SELECTOR_BOARD = 'wc-chess-board';

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function safeSendMessage(message) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {}
}

function safeStorageGet(keys, callback) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.get(keys, callback);
  } catch (e) {}
}

function safeStorageSet(data) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.local.set(data);
  } catch (e) {}
}

function parsePieces(board) {
  const pieces = [];
  for (const el of board.querySelectorAll('.piece')) {
    const classes = [...el.classList];
    const piece = classes.find(c => /^[wb][pnbrqk]$/.test(c));
    const square = classes.find(c => c.startsWith('square-'));
    if (piece && square) pieces.push({ piece, square: square.replace('square-', '') });
  }
  return pieces;
}
function getPieceImages(board) {
  const images = {};
  for (const el of board.querySelectorAll('.piece')) {
    const classes = [...el.classList];
    const piece = classes.find(c => /^[wb][pnbrqk]$/.test(c));
    if (piece && !images[piece]) {
      const bgImage = window.getComputedStyle(el).backgroundImage;
      if (bgImage && bgImage !== 'none') {
        const url = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
        if (url && url[1]) images[piece] = url[1];
      }
    }
  }
  return images;
}
let castlingDone = false;
let historyFens = [];
let lastFen = null;
let lastValidPieces = null;
let lastValidFen = null;

function detectSideToMove() {
  const activeClockSelectors = [
    '.clock-player-turn',
    '.clock-running',
    '.clock-component.clock-player-turn',
    '.clock-component.running',
    '.clock-component.clock-running',
    '[data-cy="clock-running"]',
    '.clock-player-turn .clock-component'
  ];

  for (const selector of activeClockSelectors) {
    const activeClock = document.querySelector(selector);
    if (!activeClock) continue;
    const playerRow = activeClock.closest('.player-component, #board-layout-player-top, #board-layout-player-bottom, .player-row-component');
    if (playerRow) {
      const id = playerRow.id || '';
      const cls = playerRow.className || '';
      if (id.includes('bottom') || /bottom/i.test(cls)) return 'w';
      if (id.includes('top') || /top/i.test(cls)) return 'b';
    }
    const clockCls = activeClock.className || '';
    if (/black/i.test(clockCls)) return 'b';
    if (/white/i.test(clockCls)) return 'w';
  }
  const moveList = document.querySelector('.move-list, [data-cy="move-list"], .main-line-row');
  if (moveList) {
    const moveNodes = moveList.querySelectorAll('[data-cy="move"], .move, .main-line-ply');
    if (moveNodes.length > 0) {
      return (moveNodes.length % 2 === 0) ? 'b' : 'w';
    }
  }
  const board = document.querySelector(SELECTOR_BOARD);
  if (board) {
    const flipped = board.classList.contains('flipped') || document.querySelector('.board.flipped') !== null;
    return flipped ? 'b' : 'w';
  }
  return 'w';
}

function getCastlingRights(pieces) {
  if (castlingDone) return '-';
  const map = {};
  for (const { piece, square } of pieces) map[square] = piece;
  let rights = '';
  if (map['51'] === 'wk') {
    if (map['81'] === 'wr') rights += 'K';
    if (map['11'] === 'wr') rights += 'Q';
  }
  if (map['58'] === 'bk') {
    if (map['88'] === 'br') rights += 'k';
    if (map['18'] === 'br') rights += 'q';
  }
  return rights || '-';
}
function hasKings(pieces) {
  if (!pieces || pieces.length < 2) return false;
  const hasWhiteKing = pieces.some(p => p.piece === 'wk');
  const hasBlackKing = pieces.some(p => p.piece === 'bk');
  return hasWhiteKing && hasBlackKing;
}

function hasPawnOnEdge(pieces) {
  for (const { piece, square } of pieces) {
    if (piece[1] !== 'p') continue;
    const rank = parseInt(square[1], 10);
    if (rank === 1 || rank === 8) return true;
  }
  return false;
}

function buildFen(pieces, sideToMove, castling) {
  const map = {};
  for (const { piece, square } of pieces) map[square] = piece;
  const rankLines = [];
  for (let r = 8; r >= 1; r--) {
    let line = '', empty = 0;
    for (let f = 1; f <= 8; f++) {
      const piece = map[`${f}${r}`];
      if (piece) {
        if (empty > 0) { line += empty; empty = 0; }
        line += (piece[0] === 'w' ? piece[1].toUpperCase() : piece[1]);
      } else empty++;
    }
    if (empty > 0) line += empty;
    rankLines.push(line);
  }
  return `${rankLines.join('/')} ${sideToMove} ${castling} - 0 1`;
}

function readBoard() {
  const board = document.querySelector(SELECTOR_BOARD);
  if (!board) return null;
  let pieces = parsePieces(board);

  if (hasPawnOnEdge(pieces)) {
    return null;
  }

  if (!hasKings(pieces)) {
    if (lastValidPieces) {
      pieces = lastValidPieces;
    } else {
      return null;
    }
  } else {
    lastValidPieces = pieces;
  }

  const flipped = board.classList.contains('flipped') || document.querySelector('.board.flipped') !== null;
  const trackerSide = window.chessMoveTracker?.getSideToMove?.();
  const sideToMove = trackerSide || (flipped ? 'b' : 'w');

  const fen = buildFen(pieces, sideToMove, getCastlingRights(pieces));
  const fenBoard = fen.split(' ')[0];
  if (!/K/.test(fenBoard) || !/k/.test(fenBoard)) {
    if (lastValidFen) {
      return {
        pieces: lastValidPieces,
        flipped,
        playerColor: flipped ? 'b' : 'w',
        images: getPieceImages(board),
        fen: lastValidFen,
        ts: Date.now()
      };
    }
    return null;
  }

  lastValidFen = fen;

  return {
    pieces,
    flipped,
    playerColor: flipped ? 'b' : 'w',
    images: getPieceImages(board),
    fen,
    ts: Date.now()
  };
}
function autoDetectCastling() {
  if (castlingDone) return;
  const tracker = window.chessMoveTracker;
  if (!tracker) return;
  const st = tracker.getState();
  if (!st || !st.lastMoveWasCastling || !st.playerColor) return;
  if (st.lastMoveColor === st.playerColor) {
    castlingDone = true;
    safeStorageSet({ castlingDone });
    const btn = document.querySelector('.cbr-castling-btn');
    if (btn) updateCastlingButton(btn);
  }
}

function detectNewGame() {
  const moveList = document.querySelector('wc-simple-move-list');
  if (!moveList) return;
  const moves = moveList.querySelectorAll('[data-node]');
  if (moves.length === 0 && castlingDone) {
    castlingDone = false;
    safeStorageSet({ castlingDone: false });
    const btn = document.querySelector('.cbr-castling-btn');
    if (btn) updateCastlingButton(btn);
  }
  if (moves.length === 0) {
    lastValidPieces = null;
    lastValidFen = null;
    historyFens = [];
    lastFen = null;
  }
}

function sendPosition() {
  autoDetectCastling();
  detectNewGame();
  const pos = readBoard();
  if (!pos || !isExtensionContextValid()) return;

  if (pos.fen !== lastFen) {
    historyFens.push(lastFen || pos.fen);
    if (historyFens.length > 8) {
      historyFens.shift();
    }
    lastFen = pos.fen;
  }

  const playerFen = pos.fen.replace(/ (w|b) /, ` ${pos.playerColor} `);

  safeSendMessage({ 
    type: 'POSITION', 
    payload: { ...pos, playerFen, historyFens: historyFens.filter(f => f && f !== pos.fen).slice(-7) }
  });
}
function clearHighlights() {
  document.querySelectorAll('.cbr-overlay').forEach(el => el.remove());
  document.querySelectorAll('.cbr-legend-inner').forEach(el => el.remove());
  const fallback = document.getElementById('cbr-legend-fallback');
  if (fallback) fallback.remove();
}
function getSquareXY(square, board, flipped) {
  if (!square || square.length < 2) return null;
  const file = square[0].toLowerCase().charCodeAt(0) - 96;
  const rank = parseInt(square[1], 10);
  if (file < 1 || file > 8 || rank < 1 || rank > 8) return null;
  const w = board.clientWidth;
  const h = board.clientHeight;
  const sqW = w / 8;
  const sqH = h / 8;
  const col = flipped ? (8 - file) : (file - 1);
  const row = flipped ? (rank - 1) : (8 - rank);
  return {
    x: (col + 0.5) * sqW,
    y: (row + 0.5) * sqH
  };
}
function drawOneArrow(svg, from, to, board, flipped, color, width, isBest) {
  const fromXY = getSquareXY(from, board, flipped), toXY = getSquareXY(to, board, flipped);
  if (!fromXY || !toXY) return;
  const w = board.clientWidth, sqSize = w / 8, arrowSize = sqSize * (isBest ? 0.5 : 0.4);
  const angle = Math.atan2(toXY.y - fromXY.y, toXY.x - fromXY.x);
  const lineEnd = {
    x: toXY.x - Math.cos(angle) * (arrowSize * 0.8),
    y: toXY.y - Math.sin(angle) * (arrowSize * 0.8)
  };
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', fromXY.x); line.setAttribute('y1', fromXY.y);
  line.setAttribute('x2', lineEnd.x); line.setAttribute('y2', lineEnd.y);
  line.setAttribute('stroke', color); line.setAttribute('stroke-width', width);
  svg.appendChild(line);
  const p1 = { x: toXY.x, y: toXY.y };
  const p2 = { x: toXY.x - Math.cos(angle - 0.5) * arrowSize, y: toXY.y - Math.sin(angle - 0.5) * arrowSize };
  const p3 = { x: toXY.x - Math.cos(angle + 0.5) * arrowSize, y: toXY.y - Math.sin(angle + 0.5) * arrowSize };
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  head.setAttribute('points', `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`);
  head.setAttribute('fill', color); svg.appendChild(head);
}

function normalizeMove(move, sideToMove) {
  const m = String(move).replace(/[+#?!]/g, '');
  if (m === 'O-O' || m === '0-0') return sideToMove === 'w' ? 'e1g1' : 'e8g8';
  if (m === 'O-O-O' || m === '0-0-0') return sideToMove === 'w' ? 'e1c1' : 'e8c8';
  return m;
}

function drawMultiArrows(board, moves) {
  const flipped = board.classList.contains('flipped') || document.querySelector('.board.flipped') !== null;
  const playerColor = flipped ? 'b' : 'w';
  const trackerSide = window.chessMoveTracker?.getSideToMove?.();
  const sideToMove = trackerSide || playerColor;

  const normalizedMoves = moves.map(m => normalizeMove(m, sideToMove));
  const w = board.clientWidth, h = board.clientHeight;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cbr-overlay'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.position = 'absolute'; svg.style.top = '0'; svg.style.left = '0';
  svg.style.width = '100%'; svg.style.height = '100%'; svg.style.pointerEvents = 'none'; svg.style.zIndex = '9999';
  const styles = [
    { color: 'rgba(255, 170, 0, 0.9)', width: Math.max(4, w / 80) },
    { color: 'rgba(0, 150, 255, 0.8)', width: Math.max(3, w / 100) },
    { color: 'rgba(0, 200, 0, 0.7)', width: Math.max(2, w / 120) }
  ];
  const orderedMoves = [...normalizedMoves].reverse();
  orderedMoves.forEach((move, index) => {
    if (index >= 3 || !move || move.length < 4) return;
    const originalIdx = normalizedMoves.length - 1 - index;
    drawOneArrow(svg, move.substring(0, 2), move.substring(2, 4), board, flipped, styles[originalIdx].color, styles[originalIdx].width, originalIdx === 0);
  });
  const boardRect = board.getBoundingClientRect(), parentRect = board.parentElement.getBoundingClientRect();
  svg.style.left = `${boardRect.left - parentRect.left}px`; svg.style.top = `${boardRect.top - parentRect.top}px`;
  svg.style.width = `${boardRect.width}px`; svg.style.height = `${boardRect.height}px`;
  board.parentElement.style.position = 'relative'; board.parentElement.appendChild(svg);
}

function getNewBottomPlayerControls() {
  const bottom = document.querySelector('#board-layout-player-bottom');
  if (!bottom) return null;
  const player = bottom.querySelector('.player-component');
  const clock = bottom.querySelector('.clock-component');
  if (!player || !clock || !clock.parentElement) return null;
  return { bottom, player, clock };
}

function ensureNewLayoutControlsHost() {
  const ctx = getNewBottomPlayerControls();
  if (!ctx) return null;
  const { player, clock } = ctx;
  let host = player.querySelector('.cbr-player-controls');
  if (!host) {
    host = document.createElement('div');
    host.className = 'cbr-player-controls';

    Object.assign(host.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginRight: '8px',
      zIndex: '1000',
      flexShrink: '0'
    });
    clock.parentElement.insertBefore(host, clock);
  }
  let legendHost = host.querySelector('.cbr-legend-host');
  if (!legendHost) {
    legendHost = document.createElement('div');
    legendHost.className = 'cbr-legend-host';
    Object.assign(legendHost.style, {
      display: 'flex',
      alignItems: 'center'
    });
    host.appendChild(legendHost);
  }
  return { ...ctx, host, legendHost };
}
function drawLegend() {
  let container =
  document.querySelector('.cbr-player-controls .cbr-legend-host') ||
  document.querySelector('.cbr-legend-host');
  if (!container) {
    const newHost = ensureNewLayoutControlsHost();
    if (newHost) container = newHost.legendHost;
  }
  if (!container) {
    container = document.querySelector('.small-controls-rightIcons');
  }
  let isFallback = false;
  if (!container) {
    container = document.getElementById('cbr-legend-fallback');
    if (!container) {
      container = document.createElement('div');
      container.id = 'cbr-legend-fallback';
      Object.assign(container.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
                    zIndex: '2147483647'
      });
      document.body.appendChild(container);
    }
    isFallback = true;
  }
  if (container.querySelector('.cbr-legend-inner')) return;
  const legend = document.createElement('div');
  legend.className = 'cbr-legend-inner';
  if (isFallback) {
    Object.assign(legend.style, {
      backgroundColor: 'rgba(38, 36, 33, 0.9)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #444',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  color: '#fff',
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '13px'
    });
  } else {
    Object.assign(legend.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontSize: '12px',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif'
    });
  }
  legend.innerHTML = `
  <div style="display: flex; align-items: center; gap: 4px;" title="1-й вариант">
  <span style="display: inline-block; width: 12px; height: 4px; background: rgba(255, 170, 0, 0.9); border-radius: 2px;"></span>
  <span>1</span>
  </div>
  <div style="display: flex; align-items: center; gap: 4px;" title="2-й вариант">
  <span style="display: inline-block; width: 12px; height: 4px; background: rgba(0, 150, 255, 0.8); border-radius: 2px;"></span>
  <span>2</span>
  </div>
  <div style="display: flex; align-items: center; gap: 4px;" title="3-й вариант">
  <span style="display: inline-block; width: 12px; height: 4px; background: rgba(0, 200, 0, 0.7); border-radius: 2px;"></span>
  <span>3</span>
  </div>
  `;
  container.appendChild(legend);
}
function updateCastlingButton(btn) {
  btn.textContent = castlingDone ? 'Рокировка сделана' : 'Рокировка сделана';
  btn.style.background = castlingDone ? 'rgba(0, 200, 0, 0.6)' : 'rgba(60, 60, 60, 0.9)';
}
function injectCastlingButton() {
  const playerRow = document.querySelector('#board-layout-player-bottom .player-row-component');
  if (playerRow) {
    if (playerRow.querySelector('.cbr-castling-btn')) return;
    const wrapper = playerRow.querySelector('.player-row-wrapper');
    if (!wrapper) return;
    if (getComputedStyle(playerRow).position === 'static') {
      playerRow.style.position = 'relative';
    }
    const btn = document.createElement('button');
    btn.className = 'cbr-castling-btn';
    btn.type = 'button';
    Object.assign(btn.style, {
      position: 'absolute',
      right: '8px',
      top: '50%',
      transform: 'translateY(-50%)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid #666',
                  background: castlingDone ? 'rgba(0, 200, 0, 0.6)' : 'rgba(60, 60, 60, 0.9)',
                  color: '#fff',
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '12px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  zIndex: '1000'
    });
    updateCastlingButton(btn);
    btn.addEventListener('click', () => {
      castlingDone = !castlingDone;
      safeStorageSet({ castlingDone });
      updateCastlingButton(btn);
      sendPosition();
    });
    playerRow.appendChild(btn);
    return;
  }
  const ctx = ensureNewLayoutControlsHost();
  if (!ctx) return;
  const { host } = ctx;
  if (host.querySelector('.cbr-castling-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'cbr-castling-btn';
  btn.type = 'button';
  Object.assign(btn.style, {
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid #666',
    background: castlingDone ? 'rgba(0, 200, 0, 0.6)' : 'rgba(60, 60, 60, 0.9)',
                color: '#fff',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '12px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                zIndex: '1000',
                flexShrink: '0'
  });
  updateCastlingButton(btn);
  btn.addEventListener('click', () => {
    castlingDone = !castlingDone;
    safeStorageSet({ castlingDone });
    updateCastlingButton(btn);
    sendPosition();
  });
  host.appendChild(btn);
}
function scheduleCastlingButton() {
  safeStorageGet({ showArrows: true }, (data) => {
    if (data.showArrows) {
      injectCastlingButton();
    } else {
      const btn = document.querySelector('.cbr-castling-btn');
      if (btn) btn.remove();
    }
  });
}
if (isExtensionContextValid()) {
  try {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (!isExtensionContextValid()) return;
      if (namespace === 'local' && changes.castlingDone) {
        castlingDone = changes.castlingDone.newValue;
        const btn = document.querySelector('.cbr-castling-btn');
        if (btn) updateCastlingButton(btn);
      }
    });
  } catch (e) {}
}
if (isExtensionContextValid()) {
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!isExtensionContextValid()) return;
      if (msg?.type === 'HIGHLIGHT_MULTI_MOVES') {
        const board = document.querySelector(SELECTOR_BOARD);
        if (!board) return;
        clearHighlights();
        if (msg.moves && msg.moves.length > 0) {
          drawMultiArrows(board, msg.moves);
          drawLegend();
        }
      }
      if (msg?.type === 'CLEAR_ARROWS') {
        clearHighlights();
      }
      if (msg?.type === 'SET_CASTLING') {
        castlingDone = msg.value;
        const btn = document.querySelector('.cbr-castling-btn');
        if (btn) updateCastlingButton(btn);
      }
    });
  } catch (e) {}
}
function start() {
  const board = document.querySelector(SELECTOR_BOARD);
  if (!board) { setTimeout(start, 500); return; }
  sendPosition();
  scheduleCastlingButton();
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sendPosition();
      scheduleCastlingButton();
    });
  };
  new MutationObserver(schedule).observe(board, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  new MutationObserver(scheduleCastlingButton).observe(document.body, { subtree: true, childList: true });
}
window.addEventListener('focus', sendPosition);
safeStorageGet({ castlingDone: false }, (data) => {
  castlingDone = data.castlingDone;
});


if (isExtensionContextValid()) {
  try {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (!isExtensionContextValid()) return;
      if (namespace === 'local' && changes.showArrows) {
        scheduleCastlingButton();
      }
    });
  } catch (e) {}
}
start();
