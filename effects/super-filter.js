import { DIVISIONS, SYNC_OPTIONS, beatsToSeconds, disconnectAll, lfo, ramp } from './lib.js';

const TYPES = { LPF: 'lowpass', HPF: 'highpass', BPF: 'bandpass' };
const SLOPES = { '12dB': 1, '24dB': 2, '36dB': 3, '48dB': 4 };
const STAGE_Q_DB = -3.0103;
const CENTS_PER_DEPTH = 3600;

function resonanceQ(type, amount) {
  return type === 'BPF' ? 0.5 * Math.pow(40, amount) : -3 + amount * 24;
}

export default {
  id: 'super-filter',
  name: 'Super Filter',
  short: 'S.Filter',
  category: 'Filter',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master'],
  params: [
    { id: 'type', name: 'Type', kind: 'enum', options: ['LPF', 'HPF', 'BPF'], default: 'LPF' },
    { id: 'slope', name: 'Slope', kind: 'enum', options: Object.keys(SLOPES), default: '24dB' },
    { id: 'cutoff', name: 'Cutoff', kind: 'range', min: 20, max: 20000, default: 2000, scale: 'log', unit: 'Hz' },
    { id: 'resonance', name: 'Reso', kind: 'range', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'lfoDepth', name: 'Cycle', kind: 'range', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'lfoSync', name: 'Sync', kind: 'enum', options: ['Free', ...SYNC_OPTIONS], default: '1 bar' },
    { id: 'lfoRate', name: 'Rate', kind: 'range', min: 0.05, max: 10, default: 0.5, scale: 'log', unit: 'Hz' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 1, unit: '%' }
  ],

  create(ctx, initial, { bpm = 90 } = {}) {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const mod = lfo(ctx, 'triangle', 1);
    const modDepth = ctx.createGain();
    mod.connect(modDepth);
    const values = { ...initial };
    let tempo = bpm;
    let stages = [];

    const rebuild = () => {
      input.disconnect();
      modDepth.disconnect();
      stages.forEach((f) => f.disconnect());
      stages = Array.from({ length: SLOPES[values.slope] ?? 2 }, () => ctx.createBiquadFilter());
      let node = input;
      stages.forEach((f, i) => {
        f.type = TYPES[values.type] ?? 'lowpass';
        f.frequency.value = values.cutoff;
        const last = i === stages.length - 1;
        f.Q.value = last ? resonanceQ(values.type, values.resonance) : values.type === 'BPF' ? 0.7 : STAGE_Q_DB;
        modDepth.connect(f.detune);
        node.connect(f);
        node = f;
      });
      node.connect(output);
    };

    const updateRate = (immediate) => {
      const beats = DIVISIONS[values.lfoSync];
      const rate = beats ? 1 / beatsToSeconds(beats, tempo) : values.lfoRate;
      ramp(ctx, mod.frequency, rate, immediate);
    };

    const apply = {
      type: rebuild,
      slope: rebuild,
      cutoff: (v, i) => stages.forEach((f) => ramp(ctx, f.frequency, v, i)),
      resonance: (v, i) => ramp(ctx, stages[stages.length - 1].Q, resonanceQ(values.type, v), i),
      lfoDepth: (v, i) => ramp(ctx, modDepth.gain, v * CENTS_PER_DEPTH, i),
      lfoSync: (_, i) => updateRate(i),
      lfoRate: (_, i) => updateRate(i),
      level: (v, i) => ramp(ctx, output.gain, v, i)
    };

    rebuild();
    apply.lfoDepth(values.lfoDepth, true);
    apply.level(values.level, true);
    updateRate(true);

    return {
      input,
      output,
      setParam(id, value) {
        values[id] = value;
        apply[id]?.(value, false);
      },
      setTempo(next) {
        tempo = next;
        updateRate(false);
      },
      dispose() {
        disconnectAll(input, output, mod, modDepth, ...stages);
      }
    };
  }
};
