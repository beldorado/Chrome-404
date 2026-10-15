import { dbToGain, effectShell, ramp } from './lib.js';

export default {
  id: 'compressor',
  name: 'Compressor',
  category: 'Character',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  ui: 'compressor',
  params: [
    { id: 'threshold', name: 'Thresh', kind: 'range', min: -60, max: 0, default: -24, unit: 'dB' },
    { id: 'ratio', name: 'Ratio', kind: 'range', min: 1, max: 20, default: 4, scale: 'log', unit: ':1' },
    { id: 'attack', name: 'Attack', kind: 'range', min: 0.001, max: 0.3, default: 0.01, scale: 'log', unit: 's' },
    { id: 'release', name: 'Release', kind: 'range', min: 0.02, max: 1, default: 0.25, scale: 'log', unit: 's' },
    { id: 'knee', name: 'Knee', kind: 'range', min: 0, max: 40, default: 6, unit: 'dB' },
    { id: 'makeup', name: 'Makeup', kind: 'range', min: 0, max: 24, default: 2, unit: 'dB' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    input.connect(comp).connect(output);

    const apply = {
      threshold: (v, i) => ramp(ctx, comp.threshold, v, i),
      ratio: (v, i) => ramp(ctx, comp.ratio, v, i),
      attack: (v, i) => ramp(ctx, comp.attack, v, i),
      release: (v, i) => ramp(ctx, comp.release, v, i),
      knee: (v, i) => ramp(ctx, comp.knee, v, i),
      makeup: (v, i) => ramp(ctx, output.gain, dbToGain(v), i)
    };

    return {
      ...effectShell({ input, output, values: { ...initial }, apply, nodes: [comp] }),
      meter: () => ({ reduction: comp.reduction })
    };
  }
};
