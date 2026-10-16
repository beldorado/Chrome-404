import { beatPhase, estimateTempo } from '../shared/bpm.js';

const HOP = 512;
const HISTORY_SECONDS = 11;
const MIN_HISTORY_SECONDS = 5;
const ESTIMATE_EVERY_SECONDS = 1.5;
const SMOOTHING_WINDOW = 5;
const SILENCE_ENERGY = 1e-6;

export class TempoDetector {
  static async create(ctx, input, onEstimate) {
    await ctx.audioWorklet.addModule(new URL('./worklets/onset-processor.js', import.meta.url));
    return new TempoDetector(ctx, input, onEstimate);
  }

  constructor(ctx, input, onEstimate) {
    this.onEstimate = onEstimate;
    this.frameRate = ctx.sampleRate / HOP;
    this.size = Math.round(HISTORY_SECONDS * this.frameRate);
    this.history = new Float32Array(this.size);
    this.times = new Float64Array(this.size);
    this.reset();

    this.node = new AudioWorkletNode(ctx, 'chrome404-onset', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { hop: HOP }
    });
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    input.connect(this.node).connect(this.sink).connect(ctx.destination);
    this.node.port.onmessage = (e) => this.push(e.data);
  }

  reset() {
    this.write = 0;
    this.filled = 0;
    this.sinceEstimate = 0;
    this.recent = [];
  }

  push({ onsets, energy, time = null }) {
    if (energy < SILENCE_ENERGY) return;
    onsets.forEach((v, k) => {
      this.history[this.write] = v;
      this.times[this.write] = time === null ? NaN : time - (onsets.length - 1 - k + 0.5) / this.frameRate;
      this.write = (this.write + 1) % this.size;
    });
    this.filled = Math.min(this.size, this.filled + onsets.length);
    this.sinceEstimate += onsets.length;
    if (this.sinceEstimate < ESTIMATE_EVERY_SECONDS * this.frameRate) return;
    this.sinceEstimate = 0;
    const estimate = this.estimate();
    if (estimate) this.onEstimate(estimate);
  }

  ordered(source = this.history) {
    const out = new source.constructor(this.filled);
    const start = (this.write - this.filled + this.size) % this.size;
    for (let i = 0; i < this.filled; i++) out[i] = source[(start + i) % this.size];
    return out;
  }

  estimate() {
    if (this.filled < MIN_HISTORY_SECONDS * this.frameRate) return null;
    const result = estimateTempo(this.ordered(), this.frameRate);
    if (!result) return null;
    this.recent.push(result.bpm);
    if (this.recent.length > SMOOTHING_WINDOW) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const bpm = Math.round(median * 10) / 10;
    const times = this.ordered(this.times);
    const phase = Number.isFinite(times[times.length - 1]) ? beatPhase(this.ordered(), times, bpm) : null;
    return { bpm, confidence: Math.round(result.confidence * 100) / 100, beat: phase?.beat ?? null };
  }
}
