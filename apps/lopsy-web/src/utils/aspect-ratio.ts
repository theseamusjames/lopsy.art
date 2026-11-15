export const MIN_ASPECT_RATIO_TERM = 1;
export const MAX_ASPECT_RATIO_TERM = 10000;

export interface AspectRatioPreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export const ASPECT_RATIO_PRESETS: readonly AspectRatioPreset[] = [
  { id: '1:1', label: '1:1 Square', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:2', label: '3:2', w: 3, h: 2 },
  { id: '5:4', label: '5:4', w: 5, h: 4 },
  { id: '7:5', label: '7:5', w: 7, h: 5 },
  { id: '16:9', label: '16:9 Widescreen', w: 16, h: 9 },
  { id: '16:10', label: '16:10', w: 16, h: 10 },
  { id: '21:9', label: '21:9 Ultrawide', w: 21, h: 9 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '2:3', label: '2:3', w: 2, h: 3 },
  { id: '4:5', label: '4:5 Portrait', w: 4, h: 5 },
  { id: '5:7', label: '5:7', w: 5, h: 7 },
  { id: '9:16', label: '9:16 Story', w: 9, h: 16 },
];

export function clampAspectRatioTerm(value: number): number {
  if (!Number.isFinite(value)) return MIN_ASPECT_RATIO_TERM;
  return Math.min(MAX_ASPECT_RATIO_TERM, Math.max(MIN_ASPECT_RATIO_TERM, value));
}

/**
 * Turn a draft typed into a ratio field into a committed term, or `null`
 * when the draft is not a number (the field then reverts to its old value).
 */
export function parseAspectRatioDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return clampAspectRatioTerm(n);
}

export function findAspectRatioPreset(w: number, h: number): AspectRatioPreset | undefined {
  return ASPECT_RATIO_PRESETS.find((p) => p.w === w && p.h === h);
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * The document's own width : height in lowest terms, scaled to fit the
 * term range when the reduced terms are still too large.
 */
export function documentAspectRatio(width: number, height: number): { w: number; h: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const divisor = greatestCommonDivisor(w, h);
  const rw = w / divisor;
  const rh = h / divisor;
  const largest = Math.max(rw, rh);
  if (largest <= MAX_ASPECT_RATIO_TERM) return { w: rw, h: rh };
  const scale = MAX_ASPECT_RATIO_TERM / largest;
  return {
    w: clampAspectRatioTerm(Math.round(rw * scale)),
    h: clampAspectRatioTerm(Math.round(rh * scale)),
  };
}
