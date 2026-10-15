export const BUS_IDS = ['bus1', 'bus2', 'bus3', 'bus4', 'input', 'master'];

export const BUS_LABELS = {
  bus1: 'Bus 1',
  bus2: 'Bus 2',
  bus3: 'Bus 3',
  bus4: 'Bus 4',
  input: 'Input FX',
  master: 'Master FX'
};

export const ROUTES = ['bus1', 'bus2', 'dry'];

export const ROUTE_LABELS = {
  bus1: 'Bus 1',
  bus2: 'Bus 2',
  dry: 'Dry → Bus 3'
};

export const DEFAULT_MASTER = 0.9;

export const MAX_SLOTS = 8;

export function defaultBus() {
  return { slots: [] };
}

export function defaultState() {
  return {
    bpm: 90,
    autoBpm: false,
    detected: null,
    master: DEFAULT_MASTER,
    inputRoute: 'bus1',
    buses: Object.fromEntries(BUS_IDS.map((id) => [id, defaultBus()])),
    sources: []
  };
}

export function settingsFrom({ bpm, autoBpm, master, inputRoute, buses }) {
  return { bpm, autoBpm, master, inputRoute, buses };
}
