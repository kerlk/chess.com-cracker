let creatingOffscreen = null;

async function setupOffscreenDocument(forceRestart = false) {
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
      if (forceRestart) {
        await chrome.offscreen.closeDocument();
      } else {
        return;
      }
    }

    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run Stockfish engine for analysis'
    });
    await creatingOffscreen;
  } catch (e) {
    console.error('offscreen create error:', e);
  } finally {
    creatingOffscreen = null;
  }
}

chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: chrome.runtime.getURL('panel.html'),
    type: 'popup',
    width: 400,
    height: 500
  });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.showArrows) {
    setupOffscreenDocument(true).catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'POSITION') {
    chrome.storage.local.set({ lastPosition: msg.payload });
    chrome.runtime.sendMessage({ type: 'POSITION_UPDATE', payload: msg.payload }).catch(() => {});

    setupOffscreenDocument().catch(console.error);

    chrome.storage.local.get({ showArrows: true }, (cfg) => {
      chrome.runtime.sendMessage({
        type: 'START_ANALYSIS',
        fen: msg.payload.fen,
        showArrows: cfg.showArrows
      }).catch(() => {});
    });
    return;
  }

  if (msg?.type === 'REQUEST_REANALYSIS') {
    setupOffscreenDocument().catch(console.error);

    chrome.storage.local.get(['lastPosition'], (data) => {
      if (data.lastPosition && data.lastPosition.fen) {
        chrome.runtime.sendMessage({
          type: 'START_ANALYSIS',
          fen: data.lastPosition.fen
        }).catch(() => {});
      }
    });
    return;
  }

  if (msg?.type === 'GET_POSITION') {
    chrome.storage.local.get('lastPosition', (data) => {
      sendResponse(data.lastPosition || null);
    });
    return true;
  }

  if (msg?.type === 'ENGINE_LINE') {
    chrome.runtime.sendMessage({ type: 'ENGINE_LINE', line: msg.line }).catch(() => {});
    return;
  }

  if (msg?.type === 'ENGINE_MULTI_MOVES') {
    chrome.runtime.sendMessage({ type: 'ENGINE_MULTI_MOVES', moves: msg.moves }).catch(() => {});

    chrome.storage.local.get({ showArrows: true }, (data) => {
      if (!data.showArrows) return;

      chrome.tabs.query({ url: "https://www.chess.com/*" }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_MULTI_MOVES', moves: msg.moves }).catch(() => {});
        }
      });
    });
    return;
  }

  if (msg?.type === 'CLEAR_ARROWS') {
    chrome.tabs.query({ url: "https://www.chess.com/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_ARROWS' }).catch(() => {});
      }
    });
    return;
  }

  if (msg?.type === 'SET_CASTLING') {
    chrome.tabs.query({ url: "https://www.chess.com/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'SET_CASTLING', value: msg.value }).catch(() => {});
      }
    });
    return;
  }
});