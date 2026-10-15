import { EffectProcessor, RingBuffer } from './base.js';
import { divisionBeats } from '../../shared/sync.js';

const RESYNC = 192;
const STOP_FADE_RATE = 0.12;

class VarispeedProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.ring = new RingBuffer(20);
    this.abs = 0;
    this.reset();
  }

  reset() {
    this.clock = 0;
    this.read = this.abs - 1;
    this.lastRate = 1;
    this.resync = 0;
  }

  onActive() {
    this.reset();
  }

  rateAt(phase) {
    const length = Math.max(0.05, Math.min(1, this.params.length));
    const start = 1 - length;
    if (phase < start) return 1;
    const x = (phase - start) / length;
    if (this.params.mode === 'stop') return 1 - Math.pow(x, 0.7);
    return 1 + (Math.pow(2, -this.params.depth / 12) - 1) * x;
  }

  gain(rate) {
    return this.params.mode === 'stop' ? Math.min(1, rate / STOP_FADE_RATE) : 1;
  }

  render(inL, inR, outL, outR, n) {
    const cycle = Math.max(1, Math.round(this.samplesPerBeat() * divisionBeats(this.params.division, 4)));
    for (let i = 0; i < n; i++) {
      this.ring.push(inL[i], inR[i]);
      this.abs++;
      const live = this.abs - 1;
      if (!this.active) {
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      if (this.clock > 0 && this.clock % cycle === 0 && this.read < live) this.resync = RESYNC;
      const phase = (this.clock % cycle) / cycle;
      this.clock++;

      if (this.resync > 0) {
        this.read = Math.min(live, this.read + this.lastRate);
        const t = this.resync / RESYNC;
        const g = this.gain(this.lastRate) * t;
        outL[i] = this.ring.readL(this.read) * g + inL[i] * (1 - t);
        outR[i] = this.ring.readR(this.read) * g + inR[i] * (1 - t);
        if (--this.resync === 0) this.read = live;
        continue;
      }

      const rate = this.rateAt(phase);
      this.read = rate >= 1 ? live : Math.min(live, this.read + rate);
      this.lastRate = rate;
      const g = this.gain(rate);
      outL[i] = this.ring.readL(this.read) * g;
      outR[i] = this.ring.readR(this.read) * g;
    }
  }
}

registerProcessor('chrome404-varispeed', VarispeedProcessor);
