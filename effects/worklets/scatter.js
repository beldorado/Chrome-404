import { EffectProcessor, RingBuffer, hash } from './base.js';

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
const FADE = 96;

class ScatterProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.ring = new RingBuffer(4);
    this.reset();
  }

  reset() {
    this.step = -1;
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
    const symbol = pattern[step % 16];
    if (symbol === 'N') return 'N';
    return hash(Math.floor(step / 16), step % 16) < this.params.depth ? symbol : 'N';
  }

  beginStep() {
    this.step++;
    this.pos = 0;
    this.stepLen = Math.max(FADE * 2 + 1, Math.round(this.samplesPerBeat() / 4));
    this.prevAction = this.action;
    this.action = this.actionFor(this.step);
    this.nextAction = this.actionFor(this.step + 1);
    this.stepStart = this.ring.write;
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
    for (let i = 0; i < n; i++) {
      this.ring.push(inL[i], inR[i]);
      if (!this.active) {
        outL[i] = inL[i];
        outR[i] = inR[i];
        continue;
      }
      if (this.step < 0 || this.pos >= this.stepLen) this.beginStep();
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
