import { disconnectAll, workletNode } from './lib.js';

const LOOKAHEAD = 0.005;

export default {
  id: 'limiter',
  name: 'Limiter',
  category: 'Character',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  worklet: 'worklets/limiter.js',
  latency: LOOKAHEAD,
  meter: 'reduction',
  params: [
    { id: 'gain', name: 'Gain', kind: 'range', min: 0, max: 24, default: 0, unit: 'dB' },
    { id: 'ceiling', name: 'Ceiling', kind: 'range', min: -24, max: 0, default: -1, unit: 'dB' },
    { id: 'release', name: 'Release', kind: 'range', min: 0.005, max: 1, default: 0.1, scale: 'log', unit: 's' }
  ],

  create(ctx, initial, { bpm = 90 } = {}) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const worklet = workletNode(ctx, 'chrome404-limiter', { ...initial, lookahead: LOOKAHEAD }, bpm);
    input.connect(worklet.node).connect(output);
    let reduction = 0;
    worklet.node.port.onmessage = ({ data }) => {
      if (data.type === 'meter') reduction = data.reduction;
    };
    return {
      input,
      output,
      setParam: (id, value) => worklet.set(id, value),
      meter: () => ({ reduction }),
      dispose() {
        worklet.node.port.onmessage = null;
        disconnectAll(input, worklet.node, output);
      }
    };
  }
};
