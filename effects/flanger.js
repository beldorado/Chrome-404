import { effectShell, ramp } from './lib.js';
import { stereoModDelay } from './modulation.js';

const MIN_DELAY = 0.003;
const MAX_SWEEP = 0.004;

export default {
  id: 'flanger',
  name: 'Flanger',
  category: 'Space',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  defaultMix: 0.5,
  params: [
    { id: 'rate', name: 'Rate', kind: 'range', min: 0.02, max: 5, default: 0.25, scale: 'log', unit: 'Hz' },
    { id: 'depth', name: 'Depth', kind: 'range', min: 0, max: 1, default: 0.7, unit: '%' },
    { id: 'manual', name: 'Manual', kind: 'range', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'feedback', name: 'Reso', kind: 'range', min: -0.9, max: 0.9, default: 0.6 }
  ],

  create(ctx, initial) {
    const voice = stereoModDelay(ctx, { baseDelay: MIN_DELAY + MAX_SWEEP });
    const feedback = ctx.createGain();
    voice.output.connect(feedback).connect(voice.input);
    const values = { ...initial };

    const sweep = (immediate) => {
      const depth = values.depth * MAX_SWEEP * 0.5;
      voice.setBase(MIN_DELAY + depth + values.manual * MAX_SWEEP * 0.5, immediate);
      voice.setDepth(depth, immediate);
    };

    const apply = {
      rate: (v, i) => voice.setRate(v, i),
      depth: (_, i) => sweep(i),
      manual: (_, i) => sweep(i),
      feedback: (v, i) => ramp(ctx, feedback.gain, v, i)
    };

    return effectShell({ input: voice.input, output: voice.output, values, apply, nodes: [...voice.nodes, feedback] });
  }
};
