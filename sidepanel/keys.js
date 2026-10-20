export const BUS_KEYS = { Digit1: 'bus1', Digit2: 'bus2', Digit3: 'bus3', Digit4: 'bus4', Digit5: 'input', Digit6: 'master' };

export const PAD_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'];

export const KEY_LABELS = Object.fromEntries([...Object.entries(BUS_KEYS).map(([code, id]) => [id, code.slice(5)]), ...PAD_KEYS.map((code, i) => [`pad${i}`, code.slice(3)])]);

const TYPING = new Set(['INPUT', 'TEXTAREA']);
const INTERACTIVE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

const byKeyboard = (el) => Boolean(el?.matches?.(':focus-visible'));

const typing = (target) => TYPING.has(target?.tagName) && target.type !== 'range' && target.type !== 'checkbox';

export function isUndo(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyZ' && !typing(event.target);
}

export function actionFor(event, keyboardFocused = byKeyboard) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const tag = event.target?.tagName;
  if (typing(event.target)) return null;
  if (event.code in BUS_KEYS) return { kind: 'bus', busId: BUS_KEYS[event.code] };
  const pad = PAD_KEYS.indexOf(event.code);
  if (pad >= 0) return { kind: 'pad', index: pad };
  if (event.code === 'Space') return INTERACTIVE.has(tag) && keyboardFocused(event.target) ? null : { kind: 'tap' };
  if (event.code === 'Escape') return { kind: 'stop' };
  if (event.code === 'KeyT') return { kind: 'rec' };
  if (event.code === 'KeyG') return { kind: 'chop' };
  if (event.code === 'KeyB') return { kind: 'bank' };
  return null;
}

// Chrome reports :focus-visible on any focused element once a key is pressed, so track how focus arrived instead.
export class FocusModality {
  constructor(doc = document) {
    this.viaKeyboard = new WeakSet();
    let keyboard = false;
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key.startsWith('Arrow')) keyboard = true;
    }, true);
    doc.addEventListener('pointerdown', () => {
      keyboard = false;
    }, true);
    doc.addEventListener('focusin', (e) => {
      if (keyboard) this.viaKeyboard.add(e.target);
      else this.viaKeyboard.delete(e.target);
    }, true);
  }

  has(el) {
    return this.viaKeyboard.has(el);
  }
}

export class HoldKeys {
  constructor({ press, release, keyboardFocused }) {
    this.press = press;
    this.release = release;
    this.keyboardFocused = keyboardFocused;
    this.held = new Map();
  }

  down(event) {
    const action = actionFor(event, this.keyboardFocused);
    if (!action) return false;
    event.preventDefault();
    if (event.repeat || this.held.has(event.code)) return true;
    this.held.set(event.code, action);
    this.press(action);
    return true;
  }

  up(event) {
    const action = this.held.get(event.code);
    if (!action) return false;
    event.preventDefault();
    this.held.delete(event.code);
    this.release(action);
    return true;
  }

  releaseAll() {
    for (const action of this.held.values()) this.release(action);
    this.held.clear();
  }
}
