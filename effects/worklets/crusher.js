import { EffectProcessor } from './base.js';

class CrusherProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.phase = 0;
    this.holdL = 0;
    this.holdR = 0;
  }

  render(inL, inR, outL, outR, n) {
    const step = Math.max(1, sampleRate / this.params.rate);
    const levels = Math.pow(2, Math.max(1, this.params.bits) - 1);
    for (let i = 0; i < n; i++) {
      this.phase += 1;
      if (this.phase >= step) {
        this.phase -= step;
        this.holdL = Math.round(inL[i] * levels) / levels;
        this.holdR = Math.round(inR[i] * levels) / levels;
      }
      outL[i] = this.holdL;
      outR[i] = this.holdR;
    }
  }
}

registerProcessor('chrome404-crusher', CrusherProcessor);
