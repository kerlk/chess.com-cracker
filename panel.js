/* Chess.com cracker — (c) 2026 kerlk (https://t.me/kerlk)
   Licensed under the Custom License v1.0+ (evergreen).
   The current version of the license is always available at:
   https://github.com/<nick>/<repo>/blob/main/LICENSE
   Modification prohibited. See LICENSE for details. */

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const evalBarWhite = document.getElementById('eval-bar-white');
const toggleArrows = document.getElementById('toggle-arrows');
const engineButtons = document.querySelectorAll('.engine-btn');

let isCastlingDone = false;
let selectedEngine = 'stockfish';
const castlingBtn = document.getElementById('panel-castling-btn');

function updateEngineUI() {
  engineButtons.forEach(btn => {
    const isActive = btn.dataset.engine === selectedEngine;
    btn.classList.toggle('active', isActive);
  });
}

engineButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedEngine = btn.dataset.engine;
    chrome.storage.local.set({ selectedEngine });
    updateEngineUI();
    
    chrome.runtime.sendMessage({ type: 'REQUEST_REANALYSIS' }).catch(() => {});
  });
});

function showArrowsFromCheckbox(checked) {
  return !checked;
}

function updateCastlingVisibility() {
  if (!castlingBtn || !toggleArrows) return;
  const showArrows = showArrowsFromCheckbox(toggleArrows.checked);
  castlingBtn.classList.toggle('hidden', showArrows);
}

chrome.storage.local.get({ showArrows: true, castlingDone: false, selectedEngine: 'stockfish' }, (data) => {
  if (toggleArrows) toggleArrows.checked = !data.showArrows;
  isCastlingDone = data.castlingDone;
  selectedEngine = data.selectedEngine;
  updateCastlingUI();
  updateCastlingVisibility();
  updateEngineUI();
});

if (toggleArrows) {
  toggleArrows.addEventListener('change', () => {
    const showArrows = showArrowsFromCheckbox(toggleArrows.checked);
    chrome.storage.local.set({ showArrows });
    if (!showArrows) {
      chrome.runtime.sendMessage({ type: 'CLEAR_ARROWS' }).catch(() => {});
    }
    updateCastlingVisibility();
  });
}

if (castlingBtn) {
  castlingBtn.addEventListener('click', () => {
    isCastlingDone = !isCastlingDone;
    chrome.storage.local.set({ castlingDone: isCastlingDone });
    updateCastlingUI();

    chrome.runtime.sendMessage({ type: 'SET_CASTLING', value: isCastlingDone }).catch(() => {});
  });
}

function updateCastlingUI() {
  if (!castlingBtn) return;
  castlingBtn.style.background = isCastlingDone ? 'rgba(0, 200, 0, 0.6)' : 'rgba(60, 60, 60, 0.9)';
  castlingBtn.textContent = isCastlingDone ? 'Рокировка сделана' : 'Рокировка сделана';
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  if (changes.showArrows && toggleArrows) {
    toggleArrows.checked = !changes.showArrows.newValue;
    updateCastlingVisibility();
  }

  if (changes.castlingDone) {
    isCastlingDone = changes.castlingDone.newValue;
    updateCastlingUI();
  }

  if (changes.selectedEngine) {
    selectedEngine = changes.selectedEngine.newValue;
    updateEngineUI();
  }
});

function render(pos) {
  if (!pos) {
    if (statusEl) statusEl.textContent = 'Позиция не получена';
    return;
  }

  const map = new Map();
  for (const { piece, square } of pos.pieces) map.set(square, piece);

  const files = ['1','2','3','4','5','6','7','8'];
  const ranks = ['8','7','6','5','4','3','2','1'];
  const fileOrder = pos.flipped ? [...files].reverse() : files;
  const rankOrder = pos.flipped ? [...ranks].reverse() : ranks;

  boardEl.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = fileOrder[f];
      const rank = rankOrder[r];
      const sq = `${file}${rank}`;
      const isLight = (Number(file) + Number(rank)) % 2 === 0;
      const cell = document.createElement('div');
      cell.className = `sq ${isLight ? 'light' : 'dark'}`;
      cell.setAttribute('data-square', sq);
      const piece = map.get(sq);
      if (piece) {
        const img = document.createElement('img');
        let imgSrc = pos.images && pos.images[piece];
        if (!imgSrc) {
          imgSrc = `https://assets-themes.chess.com/image/nw662/150/${piece}.png`;
        }
        img.src = imgSrc;
        img.className = 'piece-img';
        img.alt = piece;
        cell.appendChild(img);
      }
      boardEl.appendChild(cell);
    }
  }

  if (statusEl) statusEl.textContent = 'Позиция получена';
}

function updateEvalBar(cp) {
  if (!evalBarWhite) return;
  const maxCp = 1000;
  const clamped = Math.max(-maxCp, Math.min(maxCp, cp));
  const percentage = ((clamped + maxCp) / (maxCp * 2)) * 100;
  evalBarWhite.style.height = `${percentage}%`;
  if (statusEl) statusEl.textContent = `Оценка: ${(cp / 100).toFixed(2)}`;
}

function drawPanelArrows(moves) {
  if (!boardEl) return;

  boardEl.querySelectorAll('.cbr-panel-overlay').forEach(el => el.remove());
  if (!moves || moves.length === 0) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cbr-panel-overlay');
  svg.setAttribute('viewBox', `0 0 ${boardEl.clientWidth} ${boardEl.clientHeight}`);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '100';

  const w = boardEl.clientWidth;
  const cellSize = w / 8;

  const styles = [
    { color: 'rgba(255, 170, 0, 0.9)', width: Math.max(4, w / 80) },
    { color: 'rgba(0, 150, 255, 0.8)', width: Math.max(3, w / 100) },
    { color: 'rgba(0, 200, 0, 0.7)', width: Math.max(2, w / 120) }
  ];

  function getXYFromDOM(sq) {
    const fileMap = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const sqNum = `${fileMap[sq[0].toLowerCase()]}${sq[1]}`;

    const cell = boardEl.querySelector(`[data-square="${sqNum}"]`);
    if (!cell) return null;

    const cellRect = cell.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    return {
      x: (cellRect.left - boardRect.left) + (cellRect.width / 2),
      y: (cellRect.top - boardRect.top) + (cellRect.height / 2)
    };
  }

  const orderedMoves = [...moves].reverse();
  orderedMoves.forEach((move, idx) => {
    if (idx >= 3 || !move || move.length < 4) return;
    const from = getXYFromDOM(move.substring(0, 2));
    const to = getXYFromDOM(move.substring(2, 4));
    if (!from || !to) return;

    const originalIdx = moves.length - 1 - idx;
    const style = styles[originalIdx];
    const arrowSize = cellSize * (idx === 0 ? 0.5 : 0.4);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const lineEnd = {
      x: to.x - Math.cos(angle) * (arrowSize * 0.8),
      y: to.y - Math.sin(angle) * (arrowSize * 0.8)
    };

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
    line.setAttribute('x2', lineEnd.x); line.setAttribute('y2', lineEnd.y);
    line.setAttribute('stroke', style.color);
    line.setAttribute('stroke-width', style.width);
    svg.appendChild(line);

    const p1 = { x: to.x, y: to.y };
    const p2 = { x: to.x - Math.cos(angle - 0.5) * arrowSize, y: to.y - Math.sin(angle - 0.5) * arrowSize };
    const p3 = { x: to.x - Math.cos(angle + 0.5) * arrowSize, y: to.y - Math.sin(angle + 0.5) * arrowSize };

    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute('points', `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`);
    head.setAttribute('fill', style.color);
    svg.appendChild(head);
  });

  boardEl.appendChild(svg);
}

let currentFen = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'POSITION_UPDATE') {
    render(msg.payload);
    if (msg.payload && msg.payload.fen) {
      currentFen = msg.payload.fen;
    }
  }

  if (msg?.type === 'ENGINE_LINE') {
    const line = msg.line;
    if (typeof line !== 'string') return;

    if (line.startsWith('info') && line.includes(' score ')) {
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);

      let rawEval = null;
      if (mateMatch) {
        rawEval = parseInt(mateMatch[1]) > 0 ? 10000 : -10000;
      } else if (cpMatch) {
        rawEval = parseInt(cpMatch[1]);
      }
      if (rawEval === null) return;

      const fenTurn = currentFen ? currentFen.split(' ')[1] : 'w';
      const evalScore = (fenTurn === 'b') ? -rawEval : rawEval;
      updateEvalBar(evalScore);
    }
  }

  if (msg?.type === 'ENGINE_MULTI_MOVES') {
    if (selectedEngine === 'stockfish') {
      drawPanelArrows(msg.moves);
    }
  }

  if (msg?.type === 'MAIA_MOVES') {
    if (selectedEngine === 'maia') {
      drawPanelArrows(msg.moves);
      if (statusEl && msg.winProbability !== undefined) {
        statusEl.textContent = `Maia: ${(msg.winProbability * 100).toFixed(1)}%`;
      }
    }
  }
});

chrome.runtime.sendMessage({ type: 'GET_POSITION' }, (pos) => {
  if (chrome.runtime.lastError) {
    if (statusEl) statusEl.textContent = 'Ошибка: ' + chrome.runtime.lastError.message;
    return;
  }
  if (pos) {
    render(pos);
    currentFen = pos.fen;
  }
});
