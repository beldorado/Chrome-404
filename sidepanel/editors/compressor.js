import { cssVar, h, hiDpiCanvas } from '../dom.js';
import { createKnob } from '../knob.js';
import { clamp, fromNormalized, toNormalized } from '../../shared/params.js';

const FLOOR_DB = -60;
const GR_RANGE_DB = 24;
const KNOBS = ['threshold', 'ratio', 'attack', 'release', 'knee', 'makeup'];
const DRAG_RATIO_PIXELS = 150;

export function transfer(x, threshold, ratio, knee) {
  if (knee > 0 && Math.abs(x - threshold) <= knee / 2) return x + ((1 / ratio - 1) * (x - threshold + knee / 2) ** 2) / (2 * knee);
  return x > threshold ? threshold + (x - threshold) / ratio : x;
}

export function createCompressorEditor({ params, getValues, setParam, arm }) {
  const defs = Object.fromEntries(params.map((p) => [p.id, p]));
  const canvas = h('canvas', { className: 'comp-graph', title: 'Drag left/right for threshold, up/down for ratio' });
  const grFill = h('div', { className: 'gr-fill' });
  const grText = h('output', { className: 'gr-text', textContent: '0.0' });
  const knobs = KNOBS.map((id) => createKnob({ param: defs[id], onChange: (v) => setParam(id, v), onArm: (el) => arm(id, el) }));

  const draw = (ctx, w, hgt) => {
    const { threshold, ratio, knee } = getValues();
    const toX = (db) => ((db - FLOOR_DB) / -FLOOR_DB) * w;
    const toY = (db) => hgt - ((db - FLOOR_DB) / -FLOOR_DB) * hgt;
    ctx.strokeStyle = cssVar('--edge', canvas);
    ctx.lineWidth = 1;
    for (let db = FLOOR_DB; db <= 0; db += 12) {
      ctx.beginPath();
      ctx.moveTo(toX(db), 0);
      ctx.lineTo(toX(db), hgt);
      ctx.moveTo(0, toY(db));
      ctx.lineTo(w, toY(db));
      ctx.stroke();
    }
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = cssVar('--dim', canvas);
    ctx.beginPath();
    ctx.moveTo(0, hgt);
    ctx.lineTo(w, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = cssVar('--pad', canvas);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = 0; px <= w; px++) {
      const x = FLOOR_DB + (px / w) * -FLOOR_DB;
      const y = toY(transfer(x, threshold, ratio, knee));
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.fillStyle = cssVar('--hot', canvas);
    ctx.beginPath();
    ctx.arc(toX(threshold), toY(threshold), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cssVar('--dim', canvas);
    ctx.font = `11px ${cssVar('--face', canvas)}`;
    ctx.fillText(`${threshold.toFixed(1)} dB  ${ratio.toFixed(1)}:1`, 6, 14);
  };
  const redraw = hiDpiCanvas(canvas, draw);

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    arm('threshold', canvas);
    canvas.setPointerCapture(e.pointerId);
    const { threshold, ratio } = getValues();
    drag = { x: e.clientX, y: e.clientY, threshold, ratio: toNormalized(defs.ratio, ratio), width: canvas.getBoundingClientRect().width };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const threshold = clamp(drag.threshold + ((e.clientX - drag.x) / drag.width) * -FLOOR_DB, defs.threshold.min, defs.threshold.max);
    const ratio = fromNormalized(defs.ratio, clamp(drag.ratio + (drag.y - e.clientY) / DRAG_RATIO_PIXELS, 0, 1));
    setParam('threshold', threshold);
    setParam('ratio', ratio);
  });
  const end = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => {
    setParam('threshold', defs.threshold.default);
    setParam('ratio', defs.ratio.default);
  });

  const el = h(
    'div',
    { className: 'comp-editor' },
    h('div', { className: 'comp-top' }, canvas, h('div', { className: 'gr-meter', title: 'Gain reduction' }, grFill, h('label', { textContent: 'GR' }), grText)),
    h('div', { className: 'knob-row' }, ...knobs.map((k) => k.el))
  );

  return {
    el,
    handles: KNOBS,
    update(values) {
      knobs.forEach((knob, i) => knob.setValue(values[KNOBS[i]]));
      redraw();
    },
    meter(reading) {
      const reduction = Math.min(0, reading?.reduction ?? 0);
      grFill.style.height = `${clamp(-reduction / GR_RANGE_DB, 0, 1) * 100}%`;
      grText.textContent = reduction.toFixed(1);
    }
  };
}
