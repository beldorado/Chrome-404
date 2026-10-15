import { EffectProcessor, RingBuffer } from './base.js';

const SCALES = {
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Pentatonic: [0, 3, 5, 7, 10]
};
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ANALYSIS_RATE = 12000;
const WINDOW = 512;
const HOP = 256;
const MIN_HZ = 70;
const MAX_HZ = 1000;
const YIN_THRESHOLD = 0.15;
const SILENCE_RMS = 0.005;
const SHIFT_WINDOW = 0.05;

class AutoPitchProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.ring = new RingBuffer(1);
    this.abs = 0;
    this.factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
    this.rate = sampleRate / this.factor;
    this.analysis = new Float32Array(WINDOW * 2);
    this.history = new Float32Array(WINDOW * 2);
    this.historyWrite = 0;
    this.filled = 0;
    this.sinceHop = 0;
    this.acc = 0;
    this.accCount = 0;
    this.diff = new Float32Array(Math.ceil(this.rate / MIN_HZ) + 2);
    this.ratio = 1;
    this.targetRatio = 1;
    this.defaultWidth = Math.round(SHIFT_WINDOW * sampleRate);
    this.targetWidth = this.defaultWidth;
    this.taps = [
      { phase: 0, width: this.defaultWidth },
      { phase: 0.5, width: this.defaultWidth }
    ];
  }

  syncWidth(f0) {
    if (!f0) {
      this.targetWidth = this.defaultWidth;
      return;
    }
    const period = sampleRate / f0;
    const periods = Math.max(1, Math.round(this.defaultWidth / (2 * period)));
    this.targetWidth = 2 * periods * period;
  }

  detect() {
    const x = this.analysis;
    const size = this.history.length;
    for (let j = 0; j < size; j++) x[j] = this.history[(this.historyWrite + j) % size];
    let energy = 0;
    for (let j = 0; j < WINDOW; j++) energy += x[j] * x[j];
    if (Math.sqrt(energy / WINDOW) < SILENCE_RMS) return 0;
    const minTau = Math.floor(this.rate / MAX_HZ);
    const maxTau = Math.min(this.diff.length - 2, WINDOW);
    let running = 0;
    let found = -1;
    for (let tau = 1; tau <= maxTau; tau++) {
      let d = 0;
      for (let j = 0; j < WINDOW; j++) {
        const delta = x[j] - x[j + tau];
        d += delta * delta;
      }
      running += d;
      this.diff[tau] = running > 0 ? (d * tau) / running : 1;
      if (tau > minTau + 1 && this.diff[tau - 1] < YIN_THRESHOLD && this.diff[tau - 1] <= this.diff[tau]) {
        found = tau - 1;
        break;
      }
    }
    if (found < 0) return 0;
    const a = this.diff[found - 1];
    const b = this.diff[found];
    const c = this.diff[found + 1];
    const denom = a - 2 * b + c;
    const tau = denom > 0 ? found + (0.5 * (a - c)) / denom : found;
    return this.rate / tau;
  }

  retarget() {
    const shift = Math.pow(2, this.params.shift / 12);
    const f0 = this.detect();
    this.syncWidth(f0);
    if (!f0) {
      this.targetRatio = shift;
      return;
    }
    const midi = 69 + 12 * Math.log2(f0 / 440);
    const scale = SCALES[this.params.scale] ?? SCALES.Chromatic;
    const key = Math.max(0, KEYS.indexOf(this.params.key));
    let best = Math.round(midi);
    let bestDistance = Infinity;
    for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
      if (!scale.includes((((m - key) % 12) + 12) % 12)) continue;
      const distance = Math.abs(m - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = m;
      }
    }
    this.targetRatio = Math.pow(2, ((best - midi) * this.params.amount) / 12) * shift;
  }

  feedAnalysis(sample) {
    this.acc += sample;
    if (++this.accCount < this.factor) return;
    const value = this.acc / this.factor;
    this.acc = 0;
    this.accCount = 0;
    this.history[this.historyWrite] = value;
    this.historyWrite = (this.historyWrite + 1) % this.history.length;
    if (this.filled < this.history.length) this.filled++;
    if (++this.sinceHop >= HOP && this.filled === this.history.length) {
      this.sinceHop = 0;
      this.retarget();
    }
  }

  render(inL, inR, outL, outR, n) {
    const tau = Math.max(0.001, 0.002 + this.params.speed * 0.2);
    const coeff = 1 - Math.exp(-1 / (tau * sampleRate));
    for (let i = 0; i < n; i++) {
      this.ring.push(inL[i], inR[i]);
      this.abs++;
      this.feedAnalysis((inL[i] + inR[i]) * 0.5);
      this.ratio += (this.targetRatio - this.ratio) * coeff;
      let l = 0;
      let r = 0;
      let total = 0;
      for (const tap of this.taps) {
        const next = tap.phase + (1 - this.ratio) / tap.width;
        if (next >= 1 || next < 0) tap.width = this.targetWidth;
        tap.phase = ((next % 1) + 1) % 1;
        const g = Math.sin(Math.PI * tap.phase) ** 2;
        const at = this.abs - 2 - tap.phase * tap.width;
        l += this.ring.readL(at) * g;
        r += this.ring.readR(at) * g;
        total += g;
      }
      const norm = 1 / Math.max(0.5, total);
      outL[i] = l * norm;
      outR[i] = r * norm;
    }
  }
}

registerProcessor('chrome404-autopitch', AutoPitchProcessor);
