import { Bus } from './bus.js';
import { TempoDetector } from './tempo-detector.js';
import { BUS_IDS, ROUTES, defaultBus, defaultState, settingsFrom } from '../shared/state.js';
import { defaultParams, getEffect, isAvailable } from '../effects/registry.js';
import { clamp, fromNormalized, sanitizeParam, toNormalized } from '../shared/params.js';
import { LFO_PARAMS, Lfo, defaultLfo, isModulatable } from '../shared/lfo.js';
import { divisionBeats } from '../shared/sync.js';
import { clampBpm } from '../shared/tempo.js';

const MASTER_MAX = 1.5;
const AUTO_BPM_CONFIDENCE = 0.2;
const AUTO_BPM_MIN_CHANGE = 0.5;
const MAX_TICK = 0.25;

export class AudioEngine {
  constructor(ctx, { destination = ctx.destination, onChange = () => {} } = {}) {
    this.ctx = ctx;
    this.onChange = onChange;
    this.state = defaultState();
    this.sources = new Map();
    this.batchDepth = 0;
    this.tempo = null;
    this.lastTick = null;
    this.lfos = Object.fromEntries(BUS_IDS.map((id, i) => [id, new Lfo(0x9e3779b9 + i * 7919)]));

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

  setBusEffect(busId, effectId, params = {}) {
    const bus = this.buses[busId];
    if (!bus) return;
    const id = effectId && isAvailable(effectId, busId) ? effectId : null;
    const effect = id ? getEffect(id) : null;
    const merged = { ...defaultParams(id) };
    for (const def of effect?.params ?? []) {
      if (def.id in params) merged[def.id] = sanitizeParam(def, params[def.id]);
    }
    bus.setEffect(id, merged, { bpm: this.state.bpm });
    const busState = this.state.buses[busId];
    const lfo = { ...defaultLfo(), ...busState.lfo };
    lfo.target = this.validTarget(id, lfo.target);
    Object.assign(busState, { effect: id, params: merged, lfo });
    this.emit();
  }

  validTarget(effectId, target) {
    if (!effectId || !target) return null;
    const def = getEffect(effectId)?.params.find((p) => p.id === target);
    return def && isModulatable(def) ? target : null;
  }

  setLfo(busId, changes = {}) {
    const busState = this.state.buses[busId];
    if (!busState) return;
    const lfo = { ...defaultLfo(), ...busState.lfo };
    for (const def of LFO_PARAMS) {
      if (def.id in changes) lfo[def.id] = sanitizeParam(def, changes[def.id]);
    }
    if ('target' in changes) {
      const previous = lfo.target;
      lfo.target = this.validTarget(busState.effect, changes.target);
      if (previous && previous !== lfo.target && busState.effect) this.buses[busId].setParam(previous, busState.params[previous]);
    }
    busState.lfo = lfo;
    this.emit();
  }

  tickModulation(now = this.ctx.currentTime) {
    const dt = this.lastTick === null ? 0 : clamp(now - this.lastTick, 0, MAX_TICK);
    this.lastTick = now;
    for (const busId of BUS_IDS) {
      const { effect, lfo, params } = this.state.buses[busId];
      if (!effect || !lfo?.target) continue;
      const def = getEffect(effect).params.find((p) => p.id === lfo.target);
      if (!def) continue;
      const cycle = lfo.sync === 'Free' ? 1 / lfo.rate : (divisionBeats(lfo.sync) * 60) / this.state.bpm;
      const osc = this.lfos[busId];
      osc.advance(dt, cycle);
      const normalized = clamp(toNormalized(def, params[lfo.target]) + lfo.depth * 0.5 * osc.value(lfo.shape), 0, 1);
      this.buses[busId].setParam(lfo.target, fromNormalized(def, normalized));
    }
  }

  setBusEnabled(busId, enabled) {
    const bus = this.buses[busId];
    if (!bus) return;
    bus.setEnabled(Boolean(enabled));
    this.state.buses[busId].enabled = Boolean(enabled);
    this.emit();
  }

  setParam(busId, paramId, value) {
    const busState = this.state.buses[busId];
    if (!busState?.effect) return;
    const def = getEffect(busState.effect).params.find((p) => p.id === paramId);
    if (!def) return;
    const v = sanitizeParam(def, value);
    busState.params[paramId] = v;
    this.buses[busId].setParam(paramId, v);
    this.emit();
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
        this.setBusEffect(busId, bus.effect, bus.params);
        this.setBusEnabled(busId, bus.enabled);
        if (bus.lfo) this.setLfo(busId, bus.lfo);
      }
    });
  }

  loadPreset(preset) {
    const buses = Object.fromEntries(BUS_IDS.map((id) => [id, { ...defaultBus(), ...preset.buses[id] }]));
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
    const buses = {};
    for (const busId of BUS_IDS) {
      const reading = this.buses[busId].meter();
      if (reading) buses[busId] = reading;
    }
    return { peak, rms: Math.sqrt(sum / this.meterBuffer.length), buses };
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
