export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function toNormalized(param, value) {
  if (param.kind === 'enum') {
    return Math.max(0, param.options.indexOf(value)) / Math.max(1, param.options.length - 1);
  }
  const v = clamp(value, param.min, param.max);
  if (param.scale === 'log') return Math.log(v / param.min) / Math.log(param.max / param.min);
  return (v - param.min) / (param.max - param.min);
}

export function fromNormalized(param, normalized) {
  const t = clamp(normalized, 0, 1);
  if (param.kind === 'enum') return param.options[Math.round(t * (param.options.length - 1))];
  if (param.scale === 'log') return param.min * Math.pow(param.max / param.min, t);
  return param.min + t * (param.max - param.min);
}

export function sanitizeParam(param, value) {
  if (param.kind === 'enum') return param.options.includes(value) ? value : param.default;
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, param.min, param.max) : param.default;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function formatValue(param, value) {
  if (param.kind === 'enum') return String(value);
  if (param.unit === 'Hz' && value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
  if (param.unit === '%') return `${Math.round(value * 100)}%`;
  if (param.unit === 'note') {
    const note = Math.round(value);
    return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
  }
  if (param.unit === 's') return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
  if (param.unit === 'dB' || param.unit === 'st') return `${value > 0 ? '+' : ''}${value.toFixed(1)} ${param.unit}`;
  if (param.unit === '×') return `${value.toFixed(2)}×`;
  if (param.unit === ':1') return `${value.toFixed(1)}:1`;
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${param.unit ? ` ${param.unit}` : ''}`;
}
