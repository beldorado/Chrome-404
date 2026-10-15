let silence = new Float32Array(128);

function zeros(n) {
  if (silence.length < n) silence = new Float32Array(n);
  return silence;
}

export class EffectProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'active', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bpm', defaultValue: 90, minValue: 20, maxValue: 300, automationRate: 'k-rate' }
    ];
  }

  constructor(options) {
    super();
    this.params = { ...(options.processorOptions?.params ?? {}) };
    this.bpm = 90;
    this.active = false;
    this.port.onmessage = ({ data }) => {
      if (data.type !== 'param') return;
      this.params[data.id] = data.value;
      this.onParam?.(data.id, data.value);
    };
  }

  samplesPerBeat() {
    return (sampleRate * 60) / this.bpm;
  }

  process(inputs, outputs, parameters) {
    this.bpm = parameters.bpm[0];
    const active = parameters.active[0] >= 0.5;
    if (active !== this.active) {
      this.active = active;
      this.onActive?.(active);
    }
    const input = inputs[0];
    const output = outputs[0];
    const n = output[0].length;
    const inL = input[0] ?? zeros(n);
    const inR = input[1] ?? inL;
    this.render(inL, inR, output[0], output[1] ?? output[0], n);
    return true;
  }
}

export class RingBuffer {
  constructor(seconds) {
    this.size = Math.ceil(seconds * sampleRate);
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.write = 0;
  }

  push(l, r) {
    this.left[this.write] = l;
    this.right[this.write] = r;
    this.write = (this.write + 1) % this.size;
  }

  wrap(index) {
    return ((index % this.size) + this.size) % this.size;
  }

  readL(position) {
    const i = Math.floor(position);
    const f = position - i;
    const a = this.left[this.wrap(i)];
    return a + (this.left[this.wrap(i + 1)] - a) * f;
  }

  readR(position) {
    const i = Math.floor(position);
    const f = position - i;
    const a = this.right[this.wrap(i)];
    return a + (this.right[this.wrap(i + 1)] - a) * f;
  }
}

export function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
