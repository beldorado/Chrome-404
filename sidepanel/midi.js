const STORAGE_KEY = 'midiMap';
const CONTROL_CHANGE = 0xb0;

export class MidiLearn {
  constructor({ onControl, onStatus }) {
    this.onControl = onControl;
    this.onStatus = onStatus;
    this.access = null;
    this.map = {};
    this.learning = false;
    this.target = null;
  }

  async start() {
    if (this.access) return true;
    if (!navigator.requestMIDIAccess) {
      this.onStatus('Web MIDI is not available in this browser.');
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch (err) {
      this.onStatus(`MIDI unavailable: ${err.message}`);
      return false;
    }
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    this.map = stored[STORAGE_KEY] ?? {};
    const attach = () => {
      for (const input of this.access.inputs.values()) input.onmidimessage = (e) => this.handle(e.data);
    };
    attach();
    this.access.onstatechange = attach;
    return true;
  }

  async toggleLearn() {
    if (!(await this.start())) return false;
    this.learning = !this.learning;
    this.target = null;
    return this.learning;
  }

  arm(target) {
    if (this.learning) this.target = target;
  }

  handle([status, controller, value]) {
    if ((status & 0xf0) !== CONTROL_CHANGE) return;
    const key = `${status & 0x0f}:${controller}`;
    if (this.learning && this.target) {
      this.map[key] = this.target;
      chrome.storage.local.set({ [STORAGE_KEY]: this.map });
      this.onStatus(`CC ${controller} (ch ${(status & 0x0f) + 1}) → ${this.target.busId} ${this.target.paramId}`);
      this.target = null;
      return;
    }
    const target = this.map[key];
    if (target) this.onControl(target, value / 127);
  }
}
