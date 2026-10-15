import { Bus } from './bus.js';
import { TempoDetector } from './tempo-detector.js';
import { BUS_IDS, MAX_SLOTS, ROUTES, defaultState, settingsFrom } from '../shared/state.js';
import { defaultParams, getEffect, isAvailable } from '../effects/registry.js';
import { clamp, fromNormalized, sanitizeParam, toNormalized } from '../shared/params.js';
import { LFO_PARAMS, Lfo, defaultLfo, isModulatable } from '../shared/lfo.js';
import { divisionBeats } from '../shared/sync.js';
import { clampBpm } from '../shared/tempo.js';

const MASTER_MAX = 1.5;
const AUTO_BPM_CONFIDENCE = 0.2;
const AUTO_BPM_MIN_CHANGE = 0.5;
const MAX_TICK = 0.25;
const LFO_SEED = 0x9e3779b9;

export class AudioEngine {
  constructor(ctx, { destination = ctx.destination, onChange = () => {} } = {}) {
    this.ctx = ctx;
    this.onChange = onChange;
    this.state = defaultState();
    this.sources = new Map();
    this.batchDepth = 0;
    this.tempo = null;
    this.lastTick = null;
    this.slotCounter = 0;
    this.lfos = new Map();

    this.buses = Object.fromEntries(BUS_IDS.map((id) => [id, new Bus(ctx, id)]));
    this.dry = ctx.createGain();
    this.analysisIn = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = this.state.master;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.meterBuffer = new Float32Array(this.analyser.fftSize);

    const { bus1, bus2, bus3, bus4, input, master } = this.buses;
    bus1.output.connect(bus3.input);
    bus2.output.connect(bus3.input);
    this.dry.connect(bus3.input);
    bus3.output.connect(bus4.input);
    bus4.output.connect(master.input);
    master.output.connect(this.master);
    this.master.connect(destination);
    this.master.connect(this.analyser);
    input.output.connect(this.routeNode(this.state.inputRoute));
  }

  async startTempoDetection() {
    this.tempo ??= await TempoDetector.create(this.ctx, this.analysisIn, (estimate) => this.handleTempo(estimate));
  }

  handleTempo(estimate) {
    this.state.detected = estimate;
    const confident = estimate.confidence >= AUTO_BPM_CONFIDENCE;
    if (this.state.autoBpm && confident && Math.abs(estimate.bpm - this.state.bpm) >= AUTO_BPM_MIN_CHANGE) this.setBpm(estimate.bpm);
    else this.emit();
  }

  resetTempo() {
    this.tempo?.reset();
    this.state.detected = null;
  }

  setAutoBpm(enabled) {
    this.state.autoBpm = Boolean(enabled);
    const detected = this.state.detected;
    if (this.state.autoBpm && detected && detected.confidence >= AUTO_BPM_CONFIDENCE) this.setBpm(detected.bpm);
    else this.emit();
  }

  routeNode(route) {
    return route === 'dry' ? this.dry : this.buses[route].input;
  }

  findSource(id) {
    return this.state.sources.find((s) => s.id === id) ?? null;
  }

  hasTab(tabId) {
    return this.state.sources.some((s) => s.tabId === tabId);
  }

  addSource(node, { id, kind, label, route = 'bus1', inputFx = false, tabId = null, stream = null }) {
    if (this.sources.has(id)) this.removeSource(id);
    const gain = this.ctx.createGain();
    node.connect(gain);
    this.sources.set(id, { node, gain, stream });
    const meta = { id, kind, label, route: ROUTES.includes(route) ? route : 'bus1', inputFx, tabId };
    this.state.sources.push(meta);
    this.connectSource(meta);
    this.resetTempo();
    this.emit();
    return meta;
  }

  addStreamSource(stream, options) {
    const node = this.ctx.createMediaStreamSource(stream);
    const meta = this.addSource(node, { ...options, stream });
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => this.removeSource(meta.id), { once: true });
    }
    return meta;
  }

  connectSource(meta) {
    const { gain } = this.sources.get(meta.id);
    gain.disconnect();
    gain.connect(meta.inputFx ? this.buses.input.input : this.routeNode(meta.route));
    gain.connect(this.analysisIn);
  }

  updateSource(id, { route, inputFx } = {}) {
    const meta = this.findSource(id);
    if (!meta) return;
    if (ROUTES.includes(route)) meta.route = route;
    if (typeof inputFx === 'boolean') meta.inputFx = inputFx;
    this.connectSource(meta);
    this.emit();
  }

  removeSource(id) {
    const entry = this.sources.get(id);
    if (!entry) return;
    this.sources.delete(id);
    entry.gain.disconnect();
    entry.node.disconnect();
    entry.stream?.getTracks().forEach((track) => track.stop());
    this.state.sources = this.state.sources.filter((s) => s.id !== id);
    this.resetTempo();
    this.emit();
  }

  resolveSlot(busId, ref) {
    const slots = this.state.buses[busId]?.slots;
    if (!slots) return null;
    return (typeof ref === 'number' ? slots[ref] : slots.find((s) => s.uid === ref)) ?? null;
  }

  addSlot(busId, effectId, { params = {}, enabled = true } = {}) {
    const bus = this.buses[busId];
    const busState = this.state.buses[busId];
    if (!bus || !isAvailable(effectId, busId) || busState.slots.length >= MAX_SLOTS) return null;
    const uid = `fx${++this.slotCounter}`;
    const merged = { ...defaultParams(effectId) };
    for (const def of getEffect(effectId).params) {
      if (def.id in params) merged[def.id] = sanitizeParam(def, params[def.id]);
    }
    bus.add(uid, effectId, merged, { bpm: this.state.bpm }).setEnabled(Boolean(enabled));
    busState.slots.push({ uid, effect: effectId, enabled: Boolean(enabled), params: merged, lfo: defaultLfo() });
    this.lfos.set(uid, new Lfo(LFO_SEED + this.slotCounter * 7919));
    this.emit();
    return uid;
  }

  swapSlot(busId, ref, effectId) {
    const slot = this.resolveSlot(busId, ref);
    if (!slot || slot.effect === effectId || !isAvailable(effectId, busId)) return;
    const params = defaultParams(effectId);
    this.buses[busId].slot(slot.uid).setEffect(effectId, params, { bpm: this.state.bpm });
    const target = this.validTarget(effectId, slot.lfo?.target);
    Object.assign(slot, { effect: effectId, params, lfo: { ...defaultLfo(), ...slot.lfo, target } });
    this.emit();
  }

  removeSlot(busId, ref) {
    const slot = this.resolveSlot(busId, ref);
    if (!slot) return;
    this.buses[busId].remove(slot.uid);
    this.state.buses[busId].slots = this.state.buses[busId].slots.filter((s) => s !== slot);
    this.lfos.delete(slot.uid);
    this.emit();
  }

  moveSlot(busId, ref, delta) {
    const slot = this.resolveSlot(busId, ref);
    if (!slot) return;
    const slots = this.state.buses[busId].slots;
    const index = clamp(slots.indexOf(slot) + Math.sign(delta), 0, slots.length - 1);
    slots.splice(slots.indexOf(slot), 1);
    slots.splice(index, 0, slot);
    this.buses[busId].move(slot.uid, index);
    this.emit();
  }

  clearBus(busId) {
    const busState = this.state.buses[busId];
    if (!busState) return;
    busState.slots.forEach((s) => this.lfos.delete(s.uid));
    busState.slots = [];
    this.buses[busId].clear();
    this.emit();
  }

  setSlotEnabled(busId, ref, enabled) {
    const slot = this.resolveSlot(busId, ref);
    if (!slot) return;
    slot.enabled = Boolean(enabled);
    this.buses[busId].slot(slot.uid).setEnabled(slot.enabled);
    this.emit();
  }

  setBusEffect(busId, effectId, params = {}) {
    if (!this.buses[busId]) return;
    this.batch(() => {
      this.clearBus(busId);
      if (effectId) this.addSlot(busId, effectId, { params, enabled: false });
    });
  }

  setBusEnabled(busId, enabled) {
    const busState = this.state.buses[busId];
    if (!busState) return;
    this.batch(() => busState.slots.forEach((s) => this.setSlotEnabled(busId, s.uid, enabled)));
  }

  setParam(busId, ref, paramId, value) {
    const slot = this.resolveSlot(busId, ref);
    if (!slot) return;
    const def = getEffect(slot.effect).params.find((p) => p.id === paramId);
    if (!def) return;
    const v = sanitizeParam(def, value);
    slot.params[paramId] = v;
    this.buses[busId].slot(slot.uid).setParam(paramId, v);
    this.emit();
  }

  validTarget(effectId, target) {
    if (!effectId || !target) return null;
    const def = getEffect(effectId)?.params.find((p) => p.id === target);
    return def && isModulatable(def) ? target : null;
  }

  setLfo(busId, ref, changes = {}) {
    const slot = this.resolveSlot(busId, ref);
    if (!slot) return;
    const lfo = { ...defaultLfo(), ...slot.lfo };
    for (const def of LFO_PARAMS) {
      if (def.id in changes) lfo[def.id] = sanitizeParam(def, changes[def.id]);
    }
    if ('target' in changes) {
      const previous = lfo.target;
      lfo.target = this.validTarget(slot.effect, changes.target);
      if (previous && previous !== lfo.target) this.buses[busId].slot(slot.uid).setParam(previous, slot.params[previous]);
    }
    slot.lfo = lfo;
    this.emit();
  }

  tickModulation(now = this.ctx.currentTime) {
    const dt = this.lastTick === null ? 0 : clamp(now - this.lastTick, 0, MAX_TICK);
    this.lastTick = now;
    for (const busId of BUS_IDS) {
      for (const slot of this.state.buses[busId].slots) {
        const { lfo, params } = slot;
        if (!lfo?.target) continue;
        const def = getEffect(slot.effect).params.find((p) => p.id === lfo.target);
        const osc = this.lfos.get(slot.uid);
        if (!def || !osc) continue;
        const cycle = lfo.sync === 'Free' ? 1 / lfo.rate : (divisionBeats(lfo.sync) * 60) / this.state.bpm;
        osc.advance(dt, cycle);
        const normalized = clamp(toNormalized(def, params[lfo.target]) + lfo.depth * 0.5 * osc.value(lfo.shape), 0, 1);
        this.buses[busId].slot(slot.uid).setParam(lfo.target, fromNormalized(def, normalized));
      }
    }
  }

  setInputRoute(route) {
    if (!ROUTES.includes(route)) return;
    this.buses.input.output.disconnect();
    this.buses.input.output.connect(this.routeNode(route));
    this.state.inputRoute = route;
    this.emit();
  }

  setBpm(bpm) {
    this.state.bpm = clampBpm(bpm);
    for (const bus of Object.values(this.buses)) bus.setTempo(this.state.bpm);
    this.emit();
  }

  setMaster(level) {
    const v = clamp(Number(level) || 0, 0, MASTER_MAX);
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    this.state.master = v;
    this.emit();
  }

  static slotsFromSaved(bus) {
    if (Array.isArray(bus.slots)) return bus.slots;
    return bus.effect ? [{ effect: bus.effect, enabled: bus.enabled, params: bus.params, lfo: bus.lfo }] : [];
  }

  applySettings(saved) {
    if (!saved) return;
    this.batch(() => {
      if (saved.bpm !== undefined) this.setBpm(saved.bpm);
      if (saved.autoBpm !== undefined) this.setAutoBpm(saved.autoBpm);
      if (saved.master !== undefined) this.setMaster(saved.master);
      if (saved.inputRoute) this.setInputRoute(saved.inputRoute);
      for (const busId of BUS_IDS) {
        const bus = saved.buses?.[busId];
        if (!bus) continue;
        this.clearBus(busId);
        for (const spec of AudioEngine.slotsFromSaved(bus)) {
          const uid = this.addSlot(busId, spec.effect, { params: spec.params, enabled: spec.enabled ?? true });
          if (uid && spec.lfo) this.setLfo(busId, uid, spec.lfo);
        }
      }
    });
  }

  loadPreset(preset) {
    const buses = Object.fromEntries(BUS_IDS.map((id) => [id, { slots: preset.buses[id] ?? [] }]));
    this.applySettings({ buses });
  }

  settings() {
    return structuredClone(settingsFrom(this.state));
  }

  snapshot() {
    return structuredClone(this.state);
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.meterBuffer);
    let peak = 0;
    let sum = 0;
    for (const v of this.meterBuffer) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    const slots = {};
    for (const bus of Object.values(this.buses)) Object.assign(slots, bus.meters());
    return { peak, rms: Math.sqrt(sum / this.meterBuffer.length), slots };
  }

  batch(fn) {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
    }
    this.emit();
  }

  emit() {
    if (this.batchDepth === 0) this.onChange(this.snapshot());
  }
}
