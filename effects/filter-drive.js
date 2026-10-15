const FILTER_TYPES = { LPF: 'lowpass', HPF: 'highpass', BPF: 'bandpass' };
const SMOOTHING = 0.015;
const CURVE_SIZE = 2048;
const DRIVE_MAKEUP = 1.5;

function driveCurve(amount) {
  if (amount <= 0) return null;
  const k = 1 + amount * 40;
  const norm = Math.tanh(k);
  const curve = new Float32Array(CURVE_SIZE);
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

function resonanceToQ(type, amount) {
  return type === 'BPF' ? 0.5 * Math.pow(40, amount) : -3 + amount * 27;
}

export default {
  id: 'filter-drive',
  name: 'Filter + Drive',
  category: 'Filter',
  buses: ['bus1', 'bus2', 'bus3', 'bus4', 'master', 'input'],
  params: [
    { id: 'type', name: 'Type', kind: 'enum', options: ['LPF', 'HPF', 'BPF'], default: 'LPF' },
    { id: 'cutoff', name: 'Cutoff', kind: 'range', min: 20, max: 20000, default: 1200, scale: 'log', unit: 'Hz' },
    { id: 'resonance', name: 'Reso', kind: 'range', min: 0, max: 1, default: 0.2, unit: '%' },
    { id: 'drive', name: 'Drive', kind: 'range', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'level', name: 'Level', kind: 'range', min: 0, max: 1.5, default: 1, unit: '%' }
  ],

  create(ctx, initial) {
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const makeup = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const output = ctx.createGain();
    shaper.oversample = '2x';
    input.connect(shaper).connect(makeup).connect(filter).connect(output);

    const values = { ...initial };
    const ramp = (audioParam, value, immediate) => {
      if (immediate) audioParam.value = value;
      else audioParam.setTargetAtTime(value, ctx.currentTime, SMOOTHING);
    };

    const apply = {
      type(value, immediate) {
        filter.type = FILTER_TYPES[value] ?? 'lowpass';
        ramp(filter.Q, resonanceToQ(value, values.resonance), immediate);
      },
      cutoff(value, immediate) {
        ramp(filter.frequency, value, immediate);
      },
      resonance(value, immediate) {
        ramp(filter.Q, resonanceToQ(values.type, value), immediate);
      },
      drive(value, immediate) {
        shaper.curve = driveCurve(value);
        ramp(makeup.gain, 1 / (1 + value * DRIVE_MAKEUP), immediate);
      },
      level(value, immediate) {
        ramp(output.gain, value, immediate);
      }
    };

    for (const [id, value] of Object.entries(values)) apply[id]?.(value, true);

    return {
      input,
      output,
      setParam(id, value) {
        values[id] = value;
        apply[id]?.(value, false);
      },
      dispose() {
        input.disconnect();
        shaper.disconnect();
        makeup.disconnect();
        filter.disconnect();
        output.disconnect();
      }
    };
  }
};
