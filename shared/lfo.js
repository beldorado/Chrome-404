import { SYNC_OPTIONS } from './sync.js';

export const LFO_SHAPES = ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'Random', 'S&H'];

export const LFO_PARAMS = [
  { id: 'shape', name: 'Shape', kind: 'enum', options: LFO_SHAPES, default: 'Sine' },
  { id: 'sync', name: 'Sync', kind: 'enum', options: ['Free', ...SYNC_OPTIONS], default: '1 bar' },
  { id: 'rate', name: 'Rate', kind: 'range', min: 0.02, max: 20, default: 1, scale: 'log', unit: 'Hz' },
  { id: 'depth', name: 'Depth', kind: 'range', min: 0, max: 1, default: 0.5, unit: '%' }
];

export function defaultLfo() {
  return { target: null, ...Object.fromEntries(LFO_PARAMS.map((p) => [p.id, p.default])) };
}

export function isModulatable(param) {
  return param.kind === 'range' && param.modulatable !== false;
}

export class Lfo {
  constructor(seed = 0x1f2e3d4c) {
    this.seed = seed >>> 0 || 1;
    this.phase = 0;
    this.from = this.random();
    this.to = this.random();
  }

  random() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed / 0xffffffff) * 2 - 1;
  }

  advance(seconds, cycleSeconds) {
    this.phase += seconds / Math.max(1e-3, cycleSeconds);
    while (this.phase >= 1) {
      this.phase -= 1;
      this.from = this.to;
      this.to = this.random();
    }
  }

  value(shape) {
    const p = this.phase;
    switch (shape) {
      case 'Triangle':
        return 1 - 4 * Math.abs(p - 0.5);
      case 'Saw Up':
        return 2 * p - 1;
      case 'Saw Down':
        return 1 - 2 * p;
      case 'Square':
        return p < 0.5 ? 1 : -1;
      case 'Random':
        return this.from + (this.to - this.from) * (0.5 - 0.5 * Math.cos(Math.PI * p));
      case 'S&H':
        return this.from;
      default:
        return Math.sin(2 * Math.PI * p);
    }
  }
}
