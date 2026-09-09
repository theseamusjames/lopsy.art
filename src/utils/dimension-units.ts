/**
 * Physical/logical unit conversions for canvas & image size dialogs.
 *
 * DPI is dots-per-inch. Values are stored in pixels internally; user-facing
 * fields render the pixel value converted for display in the chosen unit.
 * Round-trips through this file must be idempotent for whole-pixel counts —
 * `unitToPixels(pixelsToUnit(px, u, d), u, d) === px` at DPI ≥ 1 for `px` and
 * for the other units we only care about visible precision (fromUnit rounds).
 */

export type DimensionUnit = 'px' | 'in' | 'cm' | 'mm';

export const DIMENSION_UNITS: readonly DimensionUnit[] = ['px', 'in', 'cm', 'mm'] as const;

export const UNIT_LABEL: Record<DimensionUnit, string> = {
  px: 'Pixels',
  in: 'Inches',
  cm: 'Centimeters',
  mm: 'Millimeters',
};

const INCH_PER_CM = 1 / 2.54;
const INCH_PER_MM = 1 / 25.4;

/** Convert a value in `unit` to whole pixels at the given DPI. */
export function unitToPixels(value: number, unit: DimensionUnit, dpi: number): number {
  const safeDpi = dpi > 0 ? dpi : 72;
  if (unit === 'px') return Math.round(value);
  if (unit === 'in') return Math.round(value * safeDpi);
  if (unit === 'cm') return Math.round(value * INCH_PER_CM * safeDpi);
  return Math.round(value * INCH_PER_MM * safeDpi);
}

/** Convert a pixel count to a physical value in `unit`. Non-px units keep 2 decimals. */
export function pixelsToUnit(pixels: number, unit: DimensionUnit, dpi: number): number {
  const safeDpi = dpi > 0 ? dpi : 72;
  if (unit === 'px') return pixels;
  if (unit === 'in') return round2(pixels / safeDpi);
  if (unit === 'cm') return round2(pixels / (INCH_PER_CM * safeDpi));
  return round2(pixels / (INCH_PER_MM * safeDpi));
}

/** Sensible input step for a unit (whole pixels vs fractional physical). */
export function unitStep(unit: DimensionUnit): string {
  return unit === 'px' ? '1' : '0.01';
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Format a pixel value for display in the chosen unit. Strips trailing zeros
 * so "8.50" reads as "8.5" but "8.00" reads as "8" — matching how a user
 * would type the value themselves.
 */
export function formatForInput(pixels: number, unit: DimensionUnit, dpi: number): string {
  if (unit === 'px') return String(Math.round(pixels));
  const v = pixelsToUnit(pixels, unit, dpi);
  return String(v);
}
