/* Chess.com cracker — (c) 2026 kerlk (https://t.me/kerlk)
   Licensed under the Custom License v1.0+ (evergreen).
   The current version of the license is always available at:
   https://github.com/<nick>/<repo>/blob/main/LICENSE
   Modification prohibited. See LICENSE for details. */

let engines = [];
let bestMoves = { 1: null, 2: null, 3: null };

function initEngines() {
  for (let i = 0; i < 2; i++) {
    let worker;
    try {
      worker = new Worker('engine/stockfish-19.js');
    } catch (err) {
      continue;
    }

    worker.onmessage = (event) => {
      const line = event.data;
      if (typeof line !== 'string') return;

      if (i === 0) {
        chrome.runtime.sendMessage({ type: 'ENGINE_LINE', line: line }).catch(() => {});
      }

      if (i === 1) {
        if (line.startsWith('bestmove')) {
          const moves = [bestMoves[1], bestMoves[2], bestMoves[3]].filter(Boolean);
          chrome.runtime.sendMessage({ type: 'ENGINE_MULTI_MOVES', moves: moves }).catch(() => {});
          bestMoves = { 1: null, 2: null, 3: null };
          return;
        }
        if (line.startsWith('info') && line.includes(' pv ') && line.includes(' multipv ')) {
          const multipvMatch = line.match(/multipv (\d+)/);
          const pvMatch = line.match(/ pv (\w+)/);
          if (multipvMatch && pvMatch) {
            const pvIndex = parseInt(multipvMatch[1]);
            const move = pvMatch[1];
            if (pvIndex >= 1 && pvIndex <= 3) {
              bestMoves[pvIndex] = move;
            }
          }
        }
      }
    };

    worker.onerror = (e) => {
      e.preventDefault();
    };

    worker.postMessage('uci');
    worker.postMessage('setoption name Hash value 32');
    worker.postMessage('isready');
    engines.push(worker);
  }
  if (engines.length > 1) {
    engines[1].postMessage('setoption name MultiPV value 3');
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'START_ANALYSIS' && msg.fen) {
    if (engines[0]) {
      engines[0].postMessage('stop');
      engines[0].postMessage(`position fen ${msg.fen}`);
      engines[0].postMessage('go depth 15');
    }

    if (engines[1]) {
      engines[1].postMessage('stop');
      engines[1].postMessage(`position fen ${msg.fen}`);
      engines[1].postMessage('go depth 12');
    }
  }
});

initEngines();
