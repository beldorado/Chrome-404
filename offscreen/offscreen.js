import { AudioEngine } from '../engine/engine.js';
import { PRESETS } from '../engine/presets.js';
import { loadWorklets } from '../effects/registry.js';
import { MSG, TARGET } from '../shared/messages.js';

const METER_INTERVAL_MS = 80;
const MODULATION_INTERVAL_MS = 20;

const ctx = new AudioContext({ latencyHint: 'interactive' });

function broadcast(message) {
  chrome.runtime.sendMessage({ target: TARGET.BROADCAST, ...message }).catch(() => {});
}

const engine = new AudioEngine(ctx, {
  onChange: (state) => broadcast({ type: MSG.STATE, state })
});

const ready = (async () => {
  await loadWorklets(ctx);
  await engine.startTempoDetection();
  const saved = await chrome.runtime.sendMessage({ target: TARGET.BACKGROUND, type: MSG.ENGINE_READY }).catch(() => null);
  engine.applySettings(saved);
})();

async function captureTab({ streamId, tabId, label }) {
  if (engine.hasTab(tabId)) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  await ctx.resume();
  engine.addStreamSource(stream, { id: `tab-${tabId}`, kind: 'tab', label, tabId });
}

const handlers = {
  [MSG.GET_STATE]: () => {},
  [MSG.ADD_TAB_SOURCE]: captureTab,
  [MSG.REMOVE_SOURCE]: ({ sourceId }) => engine.removeSource(sourceId),
  [MSG.UPDATE_SOURCE]: ({ sourceId, changes }) => engine.updateSource(sourceId, changes),
  [MSG.ADD_SLOT]: ({ busId, effectId }) => engine.addSlot(busId, effectId),
  [MSG.REMOVE_SLOT]: ({ busId, slot }) => engine.removeSlot(busId, slot),
  [MSG.MOVE_SLOT]: ({ busId, slot, delta }) => engine.moveSlot(busId, slot, delta),
  [MSG.SET_SLOT_ENABLED]: ({ busId, slot, enabled }) => engine.setSlotEnabled(busId, slot, enabled),
  [MSG.SET_PARAM]: ({ busId, slot, paramId, value }) => engine.setParam(busId, slot, paramId, value),
  [MSG.SET_LFO]: ({ busId, slot, changes }) => engine.setLfo(busId, slot, changes),
  [MSG.SET_INPUT_ROUTE]: ({ route }) => engine.setInputRoute(route),
  [MSG.SET_BPM]: ({ bpm }) => engine.setBpm(bpm),
  [MSG.SET_AUTO_BPM]: ({ enabled }) => engine.setAutoBpm(enabled),
  [MSG.SET_MASTER]: ({ level }) => engine.setMaster(level),
  [MSG.LOAD_PRESET]: ({ presetId }) => {
    if (PRESETS[presetId]) engine.loadPreset(PRESETS[presetId]);
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== TARGET.OFFSCREEN) return false;
  const handler = handlers[message.type];
  if (!handler) return false;
  ready
    .then(() => handler(message))
    .then(
      () => sendResponse({ ok: true, result: engine.snapshot() }),
      (err) => sendResponse({ ok: false, error: String(err?.message ?? err) })
    );
  return true;
});

setInterval(() => {
  if (engine.state.sources.length) broadcast({ type: MSG.METER, level: engine.level() });
}, METER_INTERVAL_MS);

setInterval(() => engine.tickModulation(ctx.currentTime), MODULATION_INTERVAL_MS);
