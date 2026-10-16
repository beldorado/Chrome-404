import { AudioEngine } from '../engine/engine.js';
import { PRESETS } from '../engine/presets.js';
import { loadWorklets } from '../effects/registry.js';
import { MSG, TARGET } from '../shared/messages.js';
import { bufferFromRecord, clipRecord, deleteClip, getAllClips, getClip, putClip } from '../shared/pad-store.js';
import { PAD_COUNT } from '../shared/state.js';

const METER_INTERVAL_MS = 80;
const MODULATION_INTERVAL_MS = 20;

const ctx = new AudioContext({ latencyHint: 'interactive' });

function broadcast(message) {
  chrome.runtime.sendMessage({ target: TARGET.BROADCAST, ...message }).catch(() => {});
}

function reportError(err) {
  chrome.storage.session.set({ lastError: { message: String(err?.message ?? err), at: Date.now() } });
}

const engine = new AudioEngine(ctx, {
  onChange: (state) => broadcast({ type: MSG.STATE, state }),
  onClip: (index, buffer, meta) => putClip(clipRecord(index, buffer, meta)).catch(reportError)
});

async function restorePads() {
  for (const record of await getAllClips()) {
    if (record?.channels?.length) engine.setPadClip(record.index, bufferFromRecord(ctx, record), record);
  }
}

const ready = (async () => {
  await loadWorklets(ctx);
  await engine.startTempoDetection();
  await engine.startRecorder();
  const saved = await chrome.runtime.sendMessage({ target: TARGET.BACKGROUND, type: MSG.ENGINE_READY }).catch(() => null);
  engine.applySettings(saved);
  await restorePads().catch(reportError);
})();

async function captureTab({ streamId, tabId, label }) {
  if (engine.hasTab(tabId)) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  await ctx.resume();
  engine.addStreamSource(stream, { id: `tab-${tabId}`, kind: 'tab', label, tabId });
}

function heardTime(at) {
  const transit = Number.isFinite(at) ? Math.max(0, (Date.now() - at) / 1000) : 0;
  return ctx.currentTime - transit - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
}

async function loadStoredPad({ index }) {
  const record = await getClip(index);
  if (!record?.channels?.length) throw new Error('That sample could not be read back. Try loading it again.');
  engine.setPadClip(index, bufferFromRecord(ctx, record), record);
}

function padIndices({ index, indices }) {
  return (Array.isArray(indices) ? indices : [index]).filter((i) => Number.isInteger(i) && i >= 0 && i < PAD_COUNT);
}

function updatePads(message) {
  engine.batch(() => padIndices(message).forEach((i) => engine.updatePad(i, message.changes)));
}

async function setPadBpm(message) {
  const values = new Map();
  engine.batch(() => padIndices(message).forEach((i) => values.set(i, engine.setPadBpm(i, message.bpm))));
  for (const [index, value] of values) {
    if (value === undefined) continue;
    const record = await getClip(index);
    if (record?.channels?.length) await putClip({ ...record, bpm: value });
  }
}

async function transferPad({ from, to, mode }) {
  const [source, target] = await Promise.all([getClip(from), getClip(to)]);
  if (!engine.transferPad(from, to, mode)) throw new Error('That pad has no sample to move.');
  if (source?.channels?.length) await putClip({ ...source, index: to });
  if (mode === 'swap' && target?.channels?.length) await putClip({ ...target, index: from });
  else if (mode !== 'copy') await deleteClip(from);
}

async function clearPads(message) {
  const indices = padIndices(message);
  engine.batch(() => indices.forEach((i) => engine.clearPad(i)));
  for (const index of indices) await deleteClip(index);
}

const handlers = {
  [MSG.GET_STATE]: () => {},
  [MSG.ADD_TAB_SOURCE]: captureTab,
  [MSG.REMOVE_SOURCE]: ({ sourceId }) => engine.removeSource(sourceId),
  [MSG.UPDATE_SOURCE]: ({ sourceId, changes }) => engine.updateSource(sourceId, changes),
  [MSG.ADD_SLOT]: ({ busId, effectId }) => engine.addSlot(busId, effectId, { recall: true }),
  [MSG.SWAP_SLOT]: ({ busId, slot, effectId }) => engine.swapSlot(busId, slot, effectId),
  [MSG.REMOVE_SLOT]: ({ busId, slot }) => engine.removeSlot(busId, slot),
  [MSG.MOVE_SLOT]: ({ busId, slot, delta }) => engine.moveSlot(busId, slot, delta),
  [MSG.SET_SLOT_ENABLED]: ({ busId, slot, enabled }) => engine.setSlotEnabled(busId, slot, enabled),
  [MSG.SET_BUS_ENGAGED]: ({ busId, engaged }) => engine.setBusEngaged(busId, engaged),
  [MSG.SET_PARAM]: ({ busId, slot, paramId, value }) => engine.setParam(busId, slot, paramId, value),
  [MSG.SET_LFO]: ({ busId, slot, changes }) => engine.setLfo(busId, slot, changes),
  [MSG.SET_INPUT_ROUTE]: ({ route }) => engine.setInputRoute(route),
  [MSG.SET_PAD_ROUTE]: ({ route }) => engine.setPadRoute(route),
  [MSG.SET_BUS_ROUTING]: ({ routing }) => engine.setBusRouting(routing),
  [MSG.SET_BPM]: ({ bpm }) => engine.setBpm(bpm),
  [MSG.TAP]: ({ bpm, beat, at }) => engine.tap({ bpm, beat, time: heardTime(at) }),
  [MSG.SET_AUTO_BPM]: ({ enabled }) => engine.setAutoBpm(enabled),
  [MSG.SET_QUANTIZE]: ({ quantize }) => engine.setQuantize(quantize),
  [MSG.SET_MASTER]: ({ level }) => engine.setMaster(level),
  [MSG.SET_CROSSFADER]: ({ value }) => engine.setCrossfader(value),
  [MSG.PAD_PRESS]: async ({ index }) => {
    await ctx.resume();
    engine.padPress(index);
  },
  [MSG.PAD_RELEASE]: async ({ index }) => {
    await ctx.resume();
    engine.padRelease(index);
  },
  [MSG.STOP_PADS]: () => engine.stopPads(),
  [MSG.UPDATE_PAD]: updatePads,
  [MSG.CLEAR_PAD]: clearPads,
  [MSG.PAD_STORED]: loadStoredPad,
  [MSG.START_RECORDING]: async ({ pad, length }) => {
    await ctx.resume();
    if (engine.state.recording) throw new Error('A recording is already running. Stop it before starting another.');
    if (!engine.startRecording({ pad, length })) throw new Error('Recording could not start. Reload the extension and try again.');
  },
  [MSG.STOP_RECORDING]: () => engine.stopRecording(),
  [MSG.SET_PAD_REGION]: ({ index, start, end }) => engine.setPadRegion(index, start, end),
  [MSG.SET_PAD_BPM]: setPadBpm,
  [MSG.TRANSFER_PAD]: transferPad,
  [MSG.STOP_PAD]: ({ index }) => engine.stopPad(index),
  [MSG.PREVIEW]: async ({ index, start, end }) => {
    await ctx.resume();
    engine.setLatency((ctx.outputLatency || 0) + (ctx.baseLatency || 0));
    if (!engine.preview(index, start, end)) throw new Error('That pad has no audio to play.');
  },
  [MSG.STOP_PREVIEW]: () => engine.stopPreview(),
  [MSG.LOAD_PRESET]: ({ presetId, preset }) => {
    if (PRESETS[presetId]) engine.loadPreset(PRESETS[presetId]);
    else if (preset && typeof preset === 'object') engine.loadPreset(preset);
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

function busy() {
  return engine.state.sources.length > 0 || engine.state.recording !== null || engine.state.pads.some((p) => p.playing);
}

setInterval(() => {
  if (busy()) broadcast({ type: MSG.METER, level: engine.level(), transport: engine.transport() });
}, METER_INTERVAL_MS);

setInterval(() => engine.tickModulation(ctx.currentTime), MODULATION_INTERVAL_MS);
