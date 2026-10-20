import { dbToGain, effectShell, ramp } from './lib.js';

export const EQ_BANDS = [
  { key: 'low', name: 'Low', type: 'lowshelf', min: 20, max: 1000, freq: 100 },
  { key: 'lowMid', name: 'Low Mid', type: 'peaking', min: 40, max: 2000, freq: 250, q: true },
  { key: 'mid', name: 'Mid', type: 'peaking', min: 200, max: 8000, freq: 1000, q: true },
  { key: 'highMid', name: 'High Mid', type: 'peaking', min: 1000, max: 16000, freq: 3500, q: true },
  { key: 'high', name: 'High', type: 'highshelf', min: 1000, max: 20000, freq: 8000 }
];

export const EQ_GAIN_RANGE = 15;

function bandParams(band) {
  const params = [
    { id: `${band.key}Gain`, name: `${band.name} Gain`, kind: 'range', min: -EQ_GAIN_RANGE, max: EQ_GAIN_RANGE, default: 0, unit: 'dB' },
    { id: `${band.key}Freq`, name: `${band.name} Freq`, kind: 'range', min: band.min, max: band.max, default: band.freq, scale: 'log', unit: 'Hz' }
  ];
  if (band.q) params.push({ id: `${band.key}Q`, name: `${band.name} Q`, kind: 'range', min: 0.3, max: 10, default: 1, scale: 'log' });
  return params;
}

export default {
  id: 'equalizer',
  name: 'Equalizer',
  short: 'EQ',
  category: 'Filter',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  ui: 'eq',
  params: [...EQ_BANDS.flatMap(bandParams), { id: 'level', name: 'Level', kind: 'range', min: -12, max: 12, default: 0, unit: 'dB' }],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const filters = EQ_BANDS.map((band) => {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      return f;
    });
    filters.reduce((node, f) => node.connect(f), input).connect(output);

    const apply = { level: (v, i) => ramp(ctx, output.gain, dbToGain(v), i) };
    EQ_BANDS.forEach((band, n) => {
      apply[`${band.key}Gain`] = (v, i) => ramp(ctx, filters[n].gain, v, i);
      apply[`${band.key}Freq`] = (v, i) => ramp(ctx, filters[n].frequency, v, i);
      if (band.q) apply[`${band.key}Q`] = (v, i) => ramp(ctx, filters[n].Q, v, i);
    });

    return effectShell({ input, output, values: { ...initial }, apply, nodes: filters });
  }
};
