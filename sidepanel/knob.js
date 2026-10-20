import { h } from './dom.js';
import { clamp, formatValue, fromNormalized, toNormalized } from '../shared/params.js';

const SWEEP = 135;
const RADIUS = 19;
const DRAG_PIXELS = 160;
const FINE = 0.2;
const WHEEL_STEP = 0.02;
const KEY_STEPS = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };

function point(angle) {
  const rad = (angle * Math.PI) / 180;
  return `${(25 + RADIUS * Math.sin(rad)).toFixed(2)} ${(25 - RADIUS * Math.cos(rad)).toFixed(2)}`;
}

function arc(from, to) {
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${point(to)}`;
}

export function createKnob({ param, onChange, onArm }) {
  const el = h('div', {
    className: 'knob',
    tabIndex: 0,
    role: 'slider',
    'aria-label': param.name,
    'aria-valuemin': String(param.min),
    'aria-valuemax': String(param.max),
    title: 'Drag up or down, or use the arrow keys. Shift for fine steps, double-click to reset.'
  });
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
    el.setAttribute('aria-valuenow', String(value));
    el.setAttribute('aria-valuetext', readout.textContent);
  };

  const commitValue = (value) => {
    draw(value);
    onChange(value);
  };

  const commit = (n, fine = false) => commitValue(snap(fromNormalized(param, clamp(n, 0, 1)), fine));

  const nudge = (steps, fine) => {
    let next = snap(fromNormalized(param, clamp(normalized + steps * WHEEL_STEP * (fine ? FINE : 1), 0, 1)), fine);
    const base = snap(current, fine);
    if (param.step && !fine && next === base) next = clamp(base + Math.sign(steps) * param.step, param.min, param.max);
    commitValue(next);
  };

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
      nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    },
    { passive: false }
  );
  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key in KEY_STEPS) nudge(KEY_STEPS[e.key], e.shiftKey);
    else if (e.key === 'Home' || e.key === 'End') commit(e.key === 'Home' ? 0 : 1);
    else if (e.key === 'Backspace' || e.key === 'Delete') commit(toNormalized(param, param.default));
    else return;
    e.preventDefault();
  });

  return {
    el,
    setValue(value) {
      if (!drag) draw(value);
    }
  };
}
