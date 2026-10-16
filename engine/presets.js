export const PRESETS = {
  init: {
    name: 'Init (all off)',
    buses: {}
  },
  filterSmoke: {
    name: 'Filter smoke test',
    buses: {
      bus1: [{ effect: 'filter-drive', params: { type: 'LPF', cutoff: 600, resonance: 0.35 } }]
    }
  },
  classic: {
    name: 'Classic 404 chain',
    buses: {
      bus4: [{ effect: 'lofi' }, { effect: 'vinyl-sim' }, { effect: 'compressor' }],
      master: [{ effect: 'limiter' }]
    }
  },
  glitchKit: {
    name: 'Glitch kit (hold 1, 2, 3)',
    buses: {
      bus1: [{ effect: 'looper', params: { length: '1/8' } }],
      bus2: [{ effect: 'stopper', params: { division: '1/2', length: 0.5 } }],
      bus3: [{ effect: 'scatter', params: { type: '3', depth: 0.9 } }],
      bus4: [{ effect: 'lofi' }, { effect: 'vinyl-sim' }],
      master: [{ effect: 'limiter' }]
    },
    engaged: { bus1: false, bus2: false, bus3: false }
  }
};
