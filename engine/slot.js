import { MIX_PARAM, createEffect } from '../effects/registry.js';

const CROSSFADE = 0.01;
const MAX_LATENCY = 0.1;

export class Slot {
  constructor(ctx, uid) {
    this.ctx = ctx;
    this.uid = uid;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.bypass = ctx.createGain();
    this.dryDelay = ctx.createDelay(MAX_LATENCY);
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry.gain.value = 0;
    this.wet.gain.value = 0;
    this.input.connect(this.bypass).connect(this.output);
    this.input.connect(this.dryDelay).connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
    this.effect = null;
    this.enabled = false;
    this.mixAmount = 1;
  }

  setEffect(effectId, params, context) {
    if (this.effect) {
      this.input.disconnect(this.effect.input);
      this.effect.dispose();
      this.effect = null;
    }
    this.lastActive = null;
    if (effectId) {
      this.effect = createEffect(this.ctx, effectId, params, context);
      this.input.connect(this.effect.input);
      this.effect.output.connect(this.wet);
      this.dryDelay.delayTime.value = Math.min(MAX_LATENCY, this.effect.latency);
      this.mixAmount = params[MIX_PARAM] ?? 1;
    }
    this.mix();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.mix();
  }

  setParam(id, value) {
    if (id === MIX_PARAM) {
      this.mixAmount = value;
      this.mix();
    } else {
      this.effect?.setParam(id, value);
    }
  }

  setTempo(bpm) {
    this.effect?.setTempo?.(bpm);
  }

  dispose() {
    this.effect?.dispose();
    this.effect = null;
    for (const node of [this.input, this.output, this.bypass, this.dryDelay, this.dry, this.wet]) node.disconnect();
  }

  meter() {
    return this.enabled ? (this.effect?.meter?.() ?? null) : null;
  }

  mix() {
    const active = this.enabled && this.effect !== null;
    if (active !== this.lastActive) {
      this.effect?.setActive?.(active);
      this.lastActive = active;
    }
    const now = this.ctx.currentTime;
    const angle = (this.mixAmount * Math.PI) / 2;
    this.bypass.gain.setTargetAtTime(active ? 0 : 1, now, CROSSFADE);
    this.dry.gain.setTargetAtTime(active ? Math.cos(angle) : 0, now, CROSSFADE);
    this.wet.gain.setTargetAtTime(active ? Math.sin(angle) : 0, now, CROSSFADE);
  }
}
