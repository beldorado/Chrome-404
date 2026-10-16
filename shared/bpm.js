import { clamp } from './params.js';

const OCTAVE_PREFERENCE = 0.9;

function autocorrelate(x, maxLag) {
  const n = x.length;
  const out = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += x[i] * x[i - lag];
    out[lag] = sum / (n - lag);
  }
  return out;
}

function parabolicPeak(acf, i) {
  const a = acf[i - 1];
  const b = acf[i];
  const c = acf[i + 1];
  const d = a - 2 * b + c;
  return d < 0 ? i + (0.5 * (a - c)) / d : i;
}

function refineLag(acf, lag) {
  let positions = 0;
  let weights = 0;
  for (let m = 1; m <= 4; m++) {
    const center = Math.round(lag * m);
    if (center + m + 1 >= acf.length) break;
    let peak = center;
    for (let i = center - m; i <= center + m; i++) if (acf[i] > acf[peak]) peak = i;
    positions += parabolicPeak(acf, peak);
    weights += m;
  }
  return weights ? positions / weights : lag;
}

function peakNear(acf, center, radius) {
  let best = -Infinity;
  for (let i = Math.max(1, center - radius); i <= Math.min(acf.length - 1, center + radius); i++) best = Math.max(best, acf[i]);
  return best;
}

function periodicity(acf, lag) {
  let sum = 0;
  let count = 0;
  for (let k = 1; ; k++) {
    const radius = 1 + Math.floor(k / 4);
    const center = Math.round(k * lag);
    if (center + radius >= acf.length) break;
    sum += peakNear(acf, center, radius);
    count++;
  }
  return count ? sum / count : -Infinity;
}

export function estimateTempo(onsets, frameRate, { minBpm = 60, maxBpm = 200, centerBpm = 110, octaveWidth = 1.5, minStrength = 1e-3 } = {}) {
  const n = onsets.length;
  let mean = 0;
  for (const v of onsets) mean += v;
  mean /= n;
  if (!(mean >= minStrength)) return null;

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = onsets[i] - mean;

  const longestLag = Math.ceil((60 * frameRate) / minBpm);
  const acf = autocorrelate(x, Math.min(Math.floor(n / 2), longestLag * 4 + 2));
  if (acf[0] <= 0) return null;

  const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(longestLag, acf.length - 2);
  const scores = new Map();
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] < acf[lag - 1] || acf[lag] < acf[lag + 1]) continue;
    const bpm = (60 * frameRate) / lag;
    const weight = Math.exp(-0.5 * (Math.log2(bpm / centerBpm) / octaveWidth) ** 2);
    scores.set(lag, weight * periodicity(acf, lag));
    if (best < 0 || scores.get(lag) > scores.get(best)) best = lag;
  }
  if (best < 0) return null;

  for (const [lag, score] of scores) {
    if (Math.abs(lag - best / 2) <= 2 && score >= OCTAVE_PREFERENCE * scores.get(best)) {
      best = lag;
      break;
    }
  }

  return {
    bpm: (60 * frameRate) / refineLag(acf, best),
    confidence: clamp(acf[best] / acf[0], 0, 1)
  };
}

const PHASE_BINS = 64;
const PHASE_KERNEL = [1, 2, 3, 2, 1];

export function beatPhase(onsets, times, bpm) {
  const n = Math.min(onsets.length, times.length);
  if (!n || !(bpm > 0)) return null;
  const period = 60 / bpm;
  const bins = new Float64Array(PHASE_BINS);
  let total = 0;
  for (let j = 0; j < n; j++) {
    const p = (((times[j] % period) + period) % period) / period;
    bins[Math.floor(p * PHASE_BINS) % PHASE_BINS] += onsets[j];
    total += onsets[j];
  }
  if (total <= 0) return null;
  const half = (PHASE_KERNEL.length - 1) / 2;
  const smooth = bins.map((_, i) => PHASE_KERNEL.reduce((sum, w, k) => sum + w * bins[(i + k - half + PHASE_BINS) % PHASE_BINS], 0));
  let best = 0;
  for (let i = 1; i < PHASE_BINS; i++) if (smooth[i] > smooth[best]) best = i;
  const a = smooth[(best - 1 + PHASE_BINS) % PHASE_BINS];
  const b = smooth[best];
  const c = smooth[(best + 1) % PHASE_BINS];
  const d = a - 2 * b + c;
  const offset = d < 0 ? (0.5 * (a - c)) / d : 0;
  const phase = (((best + 0.5 + offset) / PHASE_BINS) % 1) * period;
  const last = times[n - 1];
  const mean = smooth.reduce((x, y) => x + y, 0) / PHASE_BINS;
  return { beat: last - ((((last - phase) % period) + period) % period), strength: b / Math.max(1e-9, mean) };
}
