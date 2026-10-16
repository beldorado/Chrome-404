import filterDrive from './filter-drive.js';
import isolator from './isolator.js';
import superFilter from './super-filter.js';
import equalizer from './equalizer.js';
import vinylSim from './vinyl-sim.js';
import cassetteSim from './cassette-sim.js';
import lofi from './lofi.js';
import bitCrusher from './bit-crusher.js';
import compressor from './compressor.js';
import limiter from './limiter.js';
import delay from './delay.js';
import tapeEcho from './tape-echo.js';
import reverb from './reverb.js';
import chorus from './chorus.js';
import flanger from './flanger.js';
import phaser from './phaser.js';
import { downer, looper, scatter, slicer, stopper } from './glitch.js';
import { grainCloud, resonator } from './granular.js';
import { ampSim, autoPitch, vocoder } from './input-fx.js';
import { CATEGORIES, PLANNED } from './catalog.js';

export const MIX_PARAM = 'mix';

function withMix(effect) {
  const mix = { id: MIX_PARAM, name: 'Mix', kind: 'range', min: 0, max: 1, default: effect.defaultMix ?? 1, unit: '%' };
  return { ...effect, params: [...effect.params, mix] };
}

const IMPLEMENTED = [
  filterDrive,
  isolator,
  superFilter,
  equalizer,
  vinylSim,
  cassetteSim,
  lofi,
  bitCrusher,
  compressor,
  limiter,
  delay,
  tapeEcho,
  reverb,
  chorus,
  flanger,
  phaser,
  scatter,
  stopper,
  looper,
  slicer,
  downer,
  grainCloud,
  resonator,
  autoPitch,
  vocoder,
  ampSim
].map(withMix);

const EFFECTS = new Map(IMPLEMENTED.map((effect) => [effect.id, effect]));

export const CTRL_COUNT = 3;

const CTRL = {
  'filter-drive': ['cutoff', 'resonance', 'drive'],
  isolator: ['low', 'mid', 'high'],
  'super-filter': ['cutoff', 'resonance', 'lfoDepth'],
  equalizer: ['lowGain', 'midGain', 'highGain'],
  'vinyl-sim': ['noise', 'wow', 'tone'],
  'cassette-sim': ['tone', 'wow', 'hiss'],
  lofi: ['rate', 'bits', 'tone'],
  'bit-crusher': ['bits', 'rate', 'mix'],
  compressor: ['threshold', 'ratio', 'makeup'],
  limiter: ['gain', 'ceiling', 'release'],
  delay: ['time', 'feedback', 'mix'],
  'tape-echo': ['time', 'feedback', 'mix'],
  reverb: ['time', 'tone', 'mix'],
  chorus: ['rate', 'depth', 'mix'],
  flanger: ['rate', 'depth', 'feedback'],
  phaser: ['rate', 'depth', 'resonance'],
  scatter: ['type', 'depth', 'mix'],
  stopper: ['division', 'length', 'mix'],
  looper: ['length', 'speed', 'reverse'],
  slicer: ['pattern', 'division', 'depth'],
  downer: ['division', 'depth', 'length'],
  'grain-cloud': ['size', 'density', 'pitch'],
  resonator: ['note', 'chord', 'decay'],
  'auto-pitch': ['key', 'scale', 'amount'],
  vocoder: ['note', 'chord', 'formant'],
  'amp-sim': ['gain', 'bass', 'treble']
};

const QUANTIZED = new Set(['scatter', 'stopper', 'looper', 'slicer', 'downer']);

export function ctrlParams(id) {
  const effect = EFFECTS.get(id);
  if (!effect) return [];
  const byId = new Map(effect.params.map((p) => [p.id, p]));
  const picked = (CTRL[id] ?? []).map((pid) => byId.get(pid)).filter(Boolean);
  for (const p of effect.params) {
    if (picked.length >= CTRL_COUNT) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

export function isQuantized(id) {
  return QUANTIZED.has(id);
}

export function allEffects() {
  return IMPLEMENTED;
}

export function getEffect(id) {
  return EFFECTS.get(id) ?? null;
}

export function isAvailable(id, busId) {
  const effect = EFFECTS.get(id);
  return Boolean(effect && effect.buses.includes(busId));
}

export function defaultParams(id) {
  const effect = EFFECTS.get(id);
  return effect ? Object.fromEntries(effect.params.map((p) => [p.id, p.default])) : {};
}

export function createEffect(ctx, id, params, context = {}) {
  const effect = EFFECTS.get(id);
  if (!effect) throw new Error(`Unknown effect: ${id}`);
  const instance = effect.create(ctx, { ...defaultParams(id), ...params }, context);
  instance.latency = effect.latency ?? 0;
  return instance;
}

export function listEffects(busId) {
  const implemented = IMPLEMENTED.map(({ id, name, category, buses, tempoSync }) => ({ id, name, category, buses, tempoSync, available: true }));
  const planned = PLANNED.filter((p) => !EFFECTS.has(p.id)).map((p) => ({ ...p, available: false }));
  return [...implemented, ...planned]
    .filter((e) => e.buses.includes(busId))
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
}

export async function loadWorklets(ctx) {
  const urls = new Set(IMPLEMENTED.filter((e) => e.worklet).map((e) => new URL(e.worklet, import.meta.url).href));
  for (const url of urls) await ctx.audioWorklet.addModule(url);
}
