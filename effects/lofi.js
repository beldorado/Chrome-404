import { effectShell, ramp, tanhCurve, workletNode } from './lib.js';

export default {
  id: 'lofi',
  name: 'Lo-Fi',
  category: 'Character',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  worklet: 'worklets/crusher.js',
  params: [
    { id: 'rate', name: 'Rate', kind: 'range', min: 2000, max: 48000, default: 16000, scale: 'log', unit: 'Hz' },
    { id: 'bits', name: 'Bits', kind: 'range', min: 4, max: 16, default: 11 },
    { id: 'tone', name: 'Tone', kind: 'range', min: 200, max: 20000, default: 7000, scale: 'log', unit: 'Hz' },
    { id: 'drive', name: 'Drive', kind: 'range', min: 0, max: 1, default: 0.15, unit: '%' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 1, unit: '%' }
  ],

  create(ctx, initial, { bpm = 90 } = {}) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const antiAlias = ctx.createBiquadFilter();
    const crusher = workletNode(ctx, 'chrome404-crusher', { rate: initial.rate, bits: initial.bits }, bpm);
    const shaper = ctx.createWaveShaper();
    const tone = ctx.createBiquadFilter();
    antiAlias.type = 'lowpass';
    tone.type = 'lowpass';
    tone.Q.value = -3;
    input.connect(antiAlias).connect(crusher.node).connect(shaper).connect(tone).connect(output);

    const apply = {
      rate: (v, i) => {
        crusher.set('rate', v);
        ramp(ctx, antiAlias.frequency, Math.min(20000, v * 0.45), i);
      },
      bits: (v) => crusher.set('bits', v),
      tone: (v, i) => ramp(ctx, tone.frequency, v, i),
      drive: (v) => {
        shaper.curve = v > 0 ? tanhCurve(v * 0.4) : null;
      },
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    return effectShell({ input, output, values: { ...initial }, apply, nodes: [antiAlias, crusher.node, shaper, tone] });
  }
};
