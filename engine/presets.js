export const PRESETS = {
  init: {
    name: 'Init (all off)',
    buses: {}
  },
  filterSmoke: {
    name: 'Filter smoke test',
    buses: {
      bus1: { effect: 'filter-drive', enabled: true, params: { type: 'LPF', cutoff: 600, resonance: 0.35 } }
    }
  },
  classic: {
    name: 'Classic 404 chain',
    buses: {
      bus1: { effect: 'lofi', enabled: true },
      bus3: { effect: 'vinyl-sim', enabled: true },
      bus4: { effect: 'compressor', enabled: true }
    }
  }
};
