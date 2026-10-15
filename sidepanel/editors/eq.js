import { cssVar, h, hiDpiCanvas } from '../dom.js';
import { EQ_BANDS, EQ_GAIN_RANGE } from '../../effects/equalizer.js';
import { clamp, formatValue } from '../../shared/params.js';

const MIN_HZ = 20;
const MAX_HZ = 20000;
const POINTS = 256;
const HIT_RADIUS = 14;
const Q_STEP = 1.12;
const BAND_COLORS = ['#ff8a3c', '#ffd23c', '#1fd1c1', '#5aa8ff', '#c77dff'];
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

const frequencies = new Float32Array(POINTS).map((_, i) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / (POINTS - 1)));

export function createEqEditor({ params, getValues, setParam, arm }) {
  const defs = Object.fromEntries(params.map((p) => [p.id, p]));
  const audio = new OfflineAudioContext(1, 128, 48000);
  const filters = EQ_BANDS.map((band) => {
    const f = audio.createBiquadFilter();
    f.type = band.type;
    return f;
  });
  const magnitude = new Float32Array(POINTS);
  const phase = new Float32Array(POINTS);
  const canvas = h('canvas', { className: 'eq-graph', title: 'Drag a band · scroll for Q · double-click to flatten' });
  const readout = h('div', { className: 'eq-readout' });
  let active = 2;
  let drag = null;
  let size = { w: 1, h: 1 };

  const xOf = (hz) => (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * size.w;
  const hzOf = (x) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, clamp(x / size.w, 0, 1));
  const yOf = (db) => size.h / 2 - (db / EQ_GAIN_RANGE) * (size.h / 2 - 8);
  const dbOf = (y) => ((size.h / 2 - y) / (size.h / 2 - 8)) * EQ_GAIN_RANGE;

  const response = (values) => {
    const total = new Float32Array(POINTS);
    EQ_BANDS.forEach((band, n) => {
      const f = filters[n];
      f.frequency.value = values[`${band.key}Freq`];
      f.gain.value = values[`${band.key}Gain`];
      if (band.q) f.Q.value = values[`${band.key}Q`];
      f.getFrequencyResponse(frequencies, magnitude, phase);
      for (let i = 0; i < POINTS; i++) total[i] += 20 * Math.log10(Math.max(1e-6, magnitude[i]));
    });
    return total;
  };

  const describe = (values) => {
    const band = EQ_BANDS[active];
    const parts = [band.name, formatValue(defs[`${band.key}Freq`], values[`${band.key}Freq`]), formatValue(defs[`${band.key}Gain`], values[`${band.key}Gain`])];
    if (band.q) parts.push(`Q ${values[`${band.key}Q`].toFixed(2)}`);
    readout.textContent = parts.join(' ');
    readout.style.color = BAND_COLORS[active];
  };

  const draw = (ctx, w, hgt) => {
    size = { w, h: hgt };
    const values = getValues();
    ctx.strokeStyle = cssVar('--edge', canvas);
    ctx.lineWidth = 1;
    for (const hz of GRID_HZ) {
      ctx.beginPath();
      ctx.moveTo(xOf(hz), 0);
      ctx.lineTo(xOf(hz), hgt);
      ctx.stroke();
    }
    for (const db of [-12, -6, 0, 6, 12]) {
      ctx.strokeStyle = db === 0 ? cssVar('--dim', canvas) : cssVar('--edge', canvas);
      ctx.beginPath();
      ctx.moveTo(0, yOf(db));
      ctx.lineTo(w, yOf(db));
      ctx.stroke();
    }
    ctx.fillStyle = cssVar('--dim', canvas);
    ctx.font = `10px ${cssVar('--face', canvas)}`;
    for (const hz of [100, 1000, 10000]) ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, xOf(hz) + 2, hgt - 3);

    const total = response(values);
    ctx.beginPath();
    for (let i = 0; i < POINTS; i++) {
      const x = xOf(frequencies[i]);
      const y = yOf(clamp(total[i], -EQ_GAIN_RANGE * 1.2, EQ_GAIN_RANGE * 1.2));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = cssVar('--pad', canvas);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(w, yOf(0));
    ctx.lineTo(0, yOf(0));
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = cssVar('--pad', canvas);
    ctx.fill();
    ctx.globalAlpha = 1;

    EQ_BANDS.forEach((band, n) => {
      ctx.beginPath();
      ctx.arc(xOf(values[`${band.key}Freq`]), yOf(values[`${band.key}Gain`]), n === active ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = BAND_COLORS[n];
      ctx.fill();
      if (n === active) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
    describe(values);
  };
  const redraw = hiDpiCanvas(canvas, draw);

  const bandAt = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const values = getValues();
    let best = -1;
    let bestDistance = HIT_RADIUS;
    EQ_BANDS.forEach((band, n) => {
      const d = Math.hypot(xOf(values[`${band.key}Freq`]) - x, yOf(values[`${band.key}Gain`]) - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = n;
      }
    });
    return { band: best, x, y };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const hit = bandAt(e);
    if (hit.band < 0) return;
    active = hit.band;
    arm(`${EQ_BANDS[active].key}Gain`, canvas);
    canvas.setPointerCapture(e.pointerId);
    drag = true;
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const band = EQ_BANDS[active];
    setParam(`${band.key}Freq`, clamp(hzOf(e.clientX - rect.left), band.min, band.max));
    setParam(`${band.key}Gain`, clamp(dbOf(e.clientY - rect.top), -EQ_GAIN_RANGE, EQ_GAIN_RANGE));
  });
  const end = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', (e) => {
    const hit = bandAt(e);
    if (hit.band >= 0) setParam(`${EQ_BANDS[hit.band].key}Gain`, 0);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      const hit = bandAt(e);
      if (hit.band >= 0) active = hit.band;
      const band = EQ_BANDS[active];
      if (!band.q) return;
      e.preventDefault();
      const id = `${band.key}Q`;
      const q = getValues()[id] * (e.deltaY < 0 ? Q_STEP : 1 / Q_STEP);
      setParam(id, clamp(q, defs[id].min, defs[id].max));
    },
    { passive: false }
  );

  const handles = EQ_BANDS.flatMap((band) => [`${band.key}Gain`, `${band.key}Freq`, ...(band.q ? [`${band.key}Q`] : [])]);

  return {
    el: h('div', { className: 'eq-editor' }, canvas, readout),
    handles,
    update: () => redraw()
  };
}
