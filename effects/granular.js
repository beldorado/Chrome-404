import { CHORDS, workletEffect } from './lib.js';

const MAIN = ['bus1', 'bus2', 'bus3', 'bus4', 'master'];

export const grainCloud = {
  id: 'grain-cloud',
  name: 'Grain Cloud',
  short: 'Grains',
  category: 'Granular',
  buses: MAIN,
  defaultMix: 0.5,
  worklet: 'worklets/grains.js',
  params: [
    { id: 'size', name: 'Size', kind: 'range', min: 0.02, max: 0.5, default: 0.12, scale: 'log', unit: 's' },
    { id: 'density', name: 'Density', kind: 'range', min: 1, max: 60, default: 15, scale: 'log', unit: 'Hz' },
    { id: 'pitch', name: 'Pitch', kind: 'range', min: -12, max: 12, default: 0, unit: 'st' },
    { id: 'spread', name: 'Spread', kind: 'range', min: 0, max: 1, default: 0.4, unit: '%' },
    { id: 'feedback', name: 'Feedback', kind: 'range', min: 0, max: 0.9, default: 0.2, unit: '%' },
    { id: 'freeze', name: 'Freeze', kind: 'enum', options: ['Off', 'On'], default: 'Off' }
  ],
  create: workletEffect('chrome404-grains')
};

export const resonator = {
  id: 'resonator',
  name: 'Resonator',
  short: 'Reson',
  category: 'Granular',
  buses: MAIN,
  defaultMix: 0.5,
  worklet: 'worklets/resonator.js',
  params: [
    { id: 'note', name: 'Root', kind: 'range', min: 24, max: 72, default: 45, unit: 'note' },
    { id: 'chord', name: 'Chord', kind: 'enum', options: Object.keys(CHORDS), default: 'Minor' },
    { id: 'decay', name: 'Decay', kind: 'range', min: 0, max: 1, default: 0.6, unit: '%' },
    { id: 'damp', name: 'Damp', kind: 'range', min: 0, max: 1, default: 0.4, unit: '%' }
  ],
  create: workletEffect('chrome404-resonator')
};
