import { MSG } from '../shared/messages.js';
import { getClip, putClip } from '../shared/pad-store.js';
import { padLabel } from '../shared/state.js';

const SETTINGS = ['mode', 'level', 'sync', 'choke', 'speed', 'pitch', 'stretch'];

const takesOf = (state, indices) => indices.map((i) => state.pads[i].clip?.take ?? null);

export function createUndo({ send, getState }) {
  let entry = null;

  async function capture(indices) {
    const state = getState();
    return Promise.all(
      indices.map(async (index) => {
        const { clip } = state.pads[index];
        const stored = clip ? await getClip(index) : null;
        return {
          index,
          record: stored ? { ...stored, start: clip.start, end: clip.end } : null,
          settings: Object.fromEntries(SETTINGS.map((key) => [key, state.pads[index][key]]))
        };
      })
    );
  }

  function commit(label, pads) {
    entry = { label, pads, takes: takesOf(getState(), pads.map((p) => p.index)) };
  }

  async function undo() {
    if (!entry) return null;
    const { label, pads, takes } = entry;
    entry = null;
    const now = takesOf(getState(), pads.map((p) => p.index));
    const changed = pads.find((_, i) => now[i] !== takes[i]);
    if (changed) throw new Error(`Pad ${padLabel(changed.index)} has changed since, so “${label}” can’t be undone.`);
    for (const { index, record } of pads) {
      if (record?.channels?.length) {
        await putClip(record);
        await send(MSG.PAD_STORED, { index });
      } else if (getState().pads[index].clip) {
        await send(MSG.CLEAR_PAD, { index });
      }
    }
    for (const { index, settings } of pads) await send(MSG.UPDATE_PAD, { index, changes: settings });
    return label;
  }

  return { capture, commit, undo, available: () => Boolean(entry) };
}
