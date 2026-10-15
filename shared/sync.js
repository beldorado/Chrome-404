export const DIVISIONS = {
  '1/32': 0.125,
  '1/16T': 1 / 6,
  '1/16': 0.25,
  '1/8T': 1 / 3,
  '1/8': 0.5,
  '1/8D': 0.75,
  '1/4T': 2 / 3,
  '1/4': 1,
  '1/4D': 1.5,
  '1/2': 2,
  '1 bar': 4,
  '2 bars': 8,
  '4 bars': 16
};

export const SYNC_OPTIONS = Object.keys(DIVISIONS);

export function syncRange(from, to) {
  return SYNC_OPTIONS.slice(SYNC_OPTIONS.indexOf(from), SYNC_OPTIONS.indexOf(to) + 1);
}

export function divisionBeats(name, fallback = 1) {
  return DIVISIONS[name] ?? fallback;
}
