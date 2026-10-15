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
  }
};
