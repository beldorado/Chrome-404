const BATCH = 16;
const LOW_SPLIT_HZ = 200;
const COMPRESSION = 1000;

class OnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.hop = options.processorOptions?.hop ?? 512;
    this.alpha = 1 - Math.exp((-2 * Math.PI * LOW_SPLIT_HZ) / sampleRate);
    this.low = 0;
    this.count = 0;
    this.lowEnergy = 0;
    this.highEnergy = 0;
    this.prevLow = 0;
    this.prevHigh = 0;
    this.onsets = new Float32Array(BATCH);
    this.filled = 0;
    this.batchEnergy = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let x = 0;
      for (const channel of channels) x += channel[i];
      x /= channels.length;
      this.low += this.alpha * (x - this.low);
      const high = x - this.low;
      this.lowEnergy += this.low * this.low;
      this.highEnergy += high * high;
      if (++this.count === this.hop) this.frame();
    }
    return true;
  }

  frame() {
    const low = Math.log1p((COMPRESSION * this.lowEnergy) / this.hop);
    const high = Math.log1p((COMPRESSION * this.highEnergy) / this.hop);
    this.onsets[this.filled++] = Math.max(0, low - this.prevLow) + Math.max(0, high - this.prevHigh);
    this.batchEnergy += (this.lowEnergy + this.highEnergy) / this.hop;
    this.prevLow = low;
    this.prevHigh = high;
    this.count = 0;
    this.lowEnergy = 0;
    this.highEnergy = 0;
    if (this.filled === BATCH) {
      this.port.postMessage({ onsets: this.onsets.slice(), energy: this.batchEnergy / BATCH });
      this.filled = 0;
      this.batchEnergy = 0;
    }
  }
}

registerProcessor('chrome404-onset', OnsetProcessor);
