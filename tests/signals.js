export const RATE = 48000;

export const FOUR_ON_FLOOR = { kick: [0, 1, 2, 3], snare: [1, 3] };
export const BOOM_BAP = { kick: [0, 1.75, 2.5], snare: [1, 3] };

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function addHit(data, at, length, sample) {
  const start = Math.round(at * RATE);
  const n = Math.min(Math.round(length * RATE), data.length - start);
  for (let i = 0; i < n; i++) data[start + i] += sample(i / RATE);
}

export function fillDrums(left, bpm, seconds, pattern) {
  const random = rng(99);
  const beat = 60 / bpm;
  const kick = (t) => 0.8 * Math.exp(-t / 0.08) * Math.sin(2 * Math.PI * (50 * t + 70 * 0.03 * (1 - Math.exp(-t / 0.03))));
  const snare = (t) => 0.45 * Math.exp(-t / 0.06) * (random() * 2 - 1);
  const hat = (t) => 0.12 * Math.exp(-t / 0.015) * (random() * 2 - 1);
  for (let bar = 0; bar * 4 * beat < seconds; bar++) {
    const t0 = bar * 4 * beat;
    for (const k of pattern.kick) if (t0 + k * beat < seconds) addHit(left, t0 + k * beat, 0.3, kick);
    for (const s of pattern.snare) if (t0 + s * beat < seconds) addHit(left, t0 + s * beat, 0.2, snare);
    for (let e = 0; e < 8; e++) if (t0 + e * beat * 0.5 < seconds) addHit(left, t0 + e * beat * 0.5, 0.05, hat);
  }
  const end = Math.min(left.length, Math.round(seconds * RATE));
  for (let i = 0; i < end; i++) left[i] += (random() * 2 - 1) * 0.01;
}

export function drumLoop(ctx, bpm, seconds, pattern, totalSeconds = seconds) {
  const buffer = ctx.createBuffer(2, Math.round(totalSeconds * RATE), RATE);
  const left = buffer.getChannelData(0);
  fillDrums(left, bpm, seconds, pattern);
  buffer.getChannelData(1).set(left);
  return buffer;
}

export function sineBuffer(ctx, frequency, seconds, amplitude = 0.4) {
  const buffer = ctx.createBuffer(2, Math.round(seconds * RATE), RATE);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE);
  }
  return buffer;
}
