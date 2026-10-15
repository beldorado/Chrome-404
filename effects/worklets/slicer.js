import { EffectProcessor } from './base.js';
import { divisionBeats } from '../../shared/sync.js';

const PATTERNS = {
  1: 0b1010101010101010,
  2: 0b1110111011101110,
  3: 0b1001001010010010,
  4: 0b1111000011110000,
  5: 0b1011011010110110,
  6: 0b1100110011001101,
  7: 0b1000100010001000,
  8: 0b1110101110101011
};

class SlicerProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.clock = 0;
    this.gain = 1;
  }

  onActive() {
    this.clock = 0;
  }

  render(inL, inR, outL, outR, n) {
    const stepLen = Math.max(1, this.samplesPerBeat() * divisionBeats(this.params.division, 0.25));
    const pattern = PATTERNS[this.params.pattern] ?? PATTERNS[1];
    const floor = 1 - this.params.depth;
    const coeff = 1 - Math.exp(-1 / (Math.max(0.5, this.params.shape) * 0.001 * sampleRate));
    for (let i = 0; i < n; i++) {
      if (!this.active) {
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      const step = Math.floor(this.clock / stepLen) % 16;
      const open = (pattern >> (15 - step)) & 1;
      const target = open ? 1 : floor;
      this.gain += (target - this.gain) * coeff;
      outL[i] = inL[i] * this.gain;
      outR[i] = inR[i] * this.gain;
      this.clock++;
    }
  }
}

registerProcessor('chrome404-slicer', SlicerProcessor);
