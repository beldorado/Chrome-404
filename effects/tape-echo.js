import { beatsToSeconds, divisionBeats, effectShell, lfo, ramp, syncRange, tanhCurve } from './lib.js';

const MAX_DELAY = 6;
const MAX_WOW = 0.004;

export default {
  id: 'tape-echo',
  name: 'Tape Echo',
  short: 'T.Echo',
  category: 'Space',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  tempoSync: true,
  defaultMix: 0.4,
  params: [
    { id: 'time', name: 'Time', kind: 'enum', options: syncRange('1/32', '1 bar'), default: '1/4' },
    { id: 'feedback', name: 'Repeat', kind: 'range', min: 0, max: 1.1, default: 0.5, unit: '%' },
    { id: 'wow', name: 'Wow', kind: 'range', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'tone', name: 'Tone', kind: 'range', min: 200, max: 20000, default: 3500, scale: 'log', unit: 'Hz' },
    { id: 'drive', name: 'Drive', kind: 'range', min: 0, max: 1, default: 0.3, unit: '%' }
  ],

  create(ctx, initial, { bpm = 90 } = {}) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(MAX_DELAY);
    const wowOsc = lfo(ctx, 'sine', 0.7);
    const wowDepth = ctx.createGain();
    wowOsc.connect(wowDepth).connect(delay.delayTime);
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 120;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    const saturate = ctx.createWaveShaper();
    const feedback = ctx.createGain();

    input.connect(delay).connect(lowCut).connect(tone).connect(saturate).connect(output);
    saturate.connect(feedback).connect(delay);

    const values = { ...initial };
    let tempo = bpm;
    const setTime = (immediate) => ramp(ctx, delay.delayTime, Math.min(MAX_DELAY, beatsToSeconds(divisionBeats(values.time), tempo)), immediate);

    const apply = {
      time: (_, i) => setTime(i),
      feedback: (v, i) => ramp(ctx, feedback.gain, v, i),
      wow: (v, i) => ramp(ctx, wowDepth.gain, v * MAX_WOW, i),
      tone: (v, i) => ramp(ctx, tone.frequency, v, i),
      drive: (v) => {
        saturate.curve = tanhCurve(0.02 + v * 0.3);
      }
    };

    return effectShell({
      input,
      output,
      values,
      apply,
      nodes: [delay, wowOsc, wowDepth, lowCut, tone, saturate, feedback],
      onTempo(next) {
        tempo = next;
        setTime(false);
      }
    });
  }
};
