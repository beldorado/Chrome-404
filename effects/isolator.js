import { effectShell, ramp } from './lib.js';

const BUTTERWORTH_Q_DB = -3.0103;

function linkwitzRiley(ctx, type) {
  const a = ctx.createBiquadFilter();
  const b = ctx.createBiquadFilter();
  for (const f of [a, b]) {
    f.type = type;
    f.Q.value = BUTTERWORTH_Q_DB;
  }
  a.connect(b);
  return { input: a, output: b, filters: [a, b] };
}

export default {
  id: 'isolator',
  name: 'Isolator',
  category: 'Filter',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  params: [
    { id: 'low', name: 'Low', kind: 'range', min: 0, max: 1.5, default: 0, unit: '%' },
    { id: 'mid', name: 'Mid', kind: 'range', min: 0, max: 1.5, default: 1.25, unit: '%' },
    { id: 'high', name: 'High', kind: 'range', min: 0, max: 1.5, default: 0, unit: '%' },
    { id: 'lowFreq', name: 'Lo X', kind: 'range', min: 20, max: 2000, default: 212, scale: 'log', unit: 'Hz' },
    { id: 'highFreq', name: 'Hi X', kind: 'range', min: 500, max: 16000, default: 2810, scale: 'log', unit: 'Hz' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const low = linkwitzRiley(ctx, 'lowpass');
    const midHp = linkwitzRiley(ctx, 'highpass');
    const midLp = linkwitzRiley(ctx, 'lowpass');
    const high = linkwitzRiley(ctx, 'highpass');
    const gains = { low: ctx.createGain(), mid: ctx.createGain(), high: ctx.createGain() };

    input.connect(low.input);
    low.output.connect(gains.low).connect(output);
    input.connect(midHp.input);
    midHp.output.connect(midLp.input);
    midLp.output.connect(gains.mid).connect(output);
    input.connect(high.input);
    high.output.connect(gains.high).connect(output);

    const setFreq = (filters, value, immediate) => filters.forEach((f) => ramp(ctx, f.frequency, value, immediate));
    const values = { ...initial };
    const apply = {
      low: (v, i) => ramp(ctx, gains.low.gain, v, i),
      mid: (v, i) => ramp(ctx, gains.mid.gain, v, i),
      high: (v, i) => ramp(ctx, gains.high.gain, v, i),
      lowFreq: (v, i) => setFreq([...low.filters, ...midHp.filters], v, i),
      highFreq: (v, i) => setFreq([...midLp.filters, ...high.filters], v, i)
    };

    return effectShell({
      input,
      output,
      values,
      apply,
      nodes: [...low.filters, ...midHp.filters, ...midLp.filters, ...high.filters, ...Object.values(gains)]
    });
  }
};
