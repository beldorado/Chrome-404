import { DEFAULT_QUANTIZE } from './grid.js';

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

export const SOURCE_LEVEL_MAX = 1.5;

export const DECK_SIDES = ['A', 'B'];

export const BANKS = ['A', 'B'];

export const PADS_PER_BANK = 12;

export const LEGACY_PADS_PER_BANK = 8;

export const PAD_COUNT = BANKS.length * PADS_PER_BANK;

export function padLabel(index) {
  return `${BANKS[Math.floor(index / PADS_PER_BANK)]}${(index % PADS_PER_BANK) + 1}`;
}

export function migratePadIndex(index, fromPerBank) {
  const slot = index % fromPerBank;
  const to = Math.floor(index / fromPerBank) * PADS_PER_BANK + slot;
  return slot < PADS_PER_BANK && to < PAD_COUNT ? to : -1;
}

export const PAD_MODES = ['Loop', 'Gate', 'One-shot'];

export const REC_LENGTHS = ['1 bar', '2 bars', '4 bars', 'Free'];

export const CHOKE_GROUPS = [0, 1, 2, 3, 4];

export const BUS_ROUTINGS = ['Parallel', 'Series'];

export const PAD_TRANSFERS = ['move', 'copy', 'swap'];

export const STRETCH_MODES = ['Vinyl', 'Stretch'];

export const SPEED_MIN = 0.5;

export const SPEED_MAX = 2;

export const PITCH_RANGE = 12;

export const PAD_NAME_MAX = 40;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function takeName(date = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function padRate(pad, bpm) {
  const follow = pad.sync && pad.clip?.bpm ? bpm / pad.clip.bpm : 1;
  return follow * (pad.speed ?? 1);
}

export function padPitch(pad) {
  return pad.stretch === 'Stretch' ? Math.pow(2, (pad.pitch ?? 0) / 12) : 1;
}

export function defaultBus() {
  return { engaged: true, slots: [] };
}

export function defaultPad() {
  return { mode: 'Loop', level: 1, sync: true, choke: 0, speed: 1, pitch: 0, stretch: 'Vinyl', clip: null, playing: false };
}

export function defaultState() {
  return {
    bpm: 90,
    autoBpm: false,
    detected: null,
    quantize: DEFAULT_QUANTIZE,
    master: DEFAULT_MASTER,
    inputRoute: 'bus1',
    padRoute: 'dry',
    busRouting: 'Parallel',
    crossfader: 0,
    buses: Object.fromEntries(BUS_IDS.map((id) => [id, defaultBus()])),
    memory: Object.fromEntries(BUS_IDS.map((id) => [id, {}])),
    pads: Array.from({ length: PAD_COUNT }, defaultPad),
    recording: null,
    latency: 0,
    sources: []
  };
}

export function presetFrom({ buses, busRouting }, name) {
  return {
    name,
    busRouting,
    engaged: Object.fromEntries(BUS_IDS.map((id) => [id, buses[id].engaged])),
    buses: Object.fromEntries(
      BUS_IDS.filter((id) => buses[id].slots.length).map((id) => [id, buses[id].slots.map(({ effect, enabled, params, lfo }) => ({ effect, enabled, params: { ...params }, lfo: { ...lfo } }))])
    )
  };
}

export function settingsFrom({ bpm, autoBpm, quantize, master, inputRoute, padRoute, busRouting, crossfader, buses, memory, pads }) {
  return {
    bpm,
    autoBpm,
    quantize,
    master,
    inputRoute,
    padRoute,
    busRouting,
    crossfader,
    buses,
    memory,
    padsPerBank: PADS_PER_BANK,
    pads: pads.map(({ mode, level, sync, choke, speed, pitch, stretch }) => ({ mode, level, sync, choke, speed, pitch, stretch }))
  };
}
