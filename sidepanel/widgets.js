import { h } from './dom.js';
import { listEffects } from '../effects/registry.js';
import { PAD_NAME_MAX, ROUTES, ROUTE_LABELS } from '../shared/state.js';
import { clamp } from '../shared/params.js';

export function fillEffectOptions(select, busId, placeholder = null) {
  const groups = new Map();
  for (const effect of listEffects(busId)) {
    if (!effect.available) continue;
    if (!groups.has(effect.category)) groups.set(effect.category, h('optgroup', { label: effect.category }));
    groups.get(effect.category).append(h('option', { value: effect.id, textContent: effect.name }));
  }
  const previous = select.value;
  const head = placeholder ? [h('option', { value: '', textContent: placeholder, disabled: true })] : [];
  select.replaceChildren(...head, ...groups.values());
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

export function routeSelect(value, onchange, label = 'Route') {
  const select = h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) }, ...ROUTES.map((r) => h('option', { value: r, textContent: ROUTE_LABELS[r] })));
  select.value = value;
  return select;
}

export function setFill(input, normalized) {
  input.style.setProperty('--fill', `${clamp(normalized, 0, 1) * 100}%`);
}

export function holdButton(el, { press, release }) {
  let pointer = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    el.setPointerCapture(e.pointerId);
    press(e);
  });
  const end = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    release();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    press(e);
    release();
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('mousedown', (e) => e.preventDefault());
}

export function confirmButton(el, { label, confirmLabel, onConfirm, ms = 3000 }) {
  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    el.textContent = label;
    el.classList.remove('confirming');
  };
  el.textContent = label;
  el.addEventListener('click', () => {
    if (timer) {
      reset();
      onConfirm();
      return;
    }
    el.textContent = confirmLabel;
    el.classList.add('confirming');
    timer = setTimeout(reset, ms);
  });
  el.addEventListener('blur', reset);
  return el;
}

export function nameField({ label, onCommit }) {
  let committed = '';
  const el = h('input', { type: 'text', className: 'name-field', maxLength: PAD_NAME_MAX, spellcheck: false, autocomplete: 'off', 'aria-label': label, title: 'Click to rename. Enter saves, Esc cancels.' });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.blur();
    else if (e.key === 'Escape') {
      el.value = committed;
      el.blur();
    }
  });
  el.addEventListener('focus', () => el.select());
  el.addEventListener('blur', () => {
    const next = el.value.trim();
    if (!next || next === committed) {
      el.value = committed;
      return;
    }
    committed = next;
    el.value = next;
    onCommit(next);
  });
  return {
    el,
    set(value) {
      committed = value;
      if (document.activeElement !== el) el.value = value;
    }
  };
}
