import { effectShell, ramp, workletNode } from './lib.js';

export default {
  id: 'bit-crusher',
  name: 'Bit Crusher',
  short: 'Crusher',
  category: 'Character',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  worklet: 'worklets/crusher.js',
  params: [
    { id: 'bits', name: 'Bits', kind: 'range', min: 1, max: 16, default: 6 },
    { id: 'rate', name: 'Rate', kind: 'range', min: 500, max: 48000, default: 8000, scale: 'log', unit: 'Hz' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 0.8, unit: '%' }
  ],

  create(ctx, initial, { bpm = 90 } = {}) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const crusher = workletNode(ctx, 'chrome404-crusher', { rate: initial.rate, bits: initial.bits }, bpm);
    input.connect(crusher.node).connect(output);

    const apply = {
      bits: (v) => crusher.set('bits', v),
      rate: (v) => crusher.set('rate', v),
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    return effectShell({ input, output, values: { ...initial }, apply, nodes: [crusher.node] });
  }
};
