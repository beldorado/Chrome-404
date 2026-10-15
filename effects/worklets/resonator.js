import { EffectProcessor } from './base.js';
import { CHORDS } from '../lib.js';

const MIN_HZ = 20;
const MAX_VOICES = 4;
const DRIVE = 0.6;

class Comb {
  constructor(size) {
    this.l = new Float32Array(size);
    this.r = new Float32Array(size);
    this.size = size;
    this.write = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  tap(buffer, delay) {
    const pos = this.write - delay;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = buffer[((i % this.size) + this.size) % this.size];
    const b = buffer[(((i + 1) % this.size) + this.size) % this.size];
    return a + (b - a) * f;
  }

  process(xl, xr, delay, feedback, damp) {
    this.lpL += (this.tap(this.l, delay) - this.lpL) * damp;
    this.lpR += (this.tap(this.r, delay) - this.lpR) * damp;
    this.outL = xl + feedback * this.lpL;
    this.outR = xr + feedback * this.lpR;
    this.l[this.write] = this.outL;
    this.r[this.write] = this.outR;
    this.write = (this.write + 1) % this.size;
  }
}

class ResonatorProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    const size = Math.ceil(sampleRate / MIN_HZ) + 4;
    this.combs = Array.from({ length: MAX_VOICES }, () => new Comb(size));
  }

  render(inL, inR, outL, outR, n) {
    const intervals = (CHORDS[this.params.chord] ?? CHORDS.Unison).slice(0, MAX_VOICES);
    const root = Math.round(this.params.note);
    const delays = intervals.map((st) => sampleRate / (440 * Math.pow(2, (root + st - 69) / 12)));
    const feedback = 0.8 + 0.195 * Math.max(0, Math.min(1, this.params.decay));
    const damp = 1 - 0.85 * Math.max(0, Math.min(1, this.params.damp));
    const inputGain = (1 - feedback) * DRIVE * 4;
    const voiceGain = 1 / Math.sqrt(intervals.length);
    for (let i = 0; i < n; i++) {
      const xl = inL[i] * inputGain;
      const xr = inR[i] * inputGain;
      let l = 0;
      let r = 0;
      for (let v = 0; v < delays.length; v++) {
        const comb = this.combs[v];
        comb.process(xl, xr, delays[v], feedback, damp);
        l += comb.outL;
        r += comb.outR;
      }
      outL[i] = Math.tanh(l * voiceGain);
      outR[i] = Math.tanh(r * voiceGain);
    }
  }
}

registerProcessor('chrome404-resonator', ResonatorProcessor);
