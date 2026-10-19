import { PAD_COUNT } from '../shared/state.js';

const RELEASE = 0.006;
const PEAK_BINS = 48;

const level = (v) => Math.round(Math.min(1, v) * 100) / 100;

// Peak and RMS per bin of the mono mix, the same signal the waveform editor draws.
export function waveOf(buffer, bins = PEAK_BINS, start = 0, end = buffer.duration) {
  const peaks = new Array(bins).fill(0);
  const rms = new Array(bins).fill(0);
  const from = Math.max(0, Math.floor(start * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const per = Math.max(1, to - from) / bins;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));
  for (let b = 0; b < bins; b++) {
    const lo = from + Math.floor(b * per);
    const hi = Math.min(to, from + Math.floor((b + 1) * per));
    let peak = 0;
    let sum = 0;
    for (let i = lo; i < hi; i++) {
      let v = 0;
      for (const data of channels) v += data[i];
      v /= channels.length;
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    peaks[b] = level(peak);
    rms[b] = level(Math.sqrt(sum / Math.max(1, hi - lo)));
  }
  return { peaks, rms };
}

export class PadBank {
  constructor(ctx, { onEnded = () => {} } = {}) {
    this.ctx = ctx;
    this.onEnded = onEnded;
    this.output = ctx.createGain();
    this.buffers = new Array(PAD_COUNT).fill(null);
    this.voices = new Map();
    this.stretch = null;
    this.posted = new Map();
    this.voiceCounter = 0;
  }

  async enableStretch() {
    if (this.stretch) return;
    await this.ctx.audioWorklet.addModule(new URL('./worklets/stretch-processor.js', import.meta.url));
    this.stretch = new AudioWorkletNode(this.ctx, 'chrome404-stretch', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.stretch.port.onmessage = ({ data }) => {
      if (data.type !== 'ended') return;
      for (const [index, voice] of this.voices) {
        if (voice.id !== data.id) continue;
        this.voices.delete(index);
        this.onEnded(index);
      }
    };
    this.stretch.connect(this.output);
  }

  setBuffer(index, buffer) {
    this.stop(index);
    if (this.previewOf === index) this.stop('preview');
    this.buffers[index] = buffer;
    if (this.posted.has(index)) {
      this.posted.delete(index);
      this.stretch.port.postMessage({ type: 'drop', key: index });
    }
  }

  has(index) {
    return Boolean(this.buffers[index]);
  }

  playing(index) {
    return this.voices.has(index);
  }

  keyOf(index) {
    return typeof index === 'number' ? index : this.previewOf;
  }

  load(key) {
    const buffer = this.buffers[key];
    if (this.posted.get(key) === buffer) return null;
    this.posted.set(key, buffer);
    return { channels: Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch).slice()), sampleRate: buffer.sampleRate };
  }

  start(index, { loop = false, when = 0, rate = 1, level = 1, offset = 0, duration = null, from = offset, pitch = 1, stretch = false } = {}) {
    const key = this.keyOf(index);
    const buffer = this.buffers[key];
    if (!buffer) return false;
    this.stop(index);
    const length = duration ?? buffer.duration - offset;
    const startAt = Math.max(this.ctx.currentTime, when);
    const voice = { id: ++this.voiceCounter, startAt, loop, rate, level, pitch, offset, length, anchorAt: startAt, anchorPos: from, stretch: stretch && Boolean(this.stretch) };
    if (voice.stretch) {
      const load = this.load(key);
      this.stretch.port.postMessage({ type: 'start', id: voice.id, key, load, when: startAt, from, offset, length, loop, rate, pitch, level }, load ? load.channels.map((c) => c.buffer) : []);
      this.voices.set(index, voice);
      return true;
    }
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = loop;
    if (loop) {
      source.loopStart = offset;
      source.loopEnd = offset + length;
    }
    source.playbackRate.value = rate;
    gain.gain.value = level;
    source.connect(gain).connect(this.output);
    Object.assign(voice, { source, gain });
    source.addEventListener('ended', () => {
      gain.disconnect();
      if (this.voices.get(index) !== voice) return;
      this.voices.delete(index);
      this.onEnded(index);
    });
    if (loop) source.start(startAt, from);
    else source.start(startAt, from, Math.max(0, offset + length - from));
    this.voices.set(index, voice);
    return true;
  }

  stop(index, when = 0) {
    const voice = this.voices.get(index);
    if (!voice) return false;
    this.voices.delete(index);
    const at = Math.max(this.ctx.currentTime, when);
    if (voice.stretch) {
      this.stretch.port.postMessage({ type: 'stop', id: voice.id, at });
      return true;
    }
    if (at <= voice.startAt) {
      voice.source.stop();
      return true;
    }
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setTargetAtTime(0, at, RELEASE);
    try {
      voice.source.stop(at + RELEASE * 8);
    } catch {}
    return true;
  }

  stopAll() {
    for (const index of [...this.voices.keys()]) this.stop(index);
  }

  preview(index, { offset, duration, rate = 1, pitch = 1, stretch = false }) {
    if (!this.buffers[index]) return false;
    this.previewOf = index;
    return this.start('preview', { offset, duration, rate, pitch, stretch });
  }

  positionOf(voice, time) {
    const at = voice.anchorPos + Math.max(0, time - voice.anchorAt) * voice.rate;
    const end = voice.offset + voice.length;
    if (!voice.loop) return Math.min(at, end);
    return at < end ? at : voice.offset + ((at - voice.offset) % voice.length);
  }

  // Where in the buffer a voice is at `time`, or null if it hasn't started yet.
  head(index, time = this.ctx.currentTime) {
    const voice = this.voices.get(index);
    if (!voice || time < voice.startAt) return null;
    return { at: this.positionOf(voice, time), rate: voice.rate, start: voice.offset, end: voice.offset + voice.length, loop: voice.loop };
  }

  reanchor(voice) {
    const now = this.ctx.currentTime;
    if (now <= voice.anchorAt) return;
    voice.anchorPos = this.positionOf(voice, now);
    voice.anchorAt = now;
  }

  tell(voice, changes) {
    this.stretch.port.postMessage({ type: 'set', id: voice.id, anchorAt: voice.anchorAt, anchorPos: voice.anchorPos, ...changes });
  }

  setLoop(index, offset, duration) {
    const voice = this.voices.get(index);
    if (!voice?.loop) return;
    this.reanchor(voice);
    voice.offset = offset;
    voice.length = duration;
    if (voice.stretch) {
      this.tell(voice, { offset, length: duration });
      return;
    }
    voice.source.loopStart = offset;
    voice.source.loopEnd = offset + duration;
  }

  setRate(index, rate) {
    const voice = this.voices.get(index);
    if (!voice || voice.rate === rate) return;
    this.reanchor(voice);
    voice.rate = rate;
    if (voice.stretch) this.tell(voice, { rate });
    else voice.source.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.01);
  }

  setPitch(index, pitch) {
    const voice = this.voices.get(index);
    if (!voice || voice.pitch === pitch) return;
    voice.pitch = pitch;
    if (voice.stretch) this.stretch.port.postMessage({ type: 'set', id: voice.id, pitch });
  }

  restyle(index, { pitch, stretch }) {
    const voice = this.voices.get(index);
    if (!voice || voice.stretch === (stretch && Boolean(this.stretch))) {
      this.setPitch(index, pitch);
      return;
    }
    const now = this.ctx.currentTime;
    const started = now >= voice.startAt;
    const from = started ? this.positionOf(voice, now) : voice.anchorPos;
    this.start(index, { loop: voice.loop, when: started ? 0 : voice.startAt, rate: voice.rate, level: voice.level, offset: voice.offset, duration: voice.length, from, pitch, stretch });
  }

  setLevel(index, level) {
    const voice = this.voices.get(index);
    if (!voice) return;
    voice.level = level;
    if (voice.stretch) this.stretch.port.postMessage({ type: 'set', id: voice.id, level });
    else voice.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.01);
  }
}
