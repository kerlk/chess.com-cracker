/* Chess.com cracker — (c) 2026 kerlk (https://t.me/kerlk)
   Licensed under the Custom License v1.0+ (evergreen).
   The current version of the license is always available at:
   https://github.com/<nick>/<repo>/blob/main/LICENSE
   Modification prohibited. See LICENSE for details. */

(function initMoveTracker() {
  const SELECTOR_BOARD = 'wc-chess-board';
  const MOVE_LIST_SELECTOR = 'wc-simple-move-list';

  const state = {
    sideToMove: null,
    playerColor: null,
    lastMove: null,
    lastMoveColor: null,
    lastMoveWasCastling: null,
    moveCount: 0,
    castling: {
      white: { king: false, queen: false },
      black: { king: false, queen: false }
    },
    hasMoveList: false
  };

  function readPlayerColor() {
    const board = document.querySelector(SELECTOR_BOARD);
    if (!board) return null;
    const flipped = board.classList.contains('flipped');
    return flipped ? 'b' : 'w';
  }

  function parseMoveList() {
    const moveList = document.querySelector(MOVE_LIST_SELECTOR);
    if (!moveList) return null;

    const moves = [];
    const nodes = moveList.querySelectorAll('[data-node]');

    nodes.forEach((node, index) => {
      const content = node.querySelector('.node-highlight-content');
      if (!content) return;
      const text = content.textContent.trim();
      if (!text) return;

      const nodeAttr = node.getAttribute('data-node') || '';
      const match = nodeAttr.match(/(\d+)-(\d+)$/);
      const ply = match ? parseInt(match[2], 10) : index;

      moves.push({ ply, text });
    });

    return moves;
  }

  function detectCastling(moves) {
    state.castling = {
      white: { king: false, queen: false },
      black: { king: false, queen: false }
    };
    state.lastMoveWasCastling = null;
    state.lastMoveColor = null;

    moves.forEach((move, index) => {
      const text = move.text.replace(/[+#?!]/g, '').trim();
      const isWhite = (index % 2 === 0); // чётный индекс = ход белых
      const color = isWhite ? 'w' : 'b';

      if (text === 'O-O' || text === '0-0') {
        if (isWhite) state.castling.white.king = true;
        else state.castling.black.king = true;
        if (index === moves.length - 1) {
          state.lastMoveWasCastling = 'short';
          state.lastMoveColor = color;
        }
      } else if (text === 'O-O-O' || text === '0-0-0') {
        if (isWhite) state.castling.white.queen = true;
        else state.castling.black.queen = true;
        if (index === moves.length - 1) {
          state.lastMoveWasCastling = 'long';
          state.lastMoveColor = color;
        }
      } else if (index === moves.length - 1) {
        state.lastMoveColor = color;
      }
    });
  }

  function update() {
    const playerColor = readPlayerColor();
    const moves = parseMoveList();

    if (playerColor !== null) {
      state.playerColor = playerColor;
    }

    if (!moves || moves.length === 0) {
      state.sideToMove = null;
      state.lastMove = null;
      state.lastMoveColor = null;
      state.lastMoveWasCastling = null;
      state.moveCount = 0;
      state.hasMoveList = false;
      state.castling = { white: { king: false, queen: false }, black: { king: false, queen: false } };
      return;
    }

    state.hasMoveList = true;
    state.moveCount = moves.length;
    state.lastMove = moves[moves.length - 1].text;

    state.sideToMove = (moves.length % 2 === 0) ? 'w' : 'b';

    detectCastling(moves);
  }

  function startObserver() {
    const moveList = document.querySelector(MOVE_LIST_SELECTOR);
    if (!moveList) {
      setTimeout(startObserver, 500);
      return;
    }

    const schedule = () => {
      requestAnimationFrame(update);
    };

    new MutationObserver(schedule).observe(moveList, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });

    const bodyObserver = new MutationObserver(() => {
      const current = document.querySelector(MOVE_LIST_SELECTOR);
      if (current && current !== moveList) {
        bodyObserver.disconnect();
        startObserver();
      }
    });
    bodyObserver.observe(document.body, { subtree: true, childList: true });

    update();
  }

  window.chessMoveTracker = {
    getState() {
      update();
      return {
        ...state,
        castling: JSON.parse(JSON.stringify(state.castling))
      };
    },
    getSideToMove() {
      update();
      return state.sideToMove;
    },
    getPlayerColor() {
      update();
      return state.playerColor;
    },
    getCastling() {
      update();
      return JSON.parse(JSON.stringify(state.castling));
    },
    refresh: update
  };

  startObserver();
})();