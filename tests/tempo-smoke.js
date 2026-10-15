import { estimateTempo } from '../shared/bpm.js';
import { AudioEngine } from '../engine/engine.js';
import { BOOM_BAP, FOUR_ON_FLOOR, RATE, drumLoop, rng } from './signals.js';

const FRAME_RATE = RATE / 512;

function pulseTrain(bpm, seconds, offbeat = 0.4) {
  const random = rng(7);
  const frames = Math.round(seconds * FRAME_RATE);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = random() * 0.05;
  const beatFrames = (60 / bpm) * FRAME_RATE;
  for (let b = 0; b * beatFrames < frames; b++) {
    out[Math.round(b * beatFrames)] += 1;
    const off = Math.round((b + 0.5) * beatFrames);
    if (off < frames) out[off] += offbeat;
  }
  return out;
}

async function detectFromAudio(bpm, pattern, { seconds = 14, silent = false } = {}) {
  const ctx = new OfflineAudioContext(2, seconds * RATE, RATE);
  const engine = new AudioEngine(ctx);
  await engine.startTempoDetection();
  engine.setAutoBpm(true);
  const source = ctx.createBufferSource();
  source.buffer = silent ? ctx.createBuffer(2, seconds * RATE, RATE) : drumLoop(ctx, bpm, seconds, pattern);
  engine.addSource(source, { id: 'loop', kind: 'test', label: 'loop' });
  source.start();
  await ctx.startRendering();
  await new Promise((r) => setTimeout(r, 400));
  return engine.state;
}

const matches = (found, target, tolerance) =>
  [target, target / 2, target * 2].some((t) => Math.abs(found - t) <= tolerance);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}

async function run() {
  for (const bpm of [72, 85, 90, 97, 110, 120, 128, 140, 155, 174]) {
    const est = estimateTempo(pulseTrain(bpm, 11), FRAME_RATE);
    const exact = est && Math.abs(est.bpm - bpm) <= 0.6;
    const octave = est && matches(est.bpm, bpm, 0.6);
    check(`Estimator: ${bpm} BPM pulse train`, bpm <= 160 ? exact : octave, est ? `${est.bpm.toFixed(2)} BPM, confidence ${est.confidence.toFixed(2)}` : 'no estimate');
  }

  check('Estimator: flat signal gives no estimate', estimateTempo(new Float32Array(1000), FRAME_RATE) === null, 'null expected');

  for (const [bpm, pattern, label] of [
    [97, BOOM_BAP, 'boom-bap'],
    [90, BOOM_BAP, 'boom-bap'],
    [124, FOUR_ON_FLOOR, 'four-on-the-floor'],
    [140, FOUR_ON_FLOOR, 'four-on-the-floor']
  ]) {
    const state = await detectFromAudio(bpm, pattern);
    const found = state.detected?.bpm;
    check(
      `Engine: ${bpm} BPM ${label} loop detected + AUTO follows`,
      found !== undefined && Math.abs(found - bpm) <= 1 && Math.abs(state.bpm - bpm) <= 1,
      state.detected ? `detected ${found} (conf ${state.detected.confidence}), engine bpm ${state.bpm}` : 'no estimate'
    );
  }

  const silent = await detectFromAudio(120, FOUR_ON_FLOOR, { silent: true });
  check('Engine: silence leaves tempo alone', silent.detected === null && silent.bpm === 90, `detected ${JSON.stringify(silent.detected)}, bpm ${silent.bpm}`);
}

run()
  .catch((err) => check('Harness crashed', false, err.stack))
  .finally(() => {
    const passed = results.filter((r) => r.pass).length;
    const lines = results.map((r) => `<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>  ${r.name}  —  ${r.detail}`);
    document.getElementById('out').innerHTML = [...lines, '', `${passed}/${results.length} passed`].join('\n');
    window.__smoke = { passed, total: results.length, results };
  });
