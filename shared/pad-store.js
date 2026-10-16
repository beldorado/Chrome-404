import { LEGACY_PADS_PER_BANK, migratePadIndex } from './state.js';

const DB_NAME = 'chrome404';
const STORE = 'pads';
const VERSION = 2;

let opening = null;

export function padMoves(indices, fromPerBank) {
  return indices
    .map((from) => [from, migratePadIndex(from, fromPerBank)])
    .filter(([from, to]) => from !== to)
    .sort((a, b) => b[0] - a[0]);
}

function relayout(store, fromPerBank) {
  const request = store.getAll();
  request.onsuccess = () => {
    const records = new Map(request.result.map((r) => [r.index, r]));
    for (const [from, to] of padMoves([...records.keys()], fromPerBank)) {
      store.delete(from);
      if (to >= 0) store.put({ ...records.get(from), index: to });
    }
  };
}

function open() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = (e) => {
      if (e.oldVersion < 1) request.result.createObjectStore(STORE, { keyPath: 'index' });
      else if (e.oldVersion < 2) relayout(request.transaction.objectStore(STORE), LEGACY_PADS_PER_BANK);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function run(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function putClip(record) {
  return run('readwrite', (store) => store.put(record));
}

export function getClip(index) {
  return run('readonly', (store) => store.get(index));
}

export function getAllClips() {
  return run('readonly', (store) => store.getAll());
}

export function deleteClip(index) {
  return run('readwrite', (store) => store.delete(index));
}

export function clipRecord(index, buffer, { name, bpm }) {
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, ch) => buffer.getChannelData(ch).slice());
  return { index, name, bpm, sampleRate: buffer.sampleRate, channels };
}

export function bufferFromRecord(ctx, { sampleRate, channels }) {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((data, ch) => buffer.copyToChannel(data, ch));
  return buffer;
}
