import { h } from './dom.js';
import { clamp, formatValue, fromNormalized, toNormalized } from '../shared/params.js';

const SWEEP = 135;
const RADIUS = 19;
const DRAG_PIXELS = 160;
const FINE = 0.2;
const WHEEL_STEP = 0.02;

function point(angle) {
  const rad = (angle * Math.PI) / 180;
  return `${(25 + RADIUS * Math.sin(rad)).toFixed(2)} ${(25 - RADIUS * Math.cos(rad)).toFixed(2)}`;
}

function arc(from, to) {
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${point(to)}`;
}

export function createKnob({ param, onChange, onArm }) {
  const el = h('div', { className: 'knob', title: 'Drag up/down (Shift = fine) · double-click to reset' });
  el.innerHTML = `<svg viewBox="0 0 50 50"><path class="knob-track" d="${arc(-SWEEP, SWEEP)}"/><path class="knob-value"/><circle class="knob-dot" r="3"/></svg>`;
  const valuePath = el.querySelector('.knob-value');
  const dot = el.querySelector('.knob-dot');
  const readout = h('output', { className: 'knob-readout' });
  el.append(readout, h('label', { textContent: param.name }));

  let normalized = 0;
  let current = param.default;
  let drag = null;

  const snap = (value, fine) => (param.step && !fine ? clamp(Math.round(value / param.step) * param.step, param.min, param.max) : value);

  const centre = param.bipolar ? toNormalized(param, param.default) : 0;

  const draw = (value) => {
    current = value;
    normalized = toNormalized(param, value);
    const angle = -SWEEP + normalized * SWEEP * 2;
    const from = -SWEEP + centre * SWEEP * 2;
    valuePath.setAttribute('d', Math.abs(normalized - centre) > 0.001 ? arc(Math.min(from, angle), Math.max(from, angle)) : '');
    const [x, y] = point(angle).split(' ');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    readout.textContent = formatValue(param, value);
  };

  const commitValue = (value) => {
    draw(value);
    onChange(value);
  };

  const commit = (n, fine = false) => commitValue(snap(fromNormalized(param, clamp(n, 0, 1)), fine));

  el.addEventListener('pointerdown', (e) => {
    onArm?.(el);
    el.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, n: normalized };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const scale = e.shiftKey ? FINE : 1;
    commit(drag.n + ((drag.y - e.clientY) / DRAG_PIXELS) * scale, e.shiftKey);
  });
  const end = () => {
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => commit(toNormalized(param, param.default)));
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const up = e.deltaY < 0;
      let next = snap(fromNormalized(param, clamp(normalized + (up ? WHEEL_STEP : -WHEEL_STEP) * (e.shiftKey ? FINE : 1), 0, 1)), e.shiftKey);
      const base = snap(current, e.shiftKey);
      if (param.step && !e.shiftKey && next === base) next = clamp(base + (up ? param.step : -param.step), param.min, param.max);
      commitValue(next);
    },
    { passive: false }
  );

  return {
    el,
    setValue(value) {
      if (!drag) draw(value);
    }
  };
}
