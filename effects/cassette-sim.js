import { effectShell, lfo, loopSource, noiseBuffer, ramp, tanhCurve } from './lib.js';

const BASE_DELAY = 0.016;
const MAX_WOW = 0.011;
const MAX_FLUTTER = 0.0007;

export default {
  id: 'cassette-sim',
  name: 'Cassette Sim',
  short: 'Cassette',
  category: 'Character',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  latency: BASE_DELAY,
  params: [
    { id: 'tone', name: 'Tone', kind: 'range', min: 200, max: 20000, default: 9000, scale: 'log', unit: 'Hz' },
    { id: 'drive', name: 'Saturate', kind: 'range', min: 0, max: 1, default: 0.35, unit: '%' },
    { id: 'wow', name: 'Wow', kind: 'range', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'flutter', name: 'Flutter', kind: 'range', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'hiss', name: 'Hiss', kind: 'range', min: 0, max: 1, default: 0.2, unit: '%' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 1, unit: '%' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '2x';
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = BASE_DELAY;
    const wowOsc = lfo(ctx, 'sine', 0.4);
    const wowDepth = ctx.createGain();
    const flutterOsc = lfo(ctx, 'triangle', 7.3);
    const flutterDepth = ctx.createGain();
    wowOsc.connect(wowDepth).connect(delay.delayTime);
    flutterOsc.connect(flutterDepth).connect(delay.delayTime);

    const headBump = ctx.createBiquadFilter();
    headBump.type = 'peaking';
    headBump.frequency.value = 90;
    headBump.Q.value = 0.9;
    headBump.gain.value = 3;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = -2;
    input.connect(shaper).connect(delay).connect(headBump).connect(tone).connect(output);

    const hiss = loopSource(ctx, noiseBuffer(ctx), 0.97);
    const hissTone = ctx.createBiquadFilter();
    hissTone.type = 'highshelf';
    hissTone.frequency.value = 4000;
    hissTone.gain.value = 6;
    const hissGain = ctx.createGain();
    hiss.connect(hissTone).connect(hissGain).connect(output);

    const apply = {
      tone: (v, i) => ramp(ctx, tone.frequency, v, i),
      drive: (v) => {
        shaper.curve = v > 0 ? tanhCurve(v * 0.25, 0.15) : null;
      },
      wow: (v, i) => ramp(ctx, wowDepth.gain, v * MAX_WOW, i),
      flutter: (v, i) => ramp(ctx, flutterDepth.gain, v * MAX_FLUTTER, i),
      hiss: (v, i) => ramp(ctx, hissGain.gain, v * 0.02, i),
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    return effectShell({
      input,
      output,
      values: { ...initial },
      apply,
      nodes: [shaper, delay, wowOsc, wowDepth, flutterOsc, flutterDepth, headBump, tone, hiss, hissTone, hissGain]
    });
  }
};
