import { disconnectAll, lfo, ramp } from './lib.js';

const STAGE_SPREAD = 1.6;
const CENTS_PER_DEPTH = 3600;

export default {
  id: 'phaser',
  name: 'Phaser',
  category: 'Space',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  defaultMix: 0.5,
  params: [
    { id: 'rate', name: 'Rate', kind: 'range', min: 0.03, max: 8, default: 0.4, scale: 'log', unit: 'Hz' },
    { id: 'depth', name: 'Depth', kind: 'range', min: 0, max: 1, default: 0.6, unit: '%' },
    { id: 'center', name: 'Center', kind: 'range', min: 50, max: 10000, default: 700, scale: 'log', unit: 'Hz' },
    { id: 'stages', name: 'Stages', kind: 'enum', options: ['4', '8', '12'], default: '8' },
    { id: 'resonance', name: 'Reso', kind: 'range', min: 0.3, max: 6, default: 0.8, scale: 'log' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const osc = lfo(ctx, 'sine', initial.rate);
    const depth = ctx.createGain();
    osc.connect(depth);
    const values = { ...initial };
    let stages = [];

    const rebuild = () => {
      input.disconnect();
      depth.disconnect();
      stages.forEach((f) => f.disconnect());
      stages = Array.from({ length: Number(values.stages) || 8 }, (_, i) => {
        const f = ctx.createBiquadFilter();
        f.type = 'allpass';
        f.frequency.value = values.center * Math.pow(STAGE_SPREAD, (i % 4) - 1.5);
        f.Q.value = values.resonance;
        depth.connect(f.detune);
        return f;
      });
      stages.reduce((node, f) => node.connect(f), input).connect(output);
    };

    const apply = {
      rate: (v, i) => ramp(ctx, osc.frequency, v, i),
      depth: (v, i) => ramp(ctx, depth.gain, v * CENTS_PER_DEPTH * 0.5, i),
      center: (v, i) => stages.forEach((f, n) => ramp(ctx, f.frequency, v * Math.pow(STAGE_SPREAD, (n % 4) - 1.5), i)),
      stages: rebuild,
      resonance: (v, i) => stages.forEach((f) => ramp(ctx, f.Q, v, i))
    };

    rebuild();
    for (const id of ['rate', 'depth']) apply[id](values[id], true);

    return {
      input,
      output,
      setParam(id, value) {
        values[id] = value;
        apply[id]?.(value, false);
      },
      dispose() {
        disconnectAll(input, output, osc, depth, ...stages);
      }
    };
  }
};
