import { effectShell, lfo, loopSource, noiseBuffer, ramp, tanhCurve } from './lib.js';

const BASE_DELAY = 0.016;
const MAX_WOW = 0.009;
const crackleCache = new WeakMap();

function crackleBuffer(ctx) {
  if (crackleCache.has(ctx)) return crackleCache.get(ctx);
  const seconds = 5;
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(2, seconds * rate, rate);
  let seed = 0x404;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const clicks = seconds * 40;
    for (let c = 0; c < clicks; c++) {
      const start = Math.floor(random() * (data.length - 200));
      const pop = random() < 0.04;
      const amp = (pop ? 0.7 : 0.35) * Math.pow(random(), 2.5) * (random() < 0.5 ? -1 : 1);
      const decay = (pop ? 0.0012 : 0.0002) * rate;
      for (let i = 0; i < 200; i++) data[start + i] += amp * Math.exp(-i / decay) * (i === 0 ? 1 : random() * 2 - 1);
    }
  }
  crackleCache.set(ctx, buffer);
  return buffer;
}

export default {
  id: 'vinyl-sim',
  name: 'Vinyl Sim',
  category: 'Character',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  latency: BASE_DELAY,
  params: [
    { id: 'tone', name: 'Tone', kind: 'range', min: 200, max: 20000, default: 7500, scale: 'log', unit: 'Hz' },
    { id: 'noise', name: 'Crackle', kind: 'range', min: 0, max: 1, default: 0.05, unit: '%' },
    { id: 'hiss', name: 'Hiss', kind: 'range', min: 0, max: 1, default: 0.05, unit: '%' },
    { id: 'wow', name: 'Wow', kind: 'range', min: 0, max: 1, default: 0.25, unit: '%' },
    { id: 'drive', name: 'Warmth', kind: 'range', min: 0, max: 1, default: 0.25, unit: '%' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 1, unit: '%' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = BASE_DELAY;
    const wowOsc = lfo(ctx, 'sine', 0.55);
    const wowDepth = ctx.createGain();
    wowOsc.connect(wowDepth).connect(delay.delayTime);
    const drift = lfo(ctx, 'sine', 0.13);
    const driftDepth = ctx.createGain();
    drift.connect(driftDepth).connect(delay.delayTime);

    const rumbleCut = ctx.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 35;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = -1;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 180;
    body.gain.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '2x';
    input.connect(delay).connect(rumbleCut).connect(body).connect(shaper).connect(tone).connect(output);

    const crackle = loopSource(ctx, crackleBuffer(ctx));
    const crackleTone = ctx.createBiquadFilter();
    crackleTone.type = 'bandpass';
    crackleTone.frequency.value = 2500;
    crackleTone.Q.value = 0.5;
    const crackleGain = ctx.createGain();
    crackle.connect(crackleTone).connect(crackleGain).connect(output);

    const hiss = loopSource(ctx, noiseBuffer(ctx));
    const hissTone = ctx.createBiquadFilter();
    hissTone.type = 'bandpass';
    hissTone.frequency.value = 5000;
    hissTone.Q.value = 0.4;
    const hissGain = ctx.createGain();
    hiss.connect(hissTone).connect(hissGain).connect(output);

    const apply = {
      tone: (v, i) => ramp(ctx, tone.frequency, v, i),
      noise: (v, i) => ramp(ctx, crackleGain.gain, v * 1.2, i),
      hiss: (v, i) => ramp(ctx, hissGain.gain, v * 0.03, i),
      wow: (v, i) => {
        ramp(ctx, wowDepth.gain, v * MAX_WOW, i);
        ramp(ctx, driftDepth.gain, v * MAX_WOW * 0.5, i);
      },
      drive: (v) => {
        shaper.curve = v > 0 ? tanhCurve(v * 0.15, 0.1) : null;
      },
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    return effectShell({
      input,
      output,
      values: { ...initial },
      apply,
      nodes: [delay, wowOsc, wowDepth, drift, driftDepth, rumbleCut, body, shaper, tone, crackle, crackleTone, crackleGain, hiss, hissTone, hissGain]
    });
  }
};
