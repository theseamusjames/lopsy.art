/** The arithmetic behind Slider: snapping, dragging and formatting. */

export interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const exp = /e-(\d+)$/.exec(text);
  if (exp?.[1]) return Number(exp[1]);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function snap(value: number, range: SliderRange): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  if (range.step <= 0) return clamped;
  const steps = Math.round((clamped - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  const decimals = decimalsOf(range.step);
  return Number(Math.min(range.max, Math.max(range.min, snapped)).toFixed(decimals));
}

/**
 * The value after dragging `dx` CSS pixels from `start`, where `trackWidth`
 * pixels span the whole range. `isFine` (Shift) moves ten times slower.
 */
export function dragValue(start: number, dx: number, trackWidth: number, range: SliderRange, isFine: boolean): number {
  const width = Math.max(1, trackWidth);
  const perPixel = (range.max - range.min) / width;
  return snap(start + dx * perPixel * (isFine ? 0.1 : 1), range);
}

/** The value after a key press; null for keys the slider does not handle. */
export function keyValue(value: number, key: string, isLarge: boolean, range: SliderRange): number | null {
  const step = range.step > 0 ? range.step : (range.max - range.min) / 100;
  const delta = isLarge ? step * 10 : step;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return snap(value + delta, range);
    case 'ArrowLeft':
    case 'ArrowDown':
      return snap(value - delta, range);
    case 'PageUp':
      return snap(value + step * 10, range);
    case 'PageDown':
      return snap(value - step * 10, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}

/** '0.30', '+0.30' on a signed range, '−12' with a true minus sign. */
export function formatValue(value: number, range: SliderRange): string {
  const decimals = decimalsOf(range.step);
  const isSigned = range.min < 0 && range.max > 0;
  const rounded = Number(value.toFixed(decimals));
  const magnitude = Math.abs(rounded).toFixed(decimals);
  if (rounded < 0) return `−${magnitude}`;
  if (isSigned && rounded > 0) return `+${magnitude}`;
  return magnitude;
}

/** Reads what the user typed; accepts '−', '+' and a decimal comma. Null when it is not a number. */
export function parseValue(text: string, range: SliderRange): number | null {
  const cleaned = text.trim().replace(/−/g, '-').replace(',', '.');
  if (cleaned === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return snap(Number(cleaned), range);
}

/** Where the value sits on the track, 0..1. */
export function fraction(value: number, range: SliderRange): number {
  if (range.max === range.min) return 0;
  return (Math.min(range.max, Math.max(range.min, value)) - range.min) / (range.max - range.min);
}
