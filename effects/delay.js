import { beatsToSeconds, divisionBeats, effectShell, ramp, syncRange } from './lib.js';

const MAX_DELAY = 6;

export default {
  id: 'delay',
  name: 'Delay',
  category: 'Space',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  tempoSync: true,
  defaultMix: 0.35,
  params: [
    { id: 'time', name: 'Time', kind: 'enum', options: syncRange('1/32', '1 bar'), default: '1/8D' },
    { id: 'feedback', name: 'Feedback', kind: 'range', min: 0, max: 0.95, default: 0.4, unit: '%' },
    { id: 'tone', name: 'Tone', kind: 'range', min: 200, max: 20000, default: 6000, scale: 'log', unit: 'Hz' }
  ],

  create(ctx, initial, { bpm = 90 } = {}) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(MAX_DELAY);
    const tone = ctx.createBiquadFilter();
    const feedback = ctx.createGain();
    tone.type = 'lowpass';
    input.connect(delay).connect(tone).connect(output);
    tone.connect(feedback).connect(delay);

    const values = { ...initial };
    let tempo = bpm;
    const setTime = (immediate) => ramp(ctx, delay.delayTime, Math.min(MAX_DELAY, beatsToSeconds(divisionBeats(values.time, 0.75), tempo)), immediate);

    const apply = {
      time: (_, i) => setTime(i),
      feedback: (v, i) => ramp(ctx, feedback.gain, v, i),
      tone: (v, i) => ramp(ctx, tone.frequency, v, i)
    };

    return effectShell({
      input,
      output,
      values,
      apply,
      nodes: [delay, tone, feedback],
      onTempo(next) {
        tempo = next;
        setTime(false);
      }
    });
  }
};
