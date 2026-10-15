import { EffectProcessor } from './base.js';

const REPORT_EVERY = 2048;

class LimiterProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.lookahead = Math.max(1, Math.round(this.params.lookahead * sampleRate));
    const size = this.lookahead + 1;
    this.size = size;
    this.delayL = new Float32Array(size);
    this.delayR = new Float32Array(size);
    this.minimums = new Float32Array(size).fill(1);
    this.minSum = size;
    this.dequeIndex = new Int32Array(size + 1);
    this.dequeValue = new Float32Array(size + 1);
    this.head = 0;
    this.tail = 0;
    this.clock = 0;
    this.gain = 1;
    this.lowest = 1;
    this.sinceReport = 0;
  }

  pushMinimum(value) {
    const cap = this.dequeIndex.length;
    while (this.tail !== this.head && this.dequeValue[(this.tail - 1 + cap) % cap] >= value) this.tail = (this.tail - 1 + cap) % cap;
    this.dequeIndex[this.tail] = this.clock;
    this.dequeValue[this.tail] = value;
    this.tail = (this.tail + 1) % cap;
    while (this.dequeIndex[this.head] <= this.clock - this.size) this.head = (this.head + 1) % cap;
    return this.dequeValue[this.head];
  }

  render(inL, inR, outL, outR, n) {
    const drive = Math.pow(10, this.params.gain / 20);
    const ceiling = Math.pow(10, this.params.ceiling / 20);
    const release = 1 - Math.exp(-1 / (Math.max(0.001, this.params.release) * sampleRate));
    for (let i = 0; i < n; i++) {
      const l = inL[i] * drive;
      const r = inR[i] * drive;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const required = peak > ceiling ? ceiling / peak : 1;
      const slot = this.clock % this.size;
      const minimum = this.pushMinimum(required);
      this.minSum += minimum - this.minimums[slot];
      this.minimums[slot] = minimum;
      const smoothed = Math.min(1, this.minSum / this.size);
      this.gain = smoothed < this.gain ? smoothed : this.gain + (smoothed - this.gain) * release;
      const outIndex = (this.clock + 1) % this.size;
      outL[i] = Math.max(-ceiling, Math.min(ceiling, this.delayL[outIndex] * this.gain));
      outR[i] = Math.max(-ceiling, Math.min(ceiling, this.delayR[outIndex] * this.gain));
      this.delayL[slot] = l;
      this.delayR[slot] = r;
      this.lowest = Math.min(this.lowest, this.gain);
      this.clock++;
    }
    this.sinceReport += n;
    if (this.sinceReport >= REPORT_EVERY) {
      this.port.postMessage({ type: 'meter', reduction: 20 * Math.log10(Math.max(1e-6, this.lowest)) });
      this.lowest = 1;
      this.sinceReport = 0;
    }
  }
}

registerProcessor('chrome404-limiter', LimiterProcessor);
