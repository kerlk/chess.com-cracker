/* Chess.com cracker — (c) 2026 kerlk (https://t.me/kerlk)
   Licensed under the Custom License v1.0+ (evergreen).
   The current version of the license is always available at:
   https://github.com/<nick>/<repo>/blob/main/LICENSE
   Modification prohibited. See LICENSE for details. */

import { Maia3 } from './engine/maia3/dist/web/index.web.js';

let engines = [];
let bestMoves = { 1: null, 2: null, 3: null };
let maia = null;
let maiaReady = false;
let maiaLoading = false;
let maiaFailed = false;
let maiaAttempts = 0;

function initStockfish() {
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

async function initMaia() {
  if (maiaLoading || maiaReady || maiaFailed) return;
  if (maiaAttempts >= 2) {
    maiaFailed = true;
    return;
  }
  maiaLoading = true;
  maiaAttempts++;
  
  try {
    const modelUrl = chrome.runtime.getURL('engine/maia3/models/maia3_5m.onnx');
    const modelResponse = await fetch(modelUrl);
    if (!modelResponse.ok) {
      throw new Error(`Failed to fetch model: ${modelResponse.status}`);
    }
    const modelBytes = await modelResponse.arrayBuffer();
    
    maia = new Maia3({
      variant: '5m',
      modelBytes: modelBytes,
      numThreads: 1,
      simd: true
    });
    
    await maia.load();
    maiaReady = true;
  } catch (e) {
    console.error('[Maia3] Init error:', e);
    maia = null;
    if (maiaAttempts >= 2) {
      maiaFailed = true;
    }
  } finally {
    maiaLoading = false;
  }
}

async function analyzeWithMaia(fen, historyFens = []) {
  if (!maiaReady || !maia) return;
  
  try {
    const result = await maia.predict({
      fen: fen,
      selfElo: 2600,
      oppoElo: 2600,
      priorFens: historyFens.length > 0 ? historyFens : undefined
    });
    
    const moves = result.candidates
      .slice(0, 3)
      .map(c => c.uci);
    
    chrome.runtime.sendMessage({ 
      type: 'MAIA_MOVES', 
      moves: moves,
      winProbability: result.winProbability 
    }).catch(() => {});
  } catch (e) {
    console.error('[Maia3] Analysis error:', e);
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

    if (maiaReady) {
      analyzeWithMaia(msg.fen, msg.historyFens || []);
    } else if (!maiaLoading && !maiaFailed) {
      initMaia().then(() => {
        if (maiaReady) {
          analyzeWithMaia(msg.fen, msg.historyFens || []);
        }
      });
    }
  }
});

initStockfish();
initMaia();

