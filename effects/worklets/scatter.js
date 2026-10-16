import { EffectProcessor, RingBuffer, hash, mod } from './base.js';

const PATTERNS = {
  1: 'NNNNNNNNNNNNRRRR',
  2: 'NNNVNNNVNNNVNNNV',
  3: 'NNRRNNRRNNRRNNRR',
  4: 'NNNNNNNNSSSSSSSS',
  5: 'NXNXNXNXNXNXNXNX',
  6: 'NNNNVVVVNNNNRRRR',
  7: 'NSNSNRNVNSNSNRNV',
  8: 'NNNNNNNNVVVVVVVV'
};
const STEPS = 16;
const FADE = 96;

class ScatterProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.ring = new RingBuffer(4);
    this.reset();
  }

  reset() {
    this.step = null;
    this.pos = 0;
    this.stepLen = 0;
    this.action = 'N';
    this.nextAction = 'N';
    this.prevAction = 'N';
    this.stepStart = 0;
    this.repeatStart = 0;
  }

  onActive() {
    this.reset();
  }

  actionFor(step) {
    const pattern = PATTERNS[this.params.type] ?? PATTERNS[1];
    const index = mod(step, STEPS);
    const symbol = pattern[index];
    if (symbol === 'N') return 'N';
    return hash(Math.floor(step / STEPS), index) < this.params.depth ? symbol : 'N';
  }

  beginStep(step, pos) {
    const continuous = this.step !== null && step === this.step + 1;
    this.step = step;
    this.pos = pos;
    this.prevAction = continuous ? this.action : 'N';
    this.action = this.actionFor(step);
    this.nextAction = this.actionFor(step + 1);
    this.stepStart = this.ring.write - pos;
    if (this.action === 'R' && this.prevAction !== 'R') this.repeatStart = this.stepStart - this.stepLen;
  }

  read(action, pos) {
    let at;
    switch (action) {
      case 'R':
        at = this.repeatStart + pos;
        break;
      case 'V':
        at = this.stepStart - 1 - pos;
        break;
      case 'S': {
        const slice = Math.floor(this.stepLen / 4);
        at = this.stepStart - slice + (pos % slice);
        break;
      }
      case 'X':
        this.l = 0;
        this.r = 0;
        return true;
      default:
        return false;
    }
    this.l = this.ring.readL(at);
    this.r = this.ring.readR(at);
    return true;
  }

  render(inL, inR, outL, outR, n) {
    this.stepLen = Math.max(FADE * 2 + 1, this.samplesPerBeat() / 4);
    const start = this.gridFrames();
    for (let i = 0; i < n; i++) {
      this.ring.push(inL[i], inR[i]);
      if (!this.active) {
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      const frame = Math.floor(start + i);
      const step = Math.floor(frame / this.stepLen);
      if (step !== this.step) this.beginStep(step, Math.floor(frame - step * this.stepLen));
      const replaced = this.read(this.action, this.pos);
      const l = replaced ? this.l : inL[i];
      const r = replaced ? this.r : inR[i];
      let env = 1;
      if (this.action !== this.prevAction) env = Math.min(env, this.pos / FADE);
      if (this.action !== this.nextAction) env = Math.min(env, (this.stepLen - 1 - this.pos) / FADE);
      env = Math.max(0, Math.min(1, env));
      outL[i] = l * env;
      outR[i] = r * env;
      this.pos++;
    }
  }
}

registerProcessor('chrome404-scatter', ScatterProcessor);
