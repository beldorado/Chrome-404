const GRAIN_SECONDS = 0.046;
const SEARCH_SECONDS = 0.012;
const RELEASE = 0.006;
const RELEASE_TAIL = 8;
const LEVEL_TIME = 0.01;
const COARSE = 4;
const DECIMATE = 8;

class StretchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hop = Math.max(64, Math.round((GRAIN_SECONDS * sampleRate) / 2));
    this.size = this.hop * 2;
    this.window = new Float32Array(this.size);
    for (let n = 0; n < this.size; n++) this.window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / this.size);
    this.release = Math.exp(-1 / (RELEASE * sampleRate));
    this.tail = RELEASE_TAIL * RELEASE * sampleRate;
    this.levelCoef = 1 - Math.exp(-1 / (LEVEL_TIME * sampleRate));
    this.buffers = new Map();
    this.voices = new Map();
    this.port.onmessage = ({ data }) => this.handle(data);
  }

  store(key, { channels, sampleRate: rate }) {
    const mono = new Float32Array(channels[0].length);
    for (const data of channels) for (let i = 0; i < mono.length; i++) mono[i] += data[i] / channels.length;
    this.buffers.set(key, { channels, mono, rate });
  }

  handle(m) {
    if (m.type === 'drop') this.buffers.delete(m.key);
    else if (m.type === 'start') this.begin(m);
    else if (m.type === 'stop') this.end(m.id, m.at);
    else if (m.type === 'set') this.set(m);
  }

  bounds(v, offset, length) {
    v.lo = Math.max(0, offset * v.buffer.rate);
    v.hi = Math.min(v.buffer.mono.length, (offset + length) * v.buffer.rate);
  }

  begin(m) {
    if (m.load) this.store(m.key, m.load);
    const buffer = this.buffers.get(m.key);
    if (!buffer) {
      this.port.postMessage({ type: 'ended', id: m.id });
      return;
    }
    const v = {
      id: m.id,
      buffer,
      k: buffer.rate / sampleRate,
      startFrame: Math.max(currentFrame, Math.round(m.when * sampleRate)),
      stopFrame: Infinity,
      env: 1,
      level: m.level,
      target: m.level,
      rate: m.rate,
      pitch: m.pitch,
      loop: m.loop,
      grains: [],
      until: 0,
      ending: false
    };
    this.bounds(v, m.offset, m.length);
    v.tl = this.wrap(v, m.from * buffer.rate);
    const step = v.pitch * v.k;
    v.prev = { pos: v.tl - this.hop * step, n: this.hop, step };
    v.grains.push(v.prev);
    this.voices.set(m.id, v);
  }

  end(id, at) {
    const v = this.voices.get(id);
    if (!v) return;
    v.stopFrame = Math.max(currentFrame, Math.round(at * sampleRate));
    if (v.stopFrame <= v.startFrame) this.voices.delete(id);
  }

  set(m) {
    const v = this.voices.get(m.id);
    if (!v) return;
    if (m.rate !== undefined) v.rate = m.rate;
    if (m.pitch !== undefined) v.pitch = m.pitch;
    if (m.level !== undefined) v.target = m.level;
    if (m.offset !== undefined) this.bounds(v, m.offset, m.length);
    if (m.anchorPos !== undefined && currentFrame >= v.startFrame) {
      v.tl = this.wrap(v, (m.anchorPos + Math.max(0, currentTime - m.anchorAt) * v.rate) * v.buffer.rate);
    }
  }

  wrap(v, x) {
    if (!v.loop) return x;
    const len = v.hi - v.lo;
    return len > 0 ? v.lo + ((((x - v.lo) % len) + len) % len) : v.lo;
  }

  read(v, data, pos) {
    const x = this.wrap(v, pos);
    if (!v.loop && (x < v.lo || x >= v.hi)) return 0;
    const i = Math.floor(x);
    let j = i + 1;
    if (j >= v.hi) j = v.loop ? Math.ceil(v.lo) : -1;
    const a = data[i] ?? 0;
    const b = j >= 0 ? data[j] ?? 0 : 0;
    return a + (b - a) * (x - i);
  }

  nearest(v, pos) {
    const x = this.wrap(v, pos);
    if (!v.loop && (x < v.lo || x >= v.hi)) return 0;
    return v.buffer.mono[Math.floor(x)] ?? 0;
  }

  score(v, natural, at, step) {
    let xy = 0;
    let yy = 0;
    for (let j = 0; j < this.hop; j += DECIMATE) {
      const x = this.nearest(v, natural + j * step);
      const y = this.nearest(v, at + j * step);
      xy += x * y;
      yy += y * y;
    }
    return yy > 1e-12 ? xy / Math.sqrt(yy) : 0;
  }

  align(v, center, natural, step) {
    const radius = Math.round(SEARCH_SECONDS * v.buffer.rate);
    let best = 0;
    let top = this.score(v, natural, center, step);
    for (let d = -radius; d <= radius; d += COARSE) {
      const s = this.score(v, natural, center + d, step);
      if (s > top) {
        top = s;
        best = d;
      }
    }
    const coarse = best;
    for (let d = coarse - COARSE + 1; d < coarse + COARSE; d++) {
      if (d === coarse) continue;
      const s = this.score(v, natural, center + d, step);
      if (s > top) {
        top = s;
        best = d;
      }
    }
    return center + best;
  }

  spawn(v) {
    const step = v.pitch * v.k;
    const target = v.tl + v.rate * v.k * this.hop - this.hop * step;
    const natural = v.prev.pos + this.hop * v.prev.step;
    let diff = target - natural;
    if (v.loop) {
      const len = v.hi - v.lo;
      diff = len > 0 ? ((((diff + len / 2) % len) + len) % len) - len / 2 : 0;
    }
    const pos = Math.abs(diff) < 1 && v.prev.step === step ? natural : this.align(v, natural + diff, natural, step);
    v.prev = { pos, n: 0, step };
    v.grains.push(v.prev);
  }

  render(v, L, R, n) {
    const left = v.buffer.channels[0];
    const right = v.buffer.channels[1] ?? left;
    for (let i = 0; i < n; i++) {
      const frame = currentFrame + i;
      if (frame < v.startFrame) continue;
      if (frame >= v.stopFrame) {
        v.env *= this.release;
        if (frame - v.stopFrame > this.tail) {
          this.voices.delete(v.id);
          return;
        }
      }
      if (v.until <= 0) {
        if (!v.ending) this.spawn(v);
        v.until = this.hop;
      }
      v.until--;
      let l = 0;
      let r = 0;
      for (const g of v.grains) {
        const w = this.window[g.n];
        const pos = g.pos + g.n * g.step;
        l += w * this.read(v, left, pos);
        r += w * this.read(v, right, pos);
        g.n++;
      }
      while (v.grains.length && v.grains[0].n >= this.size) v.grains.shift();
      v.level += (v.target - v.level) * this.levelCoef;
      const gain = v.env * v.level;
      L[i] += l * gain;
      R[i] += r * gain;
      v.tl = this.wrap(v, v.tl + v.rate * v.k);
      if (!v.loop && v.tl >= v.hi) v.ending = true;
      if (v.ending && !v.grains.length) {
        this.voices.delete(v.id);
        this.port.postMessage({ type: 'ended', id: v.id });
        return;
      }
    }
  }

  process(_, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    for (const v of this.voices.values()) this.render(v, L, R, L.length);
    return true;
  }
}

registerProcessor('chrome404-stretch', StretchProcessor);
