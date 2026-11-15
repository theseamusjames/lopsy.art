export type RulerUnit = 'px' | 'pt' | 'in' | 'mm';

export const RULER_UNITS: readonly RulerUnit[] = ['px', 'pt', 'in', 'mm'];

export const RULER_UNIT_LABELS: Readonly<Record<RulerUnit, string>> = {
  px: 'Pixels',
  pt: 'Points',
  in: 'Inches',
  mm: 'Millimeters',
};

/** Resolution assumed for documents that carry no `dpi` (older files, opened images). */
export const DEFAULT_DPI = 72;

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/** Document pixels in one unit at `dpi`. */
export function pixelsPerUnit(unit: RulerUnit, dpi: number): number {
  switch (unit) {
    case 'px':
      return 1;
    case 'pt':
      return dpi / POINTS_PER_INCH;
    case 'in':
      return dpi;
    case 'mm':
      return dpi / MM_PER_INCH;
  }
}

export function pixelsToUnits(px: number, unit: RulerUnit, dpi: number): number {
  return px / pixelsPerUnit(unit, dpi);
}

// A physical inch ruler is divided in halves, quarters, eighths, sixteenths —
// not tenths — so sub-inch ticks keep halving instead of following 1-2-5.
function inchFractionBelow(target: number): number {
  return Math.pow(2, Math.floor(Math.log2(target)));
}

/** Largest 1-2-5 × 10ⁿ value at or below `target`. */
function niceStepBelow(target: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / mag;
  if (norm < 2) return mag;
  if (norm < 5) return mag * 2;
  return mag * 5;
}

export interface RulerStep {
  /** Interval between labelled ticks, in the ruler's unit. */
  readonly units: number;
  /** The same interval in document pixels. */
  readonly px: number;
}

/**
 * Labelled tick interval: the largest "round" value whose ticks land at most
 * ~50 screen px apart. Rounds down through 1-2-5 × 10ⁿ in the ruler's own
 * unit — so a millimetre ruler labels 10, 20, 50 mm and never 28.35 — with
 * inches below one taking the binary fractions instead. Pixels never go
 * below one whole pixel.
 */
export function rulerStep(unit: RulerUnit, zoom: number, dpi: number): RulerStep {
  const ppu = pixelsPerUnit(unit, dpi);
  const target = 50 / zoom / ppu;
  let units: number;
  if (unit === 'in' && target < 1) {
    units = inchFractionBelow(target);
  } else {
    units = niceStepBelow(target);
    if (unit === 'px' && units < 1) units = 1;
  }
  return { units, px: units * ppu };
}

/** Tick / readout label: whole pixels; other units trimmed to at most four decimals. */
export function formatRulerValue(value: number, unit: RulerUnit): string {
  if (unit === 'px') return String(Math.round(value));
  const trimmed = value.toFixed(4).replace(/\.?0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}
