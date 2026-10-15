import { MSG, TARGET } from '../shared/messages.js';
import { BUS_IDS, BUS_LABELS, DEFAULT_MASTER, ROUTES, ROUTE_LABELS } from '../shared/state.js';
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
const $ = (id) => document.getElementById(id);

let state = null;
let structureKey = '';
let pointerDown = false;
let pending = [];
const editors = {};
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
    BUS_IDS.map((id) => {
      const { effect, lfo } = next.buses[id];
      return [effect, lfo?.target, lfo?.sync === 'Free'];
    })
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
        h('button', { type: 'button', title: 'Switch to this tab', textContent: 'GO', onclick: () => goToTab(p) })
      )
    )
  );
  $('pending').hidden = items.length === 0;
}

async function goToTab({ tabId, windowId }) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}

function renderBuses() {
  $('buses').replaceChildren(...BUS_IDS.map(renderBus));
}

function effectSelect(busId, current) {
  const select = h('select', { onchange: (e) => chooseEffect(busId, e.target.value || null) }, h('option', { value: '', textContent: 'No effect' }));
  const groups = new Map();
  for (const effect of listEffects(busId)) {
    if (!groups.has(effect.category)) groups.set(effect.category, h('optgroup', { label: effect.category }));
    groups.get(effect.category).append(
      h('option', { value: effect.id, textContent: effect.available ? effect.name : `${effect.name} (soon)`, disabled: !effect.available })
    );
  }
  select.append(...groups.values());
  select.value = current ?? '';
  return select;
}

async function chooseEffect(busId, effectId) {
  await send(MSG.SET_BUS_EFFECT, { busId, effectId });
  if (effectId) await send(MSG.SET_BUS_ENABLED, { busId, enabled: true });
}

function renderBus(busId) {
  const bus = state.buses[busId];
  const toggle = h('button', {
    type: 'button',
    className: 'bus-toggle',
    dataset: { role: 'toggle' },
    onclick: () => send(MSG.SET_BUS_ENABLED, { busId, enabled: !state.buses[busId].enabled })
  });
  const el = h('div', { className: 'bus', dataset: { bus: busId } }, h('div', { className: 'bus-head' }, toggle, h('h2', { textContent: BUS_LABELS[busId] }), effectSelect(busId, bus.effect)));
  const rows = [];
  if (busId === 'input') {
    rows.push(h('div', { className: 'param' }, h('label', { textContent: 'Route' }), routeSelect(state.inputRoute, (route) => send(MSG.SET_INPUT_ROUTE, { route })), h('output')));
  }
  const effect = bus.effect ? getEffect(bus.effect) : null;
  const editor = effect?.ui && EDITORS[effect.ui] ? createEditor(busId, effect) : null;
  editors[busId] = editor;
  if (editor) el.append(editor.el);
  for (const param of effect?.params ?? []) {
    if (!editor?.handles.includes(param.id)) rows.push(renderParam(busId, param));
  }
  if (busId === 'master') rows.push(renderMasterVolume());
  if (rows.length) el.append(h('div', { className: 'params' }, ...rows));
  if (effect) el.append(renderLfo(busId, effect));
  return el;
}

function createEditor(busId, effect) {
  return EDITORS[effect.ui]({
    params: effect.params,
    getValues: () => state.buses[busId].params,
    setParam: (paramId, value) => send(MSG.SET_PARAM, { busId, paramId, value }),
    arm: (paramId, el) => armLearn(busId, paramId, el)
  });
}

function renderLfo(busId, effect) {
  const lfo = state.buses[busId].lfo;
  const setLfo = (changes) => send(MSG.SET_LFO, { busId, changes });
  const target = h(
    'select',
    { onchange: (e) => setLfo({ target: e.target.value || null }) },
    h('option', { value: '', textContent: 'Off' }),
    ...effect.params.filter(isModulatable).map((p) => h('option', { value: p.id, textContent: p.name }))
  );
  target.value = lfo?.target ?? '';
  const rows = [h('div', { className: 'param lfo-head' }, h('label', { textContent: 'LFO' }), target, h('output'))];
  if (lfo?.target) {
    for (const param of LFO_PARAMS) {
      if (param.id === 'rate' && lfo.sync !== 'Free') continue;
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
      max: 1.5,
      step: 0.01,
      title: 'Double-click to reset',
      oninput: (e) => {
        setFill(e.target, e.target.value / 1.5);
        setLevel(e.target.value);
      },
      ondblclick: () => setLevel(DEFAULT_MASTER)
    }),
    h('output', { id: 'master-readout' })
  );
}

function renderParam(busId, param) {
  return controlRow(param, (value) => send(MSG.SET_PARAM, { busId, paramId: param.id, value }), { param: param.id }, (row) => armLearn(busId, param.id, row));
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
  return h(
    'div',
    { className: 'param', dataset, onpointerdown: (e) => onArm?.(e.currentTarget) },
    h('label', { textContent: param.name }),
    control,
    h('output')
  );
}

function setIfIdle(el, value) {
  if (el === document.activeElement && (pointerDown || el.type === 'number')) return;
  el.value = value;
}

function updateValues() {
  setIfIdle($('bpm'), state.bpm);
  setIfIdle($('master-volume'), state.master);
  setFill($('master-volume'), $('master-volume').value / 1.5);
  $('master-readout').textContent = `${Math.round(state.master * 100)}%`;
  $('auto').classList.toggle('on', state.autoBpm);
  const detected = state.detected;
  $('detected').textContent = detected ? `Heard ${detected.bpm.toFixed(1)} (${Math.round(detected.confidence * 100)}%)` : 'Heard —';
  $('detected').classList.toggle('confident', Boolean(detected && detected.confidence >= AUTO_CONFIDENT));
  for (const busId of BUS_IDS) {
    const bus = state.buses[busId];
    const el = document.querySelector(`.bus[data-bus="${busId}"]`);
    const toggle = el.querySelector('[data-role="toggle"]');
    toggle.classList.toggle('on', bus.enabled);
    toggle.setAttribute('aria-pressed', String(bus.enabled));
    toggle.title = `${BUS_LABELS[busId]} ${bus.enabled ? 'on' : 'off'}`;
    toggle.setAttribute('aria-label', toggle.title);
    toggle.disabled = !bus.effect;
    el.classList.toggle('active', bus.enabled && Boolean(bus.effect));
    const effect = bus.effect ? getEffect(bus.effect) : null;
    for (const param of effect?.params ?? []) {
      const row = el.querySelector(`.param[data-param="${param.id}"]`);
      if (row) {
        updateRow(row, param, bus.params[param.id]);
        row.classList.toggle('modulated', bus.lfo?.target === param.id);
      }
    }
    for (const param of LFO_PARAMS) {
      const row = el.querySelector(`.param[data-lfo="${param.id}"]`);
      if (row) updateRow(row, param, bus.lfo[param.id]);
    }
    editors[busId]?.update(bus.params);
  }
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

function updateMeter({ peak }) {
  const db = 20 * Math.log10(Math.max(peak, 1e-5));
  $('meter').style.width = `${clamp((db + 60) / 60, 0, 1) * 100}%`;
}

function armLearn(busId, paramId, row) {
  if (!midi.learning) return;
  midi.arm({ busId, paramId });
  document.querySelectorAll('.learn-target').forEach((el) => el.classList.remove('learn-target'));
  row.classList.add('learn-target');
}

function handleMidi({ busId, paramId }, normalized) {
  const effectId = state?.buses[busId]?.effect;
  const param = effectId && getEffect(effectId).params.find((p) => p.id === paramId);
  if (param) send(MSG.SET_PARAM, { busId, paramId, value: fromNormalized(param, normalized) });
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
    for (const busId of BUS_IDS) editors[busId]?.meter?.(message.level.buses?.[busId]);
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
