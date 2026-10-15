import { effectShell, ramp } from './lib.js';

const REBUILD_DELAY_MS = 120;

function impulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.round(seconds * rate));
  const buffer = ctx.createBuffer(2, length, rate);
  const decay = Math.log(1000) / seconds;
  let seed = 0x5eed;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = i / rate;
      const darken = 0.15 + 0.85 * Math.exp(-t * 2.5);
      smooth += darken * ((seed / 0xffffffff) * 2 - 1 - smooth);
      data[i] = smooth * Math.exp(-decay * t) * Math.min(1, t / 0.004);
    }
  }
  return buffer;
}

export default {
  id: 'reverb',
  name: 'Reverb',
  category: 'Space',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  defaultMix: 0.3,
  params: [
    { id: 'time', name: 'Time', kind: 'range', min: 0.2, max: 10, default: 2.2, scale: 'log', unit: 's', modulatable: false },
    { id: 'preDelay', name: 'Pre-Dly', kind: 'range', min: 0, max: 0.25, default: 0.02, unit: 's' },
    { id: 'lowCut', name: 'Low Cut', kind: 'range', min: 20, max: 5000, default: 150, scale: 'log', unit: 'Hz' },
    { id: 'tone', name: 'Tone', kind: 'range', min: 200, max: 20000, default: 7000, scale: 'log', unit: 'Hz' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const preDelay = ctx.createDelay(0.5);
    const convolver = ctx.createConvolver();
    const lowCut = ctx.createBiquadFilter();
    const tone = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    tone.type = 'lowpass';
    input.connect(preDelay).connect(lowCut).connect(convolver).connect(tone).connect(output);

    let pending = null;
    const apply = {
      time: (v, immediate) => {
        clearTimeout(pending);
        if (immediate) convolver.buffer = impulse(ctx, v);
        else pending = setTimeout(() => (convolver.buffer = impulse(ctx, v)), REBUILD_DELAY_MS);
      },
      preDelay: (v, i) => ramp(ctx, preDelay.delayTime, v, i),
      lowCut: (v, i) => ramp(ctx, lowCut.frequency, v, i),
      tone: (v, i) => ramp(ctx, tone.frequency, v, i)
    };

    const shell = effectShell({ input, output, values: { ...initial }, apply, nodes: [preDelay, lowCut, convolver, tone] });
    return {
      ...shell,
      dispose() {
        clearTimeout(pending);
        shell.dispose();
      }
    };
  }
};
