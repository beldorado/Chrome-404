import { effectShell } from './lib.js';
import { stereoModDelay } from './modulation.js';

const BASE_DELAY = 0.016;
const MAX_DEPTH = 0.006;

export default {
  id: 'chorus',
  name: 'Chorus',
  category: 'Space',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  defaultMix: 0.5,
  params: [
    { id: 'rate', name: 'Rate', kind: 'range', min: 0.05, max: 5, default: 0.6, scale: 'log', unit: 'Hz' },
    { id: 'depth', name: 'Depth', kind: 'range', min: 0, max: 1, default: 0.5, unit: '%' }
  ],

  create(ctx, initial) {
    const voice = stereoModDelay(ctx, { baseDelay: BASE_DELAY });

    const apply = {
      rate: (v, i) => voice.setRate(v, i),
      depth: (v, i) => voice.setDepth(v * MAX_DEPTH, i)
    };

    return effectShell({ input: voice.input, output: voice.output, values: { ...initial }, apply, nodes: voice.nodes });
  }
};
