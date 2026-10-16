import { Slot } from './slot.js';

export class Bus {
  constructor(ctx, id) {
    this.ctx = ctx;
    this.id = id;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.slots = [];
    this.wire();
  }

  wire() {
    this.input.disconnect();
    for (const slot of this.slots) slot.output.disconnect();
    const last = this.slots.reduce((node, slot) => {
      node.connect(slot.input);
      return slot.output;
    }, this.input);
    last.connect(this.output);
  }

  slot(uid) {
    return this.slots.find((s) => s.uid === uid) ?? null;
  }

  add(uid, effectId, params, context) {
    const slot = new Slot(this.ctx, uid);
    slot.setEffect(effectId, params, context);
    this.slots.push(slot);
    this.wire();
    return slot;
  }

  remove(uid) {
    const slot = this.slot(uid);
    if (!slot) return;
    this.slots = this.slots.filter((s) => s !== slot);
    this.wire();
    slot.dispose();
  }

  move(uid, index) {
    const slot = this.slot(uid);
    if (!slot) return;
    this.slots = this.slots.filter((s) => s !== slot);
    this.slots.splice(Math.max(0, Math.min(index, this.slots.length)), 0, slot);
    this.wire();
  }

  clear() {
    const old = this.slots;
    this.slots = [];
    this.wire();
    old.forEach((slot) => slot.dispose());
  }

  setTempo(bpm) {
    this.slots.forEach((slot) => slot.setTempo(bpm));
  }

  setGrid(origin) {
    this.slots.forEach((slot) => slot.setGrid(origin));
  }

  meters() {
    const readings = {};
    for (const slot of this.slots) {
      const reading = slot.meter();
      if (reading) readings[slot.uid] = reading;
    }
    return readings;
  }
}
