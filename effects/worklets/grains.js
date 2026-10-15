import { EffectProcessor, RingBuffer } from './base.js';

const MAX_GRAINS = 48;

class GrainsProcessor extends EffectProcessor {
  constructor(options) {
    super(options);
    this.ring = new RingBuffer(5);
    this.abs = 0;
    this.grains = [];
    this.untilNext = 0;
    this.seed = 0x9e3779b9;
  }

  random() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0xffffffff;
  }

  spawn() {
    if (this.grains.length >= MAX_GRAINS) return;
    const size = Math.max(0.01, Math.min(0.5, this.params.size)) * sampleRate;
    const rate = Math.pow(2, this.params.pitch / 12) * (1 + (this.random() - 0.5) * 0.004);
    const reach = size * Math.max(rate, 1) + 64;
    const start = this.abs - reach - this.random() * this.params.spread * 2 * sampleRate;
    const pan = (this.random() - 0.5) * this.params.spread + 0.5;
    this.grains.push({ pos: start, rate, age: 0, size, gl: Math.cos((pan * Math.PI) / 2), gr: Math.sin((pan * Math.PI) / 2) });
  }

  render(inL, inR, outL, outR, n) {
    const density = Math.max(0.5, this.params.density);
    const interval = sampleRate / density;
    const overlap = density * Math.max(0.01, this.params.size);
    const norm = 1.4 / Math.sqrt(Math.max(1, overlap));
    const feedback = Math.min(0.95, this.params.feedback);
    const frozen = this.params.freeze === 'On';

    for (let i = 0; i < n; i++) {
      if (--this.untilNext <= 0) {
        this.spawn();
        this.untilNext = interval * (0.5 + this.random());
      }
      let l = 0;
      let r = 0;
      for (const g of this.grains) {
        if (g.age >= g.size) continue;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * g.age) / g.size);
        l += this.ring.readL(g.pos) * w * g.gl;
        r += this.ring.readR(g.pos) * w * g.gr;
        g.pos += g.rate;
        g.age++;
      }
      l *= norm;
      r *= norm;
      if (!frozen) {
        this.ring.push(inL[i] + Math.tanh(l * feedback), inR[i] + Math.tanh(r * feedback));
        this.abs++;
      }
      outL[i] = l;
      outR[i] = r;
    }
    this.grains = this.grains.filter((g) => g.age < g.size);
  }
}

registerProcessor('chrome404-grains', GrainsProcessor);
