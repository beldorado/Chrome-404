import { syncRange, workletEffect } from './lib.js';

const MAIN = ['bus1', 'bus2', 'bus3', 'bus4', 'master'];
const TYPES = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const scatter = {
  id: 'scatter',
  name: 'Scatter',
  category: 'Glitch',
  buses: MAIN,
  tempoSync: true,
  worklet: 'worklets/scatter.js',
  params: [
    { id: 'type', name: 'Type', kind: 'enum', options: TYPES, default: '1' },
    { id: 'depth', name: 'Depth', kind: 'range', min: 0, max: 1, default: 0.8, unit: '%' }
  ],
  create: workletEffect('chrome404-scatter')
};

export const stopper = {
  id: 'stopper',
  name: 'Stopper',
  category: 'Glitch',
  buses: MAIN,
  tempoSync: true,
  worklet: 'worklets/varispeed.js',
  params: [
    { id: 'division', name: 'Every', kind: 'enum', options: syncRange('1/8', '4 bars'), default: '1 bar' },
    { id: 'length', name: 'Stop', kind: 'range', min: 0.05, max: 1, default: 0.25, unit: '%' }
  ],
  create: workletEffect('chrome404-varispeed', { mode: 'stop', depth: 0 })
};

export const downer = {
  id: 'downer',
  name: 'Downer',
  category: 'Glitch',
  buses: MAIN,
  tempoSync: true,
  worklet: 'worklets/varispeed.js',
  params: [
    { id: 'division', name: 'Every', kind: 'enum', options: syncRange('1/4', '4 bars'), default: '2 bars' },
    { id: 'depth', name: 'Drop', kind: 'range', min: 1, max: 24, default: 12, unit: 'st' },
    { id: 'length', name: 'Glide', kind: 'range', min: 0.05, max: 1, default: 0.5, unit: '%' }
  ],
  create: workletEffect('chrome404-varispeed', { mode: 'down' })
};

export const looper = {
  id: 'looper',
  name: 'DJ Looper',
  short: 'Looper',
  category: 'Glitch',
  buses: MAIN,
  tempoSync: true,
  worklet: 'worklets/looper.js',
  params: [
    { id: 'length', name: 'Length', kind: 'enum', options: syncRange('1/32', '2 bars'), default: '1/4' },
    { id: 'speed', name: 'Speed', kind: 'range', min: 0.25, max: 2, default: 1, scale: 'log', unit: '×' },
    { id: 'reverse', name: 'Reverse', kind: 'enum', options: ['Off', 'On'], default: 'Off' }
  ],
  create: workletEffect('chrome404-looper')
};

export const slicer = {
  id: 'slicer',
  name: 'Slicer',
  category: 'Glitch',
  buses: MAIN,
  tempoSync: true,
  worklet: 'worklets/slicer.js',
  params: [
    { id: 'pattern', name: 'Pattern', kind: 'enum', options: TYPES, default: '1' },
    { id: 'division', name: 'Step', kind: 'enum', options: syncRange('1/32', '1/8'), default: '1/16' },
    { id: 'depth', name: 'Depth', kind: 'range', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'shape', name: 'Shape', kind: 'range', min: 0.5, max: 40, default: 3, scale: 'log', unit: 'ms' }
  ],
  create: workletEffect('chrome404-slicer')
};
