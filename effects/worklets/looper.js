import { EffectProcessor, RingBuffer } from './base.js';
import { divisionBeats } from '../../shared/sync.js';

const FADE = 128;

class LooperProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.ring = new RingBuffer(26);
    this.abs = 0;
    this.capturedAt = null;
    this.loopLen = 0;
    this.phase = 0;
  }

  onActive(on) {
    this.capturedAt = on ? this.abs : null;
    this.loopLen = Math.max(FADE * 2 + 1, Math.round(this.samplesPerBeat() * divisionBeats(this.params.length)));
    this.phase = 0;
  }

  render(inL, inR, outL, outR, n) {
    const speed = Math.max(0.25, Math.min(2, this.params.speed));
    const reverse = this.params.reverse === 'On';
    const length = this.loopLen;
    for (let i = 0; i < n; i++) {
      const recording = this.capturedAt === null || this.abs - this.capturedAt < length;
      if (recording) {
        this.ring.push(inL[i], inR[i]);
        this.abs++;
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      const p = this.phase % length;
      const at = this.capturedAt + (reverse ? length - 1 - p : p);
      const env = Math.min(1, p / FADE, (length - 1 - p) / FADE);
      outL[i] = this.ring.readL(at) * env;
      outR[i] = this.ring.readR(at) * env;
      this.phase += speed;
    }
  }
}

registerProcessor('chrome404-looper', LooperProcessor);
