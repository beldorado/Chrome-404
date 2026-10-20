import { CHORDS, NOTE_NAMES, curve, dbToGain, disconnectAll, effectShell, loopSource, midiToHz, workletEffect, noiseBuffer, ramp } from './lib.js';

const INPUT = ['input'];
const VOCODER_BANDS = 16;
const VOCODER_LOW = 120;
const VOCODER_HIGH = 7000;
const VOCODER_Q = 6;
const VOCODER_SENSITIVITY = 15;
const AMP_SATURATION = 2.5;
const AMP_MAX_GAIN_DB = 30;

export const autoPitch = {
  id: 'auto-pitch',
  name: 'Auto Pitch',
  short: 'A.Pitch',
  category: 'Input',
  buses: INPUT,
  worklet: 'worklets/autopitch.js',
  params: [
    { id: 'key', name: 'Key', kind: 'enum', options: NOTE_NAMES, default: 'C' },
    { id: 'scale', name: 'Scale', kind: 'enum', options: ['Chromatic', 'Major', 'Minor', 'Pentatonic'], default: 'Minor' },
    { id: 'amount', name: 'Amount', kind: 'range', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'speed', name: 'Glide', kind: 'range', min: 0, max: 1, default: 0.05, unit: '%' },
    { id: 'shift', name: 'Shift', kind: 'range', min: -12, max: 12, default: 0, unit: 'st' }
  ],
  create: workletEffect('chrome404-autopitch')
};

export const vocoder = {
  id: 'vocoder',
  name: 'Vocoder',
  category: 'Input',
  buses: INPUT,
  params: [
    { id: 'note', name: 'Note', kind: 'range', min: 36, max: 72, default: 48, unit: 'note' },
    { id: 'chord', name: 'Chord', kind: 'enum', options: Object.keys(CHORDS), default: 'Minor' },
    { id: 'formant', name: 'Formant', kind: 'range', min: -12, max: 12, default: 0, unit: 'st' },
    { id: 'release', name: 'Speed', kind: 'range', min: 5, max: 60, default: 25, scale: 'log', unit: 'Hz' },
    { id: 'noise', name: 'Air', kind: 'range', min: 0, max: 1, default: 0.15, unit: '%' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 2, default: 1, unit: '%' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const carrier = ctx.createGain();
    const rectify = curve(1025, (x) => Math.abs(x));
    const noise = loopSource(ctx, noiseBuffer(ctx));
    const noiseGain = ctx.createGain();
    noise.connect(noiseGain).connect(carrier);
    const values = { ...initial };
    let oscillators = [];

    const bands = Array.from({ length: VOCODER_BANDS }, (_, b) => {
      const frequency = VOCODER_LOW * Math.pow(VOCODER_HIGH / VOCODER_LOW, b / (VOCODER_BANDS - 1));
      const analysis = ctx.createBiquadFilter();
      analysis.type = 'bandpass';
      analysis.frequency.value = frequency;
      analysis.Q.value = VOCODER_Q;
      const rectifier = ctx.createWaveShaper();
      rectifier.curve = rectify;
      const envelope = ctx.createBiquadFilter();
      envelope.type = 'lowpass';
      const sensitivity = ctx.createGain();
      sensitivity.gain.value = VOCODER_SENSITIVITY;
      const synthesis = ctx.createBiquadFilter();
      synthesis.type = 'bandpass';
      synthesis.Q.value = VOCODER_Q;
      const vca = ctx.createGain();
      vca.gain.value = 0;
      input.connect(analysis).connect(rectifier).connect(envelope).connect(sensitivity).connect(vca.gain);
      carrier.connect(synthesis).connect(vca).connect(output);
      return { frequency, nodes: [analysis, rectifier, envelope, sensitivity, synthesis, vca], envelope, synthesis };
    });

    const rebuildCarrier = () => {
      oscillators.forEach((o) => {
        o.stop();
        o.disconnect();
      });
      const intervals = CHORDS[values.chord] ?? CHORDS.Unison;
      oscillators = intervals.map((st) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToHz(Math.round(values.note) + st);
        const voice = ctx.createGain();
        voice.gain.value = 1 / Math.sqrt(intervals.length);
        osc.connect(voice).connect(carrier);
        osc.start();
        osc.voice = voice;
        return osc;
      });
    };

    const apply = {
      note: rebuildCarrier,
      chord: rebuildCarrier,
      formant: (v, i) => bands.forEach((b) => ramp(ctx, b.synthesis.frequency, b.frequency * Math.pow(2, v / 12), i)),
      release: (v, i) => bands.forEach((b) => ramp(ctx, b.envelope.frequency, v, i)),
      noise: (v, i) => ramp(ctx, noiseGain.gain, v * 0.5, i),
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    const shell = effectShell({ input, output, values, apply, nodes: [carrier, noise, noiseGain, ...bands.flatMap((b) => b.nodes)] });
    return {
      ...shell,
      dispose() {
        oscillators.forEach((o) => disconnectAll(o, o.voice));
        shell.dispose();
      }
    };
  }
};

export const ampSim = {
  id: 'amp-sim',
  name: 'Amp Sim',
  short: 'Amp',
  category: 'Input',
  buses: INPUT,
  params: [
    { id: 'gain', name: 'Gain', kind: 'range', min: 0, max: 1, default: 0.5, unit: '%' },
    { id: 'bass', name: 'Bass', kind: 'range', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'mid', name: 'Mid', kind: 'range', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'treble', name: 'Treble', kind: 'range', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 0.5, unit: '%' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const pre = ctx.createGain();
    const make = (type, frequency, extra = {}) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      if (extra.Q !== undefined) f.Q.value = extra.Q;
      if (extra.gain !== undefined) f.gain.value = extra.gain;
      return f;
    };
    const tight = make('highpass', 80);
    const bass = make('lowshelf', 150);
    const mid = make('peaking', 700, { Q: 0.8 });
    const treble = make('highshelf', 2500);
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve(2048, (x) => Math.tanh(AMP_SATURATION * (x + 0.15 * x * x)) / Math.tanh(AMP_SATURATION));
    shaper.oversample = '4x';
    const cabLow = make('highpass', 90);
    const cabPeak = make('peaking', 1600, { Q: 1.2, gain: 4 });
    const cabTop1 = make('lowpass', 5000, { Q: -3 });
    const cabTop2 = make('lowpass', 5000, { Q: -3 });
    input.connect(pre).connect(tight).connect(bass).connect(mid).connect(treble).connect(shaper);
    shaper.connect(cabLow).connect(cabPeak).connect(cabTop1).connect(cabTop2).connect(output);

    const apply = {
      gain: (v, i) => ramp(ctx, pre.gain, dbToGain(v * AMP_MAX_GAIN_DB), i),
      bass: (v, i) => ramp(ctx, bass.gain, v, i),
      mid: (v, i) => ramp(ctx, mid.gain, v, i),
      treble: (v, i) => ramp(ctx, treble.gain, v, i),
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    return effectShell({
      input,
      output,
      values: { ...initial },
      apply,
      nodes: [pre, tight, bass, mid, treble, shaper, cabLow, cabPeak, cabTop1, cabTop2]
    });
  }
};
