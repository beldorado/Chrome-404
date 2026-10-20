import { h } from './dom.js';
import { BUS_KEYS, PAD_KEYS } from './keys.js';

const BUS_NAMES = { bus1: 'Bus 1', bus2: 'Bus 2', bus3: 'Bus 3', bus4: 'Bus 4', input: 'Input', master: 'Master' };
const FUNCTIONS = { KeyT: ['Rec', 'rec'], KeyG: ['Chop', 'fn'], KeyB: ['Bank', 'fn'] };
const ROWS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB']
];
const ACTIONS = new Set(['click', 'scroll', 'Drag', 'Hold']);
const GESTURES = [
  [['Shift', 'click'], 'a pad to select it without playing it'],
  [['Ctrl', 'click'], 'pads to select several'],
  [['Drag'], 'a pad onto another to move, copy or swap it'],
  [['Hold'], 'a bus button to play it only while held'],
  [['Ctrl', 'Z'], 'to undo the last pad change'],
  [['Shift', 'scroll'], 'the waveform to zoom in time, Alt for amplitude']
];

function cap(code) {
  const letter = code.replace(/^(Key|Digit)/, '');
  if (code in BUS_KEYS) {
    const busId = BUS_KEYS[code];
    return h('span', { className: 'cap cap-bus', dataset: { bus: busId } }, h('kbd', { textContent: letter }), h('span', { textContent: BUS_NAMES[busId] }));
  }
  if (code in FUNCTIONS) {
    const [label, kind] = FUNCTIONS[code];
    return h('span', { className: `cap cap-${kind}` }, h('kbd', { textContent: letter }), h('span', { textContent: label }));
  }
  return h('span', { className: 'cap cap-pad' }, h('kbd', { textContent: letter }), h('span', { textContent: `Pad ${PAD_KEYS.indexOf(code) + 1}` }));
}

function wide(key, label, className) {
  return h('span', { className: `cap cap-fn ${className}` }, h('kbd', { textContent: key }), h('span', { textContent: label }));
}

export function createKeymap() {
  const close = h('button', { type: 'button', className: 'status-close', 'aria-label': 'Close', title: 'Close (Esc)', textContent: '✕', onclick: () => dialog.close() });
  const board = h(
    'div',
    { className: 'board', role: 'img', 'aria-label': 'Keys 1 to 6 are the bus FX buttons. Q W E R, A S D F and Z X C V play pads 1 to 12 of the bank on screen. T records, G chops while editing, B switches bank, Space taps the tempo and Esc stops every pad.' },
    ...ROWS.map((row, i) => h('div', { className: 'board-row', dataset: { row: String(i) } }, ...row.map(cap))),
    h('div', { className: 'board-row', dataset: { row: 'space' } }, wide('Esc', 'Stop pads', 'cap-esc'), wide('Space', 'Tap tempo', 'cap-space'))
  );
  const gestures = h(
    'dl',
    { className: 'gestures' },
    ...GESTURES.flatMap(([keys, text]) => [
      h('dt', {}, ...keys.flatMap((k, i) => [...(i ? ['+'] : []), ACTIONS.has(k) ? k : h('kbd', { textContent: k })])),
      h('dd', { textContent: text })
    ])
  );
  const dialog = h(
    'dialog',
    { className: 'keymap', 'aria-labelledby': 'keymap-title' },
    h('div', { className: 'keymap-head' }, h('h2', { id: 'keymap-title', textContent: 'Keys' }), close),
    board,
    h('p', { className: 'hint', textContent: 'Pad keys play the bank on screen, laid out like the pads. Keys work whenever the panel has focus, except while you type in a box.' }),
    gestures
  );
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      dialog.close();
    }
  });
  document.body.append(dialog);
  return {
    toggle() {
      if (dialog.open) dialog.close();
      else dialog.showModal();
    }
  };
}
