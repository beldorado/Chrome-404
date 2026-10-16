const BYTES_PER_SAMPLE = 2;

export function encodeWav(channels, sampleRate) {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * BYTES_PER_SAMPLE;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * BYTES_PER_SAMPLE, true);
  view.setUint16(32, count * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < count; ch++) {
      const v = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return view.buffer;
}
