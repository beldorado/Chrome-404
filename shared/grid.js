import { divisionBeats } from './sync.js';

export const BEATS_PER_BAR = 4;

export const QUANTIZE_OPTIONS = ['Off', '1/16', '1/8', '1/4', '1 bar'];

export const DEFAULT_QUANTIZE = '1/16';

const EPSILON = 1e-6;

export function beatAt(time, origin, bpm) {
  return ((time - origin) * bpm) / 60;
}

export function timeAtBeat(beat, origin, bpm) {
  return origin + (beat * 60) / bpm;
}

export function nextBoundary(time, origin, bpm, division) {
  const step = divisionBeats(division, 0);
  if (!step) return time;
  const target = Math.ceil(beatAt(time, origin, bpm) / step - EPSILON) * step;
  return Math.max(time, timeAtBeat(target, origin, bpm));
}

export function rebase(time, origin, fromBpm, toBpm) {
  return time - (beatAt(time, origin, fromBpm) * 60) / toBpm;
}

export function position(beat) {
  const whole = Math.floor(beat + EPSILON);
  return { bar: Math.floor(whole / BEATS_PER_BAR) + 1, beat: (((whole % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) + 1 };
}
