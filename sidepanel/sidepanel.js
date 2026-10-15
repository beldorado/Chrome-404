import { MSG, TARGET } from '../shared/messages.js';
import { BUS_IDS, BUS_LABELS, DEFAULT_MASTER, MAX_SLOTS, ROUTES, ROUTE_LABELS } from '../shared/state.js';
import { getEffect, listEffects } from '../effects/registry.js';
import { clamp, formatValue, fromNormalized, toNormalized } from '../shared/params.js';
import { TapTempo } from '../shared/tempo.js';
import { PRESETS } from '../engine/presets.js';
import { MidiLearn } from './midi.js';
import { h } from './dom.js';
import { EDITORS } from './editors/index.js';
import { LFO_PARAMS, isModulatable } from '../shared/lfo.js';

const SLIDER_STEPS = 1000;
const AUTO_CONFIDENT = 0.2;
const GR_RANGE_DB = 24;
const MASTER_MAX = 1.5;
const $ = (id) => document.getElementById(id);

let state = null;
let structureKey = '';
let pointerDown = false;
let pending = [];
const editors = new Map();
const collapsed = new Set();
const tapTempo = new TapTempo();
const midi = new MidiLearn({ onControl: handleMidi, onStatus: showStatus });

function showStatus(message, kind = 'error') {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('info', kind === 'info');
  el.hidden = false;
}

async function send(type, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ target: TARGET.OFFSCREEN, type, ...payload });
    if (!response?.ok) throw new Error(response?.error ?? 'Engine did not respond');
    setState(response.result);
    return response.result;
  } catch (err) {
    showStatus(err.message);
    return null;
  }
}

function setState(next) {
  if (!next) return;
  state = next;
  const key = JSON.stringify([
    next.sources,
    next.inputRoute,
    BUS_IDS.map((id) => next.buses[id].slots.map((s) => [s.uid, s.effect, s.lfo?.target, s.lfo?.sync === 'Free', collapsed.has(s.uid)]))
  ]);
  if (key !== structureKey) {
    structureKey = key;
    renderSources();
    renderPending();
    renderBuses();
  }
  updateValues();
  if (!next.sources.length) updateMeter({ peak: 0 });
}

function rerender() {
  structureKey = '';
  setState(state);
}

function routeSelect(value, onchange) {
  const select = h('select', { onchange: (e) => onchange(e.target.value) }, ...ROUTES.map((r) => h('option', { value: r, textContent: ROUTE_LABELS[r] })));
  select.value = value;
  return select;
}

function renderSources() {
  $('sources').replaceChildren(...state.sources.map(renderSource));
  $('sources-empty').hidden = state.sources.length > 0;
}

function renderSource(source) {
  const update = (changes) => send(MSG.UPDATE_SOURCE, { sourceId: source.id, changes });
  const route = routeSelect(source.route, (value) => update({ route: value }));
  route.disabled = source.inputFx;
  route.title = source.inputFx ? 'Routed by Input FX' : 'Route';
  return h(
    'li',
    { className: 'source' },
    h('span', { className: 'source-label', title: source.label, textContent: source.label }),
    route,
    h('label', { title: 'Send through Input FX first' }, h('input', { type: 'checkbox', checked: source.inputFx, onchange: (e) => update({ inputFx: e.target.checked }) }), ' In FX'),
    h('button', { type: 'button', title: 'Stop capturing', textContent: '✕', onclick: () => send(MSG.REMOVE_SOURCE, { sourceId: source.id }) })
  );
}

function renderPending() {
  const captured = new Set(state?.sources.map((s) => s.tabId) ?? []);
  const items = pending.filter((p) => !captured.has(p.tabId));
  $('pending-list').replaceChildren(
    ...items.map((p) =>
      h(
        'li',
        { className: 'pending-item' },
        h('span', { className: 'source-label', title: p.title, textContent: p.title }),
        h('button', { type: 'button', title: 'Switch to this tab', textContent: 'Go', onclick: () => goToTab(p) })
      )
    )
  );
  $('pending').hidden = items.length === 0;
}

async function goToTab({ tabId, windowId }) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}

function fillEffectOptions(select, busId) {
  const groups = new Map();
  for (const effect of listEffects(busId)) {
    if (!effect.available) continue;
    if (!groups.has(effect.category)) groups.set(effect.category, h('optgroup', { label: effect.category }));
    groups.get(effect.category).append(h('option', { value: effect.id, textContent: effect.name }));
  }
  const previous = select.value;
  select.replaceChildren(...groups.values());
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

function bindAddBar() {
  const bus = $('add-bus');
  const fx = $('add-fx');
  bus.append(...BUS_IDS.map((id) => h('option', { value: id, textContent: BUS_LABELS[id] })));
  bus.addEventListener('change', () => fillEffectOptions(fx, bus.value));
  fillEffectOptions(fx, bus.value);
  $('add-go').addEventListener('click', () => addSlot(bus.value, fx.value));
}

async function addSlot(busId, effectId) {
  if (!effectId) return;
  if (state.buses[busId].slots.length >= MAX_SLOTS) {
    showStatus(`${BUS_LABELS[busId]} is full (${MAX_SLOTS} effects). Remove one to add another.`);
    return;
  }
  await send(MSG.ADD_SLOT, { busId, effectId });
  const slots = state.buses[busId].slots;
  document.querySelector(`.slot[data-slot="${slots[slots.length - 1]?.uid}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function pickBus(busId) {
  const bus = $('add-bus');
  bus.value = busId;
  fillEffectOptions($('add-fx'), busId);
  $('add-bar').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('add-fx').focus();
}

const ALWAYS_SHOWN = new Set(['input', 'master']);

function renderBuses() {
  editors.clear();
  const visible = BUS_IDS.filter((id) => ALWAYS_SHOWN.has(id) || state.buses[id].slots.length > 0);
  $('buses').replaceChildren(...visible.map(renderBus));
}

function renderBus(busId) {
  const bus = state.buses[busId];
  const head = h(
    'div',
    { className: 'bus-head' },
    h('h2', { textContent: BUS_LABELS[busId] }),
    h('span', { className: 'bus-count', dataset: { role: 'count' } }),
    h('button', { type: 'button', className: 'bus-add', title: `Add an effect to ${BUS_LABELS[busId]}`, textContent: '+', onclick: () => pickBus(busId) })
  );
  const el = h('div', { className: 'bus', dataset: { bus: busId } }, head);
  const busRows = [];
  if (busId === 'input') {
    busRows.push(h('div', { className: 'param' }, h('label', { textContent: 'Route' }), routeSelect(state.inputRoute, (route) => send(MSG.SET_INPUT_ROUTE, { route })), h('output')));
  }
  if (busRows.length) el.append(h('div', { className: 'params' }, ...busRows));
  if (bus.slots.length) el.append(h('ol', { className: 'chain' }, ...bus.slots.map((slot, i) => renderSlot(busId, slot, i, bus.slots.length))));
  else el.append(h('p', { className: 'hint empty-bus', textContent: 'No effects. Press + to add one.' }));
  if (busId === 'master') el.append(h('div', { className: 'params' }, renderMasterVolume()));
  return el;
}

function renderSlot(busId, slot, index, count) {
  const effect = getEffect(slot.effect);
  const ref = { busId, slot: slot.uid };
  const open = !collapsed.has(slot.uid);
  const toggle = h('button', {
    type: 'button',
    className: 'bus-toggle',
    dataset: { role: 'toggle' },
    onclick: () => send(MSG.SET_SLOT_ENABLED, { ...ref, enabled: !currentSlot(busId, slot.uid)?.enabled })
  });
  const fold = h('button', {
    type: 'button',
    className: 'slot-fold',
    'aria-expanded': String(open),
    title: open ? `Hide ${effect.name} controls` : `Show ${effect.name} controls`,
    textContent: open ? '▾' : '▸',
    onclick: () => {
      if (open) collapsed.add(slot.uid);
      else collapsed.delete(slot.uid);
      rerender();
    }
  });
  const swap = h('select', {
    className: 'slot-effect',
    title: 'Swap this effect',
    'aria-label': `Effect in ${BUS_LABELS[busId]}, position ${index + 1}`,
    onchange: (e) => send(MSG.SWAP_SLOT, { ...ref, effectId: e.target.value })
  });
  fillEffectOptions(swap, busId);
  swap.value = slot.effect;
  const move = (delta, label, glyph, disabled) => h('button', { type: 'button', className: 'slot-tool', title: label, textContent: glyph, disabled, onclick: () => send(MSG.MOVE_SLOT, { ...ref, delta }) });
  const head = h(
    'div',
    { className: 'slot-head' },
    toggle,
    fold,
    swap,
    move(-1, 'Move earlier in the chain', '↑', index === 0),
    move(1, 'Move later in the chain', '↓', index === count - 1),
    h('button', { type: 'button', className: 'slot-tool', title: `Remove ${effect.name}`, textContent: '✕', onclick: () => send(MSG.REMOVE_SLOT, ref) })
  );
  const el = h('li', { className: 'slot', dataset: { slot: slot.uid } }, head);
  if (!open) return el;

  const body = h('div', { className: 'slot-body' });
  const editor = effect.ui && EDITORS[effect.ui] ? createEditor(busId, slot.uid, effect) : null;
  if (editor) {
    editors.set(slot.uid, editor);
    body.append(editor.el);
  }
  const rows = effect.params.filter((p) => !editor?.handles.includes(p.id)).map((p) => renderParam(busId, slot.uid, p));
  if (effect.meter === 'reduction') rows.push(renderReduction());
  if (rows.length) body.append(h('div', { className: 'params' }, ...rows));
  body.append(renderLfo(busId, slot, effect));
  el.append(body);
  return el;
}

function currentSlot(busId, uid) {
  return state.buses[busId]?.slots.find((s) => s.uid === uid) ?? null;
}

function createEditor(busId, uid, effect) {
  return EDITORS[effect.ui]({
    params: effect.params,
    getValues: () => currentSlot(busId, uid)?.params ?? {},
    setParam: (paramId, value) => send(MSG.SET_PARAM, { busId, slot: uid, paramId, value }),
    arm: (paramId, el) => armLearn({ busId, uid, paramId }, el)
  });
}

function renderReduction() {
  return h(
    'div',
    { className: 'param gr-row', title: 'Gain reduction' },
    h('label', { textContent: 'Reduction' }),
    h('div', { className: 'gr-bar' }, h('div', { className: 'gr-bar-fill' })),
    h('output', { textContent: '0.0 dB' })
  );
}

function renderLfo(busId, slot, effect) {
  const setLfo = (changes) => send(MSG.SET_LFO, { busId, slot: slot.uid, changes });
  const target = h(
    'select',
    { onchange: (e) => setLfo({ target: e.target.value || null }) },
    h('option', { value: '', textContent: 'Off' }),
    ...effect.params.filter(isModulatable).map((p) => h('option', { value: p.id, textContent: p.name }))
  );
  target.value = slot.lfo?.target ?? '';
  const rows = [h('div', { className: 'param lfo-head' }, h('label', { textContent: 'LFO' }), target, h('output'))];
  if (slot.lfo?.target) {
    for (const param of LFO_PARAMS) {
      if (param.id === 'rate' && slot.lfo.sync !== 'Free') continue;
      rows.push(controlRow(param, (value) => setLfo({ [param.id]: value }), { lfo: param.id }));
    }
  }
  return h('div', { className: 'lfo params' }, ...rows);
}

function renderMasterVolume() {
  const setLevel = (level) => send(MSG.SET_MASTER, { level });
  return h(
    'div',
    { className: 'param' },
    h('label', { textContent: 'Volume' }),
    h('input', {
      type: 'range',
      id: 'master-volume',
      min: 0,
      max: MASTER_MAX,
      step: 0.01,
      title: 'Double-click to reset',
      oninput: (e) => {
        setFill(e.target, e.target.value / MASTER_MAX);
        setLevel(e.target.value);
      },
      ondblclick: () => setLevel(DEFAULT_MASTER)
    }),
    h('output', { id: 'master-readout' })
  );
}

function renderParam(busId, uid, param) {
  return controlRow(
    param,
    (value) => send(MSG.SET_PARAM, { busId, slot: uid, paramId: param.id, value }),
    { param: param.id },
    (row) => armLearn({ busId, uid, paramId: param.id }, row)
  );
}

function controlRow(param, setValue, dataset, onArm) {
  const control =
    param.kind === 'enum'
      ? h('select', { onchange: (e) => setValue(e.target.value) }, ...param.options.map((o) => h('option', { value: o, textContent: o })))
      : h('input', {
          type: 'range',
          min: 0,
          max: SLIDER_STEPS,
          step: 1,
          title: 'Double-click to reset',
          oninput: (e) => {
            setFill(e.target, e.target.value / SLIDER_STEPS);
            setValue(fromNormalized(param, e.target.value / SLIDER_STEPS));
          },
          ondblclick: () => setValue(param.default)
        });
  control.dataset.role = 'param';
  return h('div', { className: 'param', dataset, onpointerdown: (e) => onArm?.(e.currentTarget) }, h('label', { textContent: param.name }), control, h('output'));
}

function setIfIdle(el, value) {
  if (el === document.activeElement && (pointerDown || el.type === 'number')) return;
  el.value = value;
}

function setFill(input, normalized) {
  input.style.setProperty('--fill', `${clamp(normalized, 0, 1) * 100}%`);
}

function updateRow(row, param, value) {
  const control = row.querySelector('[data-role="param"]');
  setIfIdle(control, param.kind === 'enum' ? value : Math.round(toNormalized(param, value) * SLIDER_STEPS));
  if (param.kind !== 'enum') setFill(control, control.value / SLIDER_STEPS);
  row.querySelector('output').textContent = param.kind === 'enum' ? '' : formatValue(param, value);
}

function updateValues() {
  setIfIdle($('bpm'), state.bpm);
  setIfIdle($('master-volume'), state.master);
  setFill($('master-volume'), $('master-volume').value / MASTER_MAX);
  $('master-readout').textContent = `${Math.round(state.master * 100)}%`;
  $('auto').classList.toggle('on', state.autoBpm);
  const detected = state.detected;
  $('detected').textContent = detected ? `Heard ${detected.bpm.toFixed(1)} (${Math.round(detected.confidence * 100)}%)` : 'Heard —';
  $('detected').classList.toggle('confident', Boolean(detected && detected.confidence >= AUTO_CONFIDENT));

  for (const busId of BUS_IDS) {
    const { slots } = state.buses[busId];
    const busEl = document.querySelector(`.bus[data-bus="${busId}"]`);
    if (!busEl) continue;
    busEl.classList.toggle('active', slots.some((s) => s.enabled));
    const count = busEl.querySelector('[data-role="count"]');
    count.textContent = slots.length ? `${slots.filter((s) => s.enabled).length}/${slots.length} on` : '';
    busEl.querySelector('.bus-add').disabled = slots.length >= MAX_SLOTS;

    for (const slot of slots) {
      const el = busEl.querySelector(`.slot[data-slot="${slot.uid}"]`);
      if (!el) continue;
      const toggle = el.querySelector('[data-role="toggle"]');
      const name = getEffect(slot.effect).name;
      toggle.classList.toggle('on', slot.enabled);
      toggle.setAttribute('aria-pressed', String(slot.enabled));
      toggle.title = `${name} ${slot.enabled ? 'on' : 'off'}`;
      toggle.setAttribute('aria-label', toggle.title);
      el.classList.toggle('active', slot.enabled);

      for (const param of getEffect(slot.effect).params) {
        const row = el.querySelector(`.param[data-param="${param.id}"]`);
        if (!row) continue;
        updateRow(row, param, slot.params[param.id]);
        row.classList.toggle('modulated', slot.lfo?.target === param.id);
      }
      for (const param of LFO_PARAMS) {
        const row = el.querySelector(`.param[data-lfo="${param.id}"]`);
        if (row) updateRow(row, param, slot.lfo[param.id]);
      }
      editors.get(slot.uid)?.update(slot.params);
    }
  }
}

function updateMeter({ peak }) {
  const db = 20 * Math.log10(Math.max(peak, 1e-5));
  $('meter').style.width = `${clamp((db + 60) / 60, 0, 1) * 100}%`;
}

function updateSlotMeters(readings = {}) {
  for (const [uid, editor] of editors) editor.meter?.(readings[uid]);
  for (const row of document.querySelectorAll('.gr-row')) {
    const uid = row.closest('.slot').dataset.slot;
    const reduction = Math.min(0, readings[uid]?.reduction ?? 0);
    row.querySelector('.gr-bar-fill').style.width = `${clamp(-reduction / GR_RANGE_DB, 0, 1) * 100}%`;
    row.querySelector('output').textContent = `${reduction.toFixed(1)} dB`;
  }
}

function armLearn(target, el) {
  if (!midi.learning) return;
  midi.arm(target);
  document.querySelectorAll('.learn-target').forEach((node) => node.classList.remove('learn-target'));
  el.classList.add('learn-target');
}

function handleMidi({ busId, uid, paramId }, normalized) {
  const slot = uid && currentSlot(busId, uid);
  const param = slot && getEffect(slot.effect).params.find((p) => p.id === paramId);
  if (param) send(MSG.SET_PARAM, { busId, slot: uid, paramId, value: fromNormalized(param, normalized) });
}

function bindControls() {
  const preset = $('preset');
  preset.append(h('option', { value: '', textContent: 'Load preset…' }), ...Object.entries(PRESETS).map(([id, p]) => h('option', { value: id, textContent: p.name })));
  preset.addEventListener('change', async () => {
    if (preset.value) await send(MSG.LOAD_PRESET, { presetId: preset.value });
    preset.value = '';
  });

  $('bpm').addEventListener('change', (e) => send(MSG.SET_BPM, { bpm: e.target.value }));
  $('tap').addEventListener('click', () => {
    const bpm = tapTempo.tap();
    if (bpm) send(MSG.SET_BPM, { bpm });
  });
  $('half').addEventListener('click', () => send(MSG.SET_BPM, { bpm: state.bpm / 2 }));
  $('double').addEventListener('click', () => send(MSG.SET_BPM, { bpm: state.bpm * 2 }));
  $('auto').addEventListener('click', () => send(MSG.SET_AUTO_BPM, { enabled: !state.autoBpm }));
  $('learn').addEventListener('click', async () => {
    const on = await midi.toggleLearn();
    $('learn').classList.toggle('armed', on);
    document.body.classList.toggle('learning', on);
    if (!on) document.querySelectorAll('.learn-target').forEach((el) => el.classList.remove('learn-target'));
  });

  $('status').addEventListener('click', () => {
    $('status').hidden = true;
  });

  bindAddBar();

  document.addEventListener('pointerdown', () => {
    pointerDown = true;
  });
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, () => {
      pointerDown = false;
    });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== TARGET.BROADCAST) return false;
  if (message.type === MSG.STATE) setState(message.state);
  else if (message.type === MSG.METER) {
    updateMeter(message.level);
    updateSlotMeters(message.level.slots);
  }
  return false;
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.lastError?.newValue) showStatus(changes.lastError.newValue.message);
  if (changes.pendingTabs) {
    pending = changes.pendingTabs.newValue ?? [];
    renderPending();
  }
});

async function init() {
  bindControls();
  const engine = await chrome.runtime.sendMessage({ target: TARGET.BACKGROUND, type: MSG.ENSURE_ENGINE }).catch((err) => ({ ok: false, error: err.message }));
  if (!engine?.ok) showStatus(`Engine failed to start: ${engine?.error}`);
  await send(MSG.GET_STATE);
  const { lastError, pendingTabs } = await chrome.storage.session.get(['lastError', 'pendingTabs']);
  if (lastError) showStatus(lastError.message);
  pending = pendingTabs ?? [];
  renderPending();
}

init();
