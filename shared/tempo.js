import { clamp } from './params.js';

export const BPM_MIN = 40;
export const BPM_MAX = 240;

export function clampBpm(bpm) {
  return Math.round(clamp(Number(bpm) || 90, BPM_MIN, BPM_MAX) * 10) / 10;
}

export class TapTempo {
  constructor({ resetAfterMs = 2000, maxTaps = 5 } = {}) {
    this.resetAfterMs = resetAfterMs;
    this.maxTaps = maxTaps;
    this.taps = [];
    this.count = 0;
  }

  tap(now = performance.now()) {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > this.resetAfterMs) {
      this.taps = [];
      this.count = 0;
    }
    this.taps.push(now);
    this.count++;
    if (this.taps.length > this.maxTaps) this.taps.shift();
    if (this.taps.length < 2) return null;
    const interval = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    return clampBpm(60000 / interval);
  }
}
