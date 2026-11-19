/** How the Edit view's sliders show and read their values: '+0.30', '−12', '0'. */

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
