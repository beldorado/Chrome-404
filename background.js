import { MSG, TARGET } from './shared/messages.js';
import { settingsFrom } from './shared/state.js';

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
const SETTINGS_KEY = 'engineSettings';
const PENDING_KEY = 'pendingTabs';
const MENU_CAPTURE = 'chrome404-capture';

let creating = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  creating ??= (async () => {
    if (await hasOffscreen()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Runs the Chrome-404 audio engine on captured tab audio'
    });
  })().finally(() => {
    creating = null;
  });
  await creating;
}

function toOffscreen(type, payload = {}) {
  return chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type, ...payload });
}

async function capturedTabIds() {
  if (!(await hasOffscreen())) return new Set();
  const response = await toOffscreen(MSG.GET_STATE).catch(() => null);
  return new Set((response?.result?.sources ?? []).map((s) => s.tabId));
}

async function updatePending(change) {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  await chrome.storage.session.set({ [PENDING_KEY]: change(stored[PENDING_KEY] ?? []) });
}

function pendingEntry(tab) {
  return { tabId: tab.id, windowId: tab.windowId, title: tab.title || `Tab ${tab.id}` };
}

function isCapturable(tab) {
  return /^(https?|file):/.test(tab.url ?? '');
}

async function captureTab(tab) {
  try {
    await ensureOffscreen();
    if ((await capturedTabIds()).has(tab.id)) return { ok: true };
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const response = await toOffscreen(MSG.ADD_TAB_SOURCE, { streamId, tabId: tab.id, label: tab.title || `Tab ${tab.id}` });
    if (!response?.ok) throw new Error(response?.error ?? 'Capture failed');
    await updatePending((list) => list.filter((p) => p.tabId !== tab.id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

async function invokeCapture(tab) {
  const result = await captureTab(tab);
  if (result.ok) await chrome.storage.session.remove('lastError');
  else await chrome.storage.session.set({ lastError: { message: result.error, at: Date.now() } });
}

function openPanelAndCapture(tab) {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  invokeCapture(tab);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_CAPTURE,
    title: 'Capture this tab in Chrome-404',
    contexts: ['page', 'audio', 'video']
  });
});

chrome.action.onClicked.addListener(openPanelAndCapture);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_CAPTURE && tab) openPanelAndCapture(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.audible === undefined && changeInfo.title === undefined) return;
  if (changeInfo.audible === false) {
    await updatePending((list) => list.filter((p) => p.tabId !== tabId));
    return;
  }
  if (!tab.audible || !isCapturable(tab)) return;
  if ((await capturedTabIds()).has(tabId)) return;
  await updatePending((list) => [...list.filter((p) => p.tabId !== tabId), pendingEntry(tab)]);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updatePending((list) => list.filter((p) => p.tabId !== tabId));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target === TARGET.BROADCAST && message.type === MSG.STATE) {
    chrome.storage.local.set({ [SETTINGS_KEY]: settingsFrom(message.state) });
    const captured = new Set(message.state.sources.map((s) => s.tabId));
    updatePending((list) => (list.some((p) => captured.has(p.tabId)) ? list.filter((p) => !captured.has(p.tabId)) : list));
    return false;
  }
  if (message.target !== TARGET.BACKGROUND) return false;

  const reply = (promise) => {
    promise.then(
      (result) => sendResponse({ ok: true, result }),
      (err) => sendResponse({ ok: false, error: String(err?.message ?? err) })
    );
    return true;
  };

  if (message.type === MSG.ENGINE_READY) {
    chrome.storage.local.get(SETTINGS_KEY).then((data) => sendResponse(data[SETTINGS_KEY] ?? null));
    return true;
  }
  if (message.type === MSG.ENSURE_ENGINE) return reply(ensureOffscreen());
  return false;
});
