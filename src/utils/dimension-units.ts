export type DimensionUnit = 'px' | 'in';

export function toPixels(value: number, unit: DimensionUnit, dpi: number): number {
  if (unit === 'in') return Math.round(value * dpi);
  return Math.round(value);
}

export function fromPixels(pixels: number, unit: DimensionUnit, dpi: number): number {
  if (unit === 'in') return pixels / dpi;
  return pixels;
}

export function formatDimension(pixels: number, unit: DimensionUnit, dpi: number): string {
  if (unit === 'in') return (pixels / dpi).toFixed(2);
  return String(pixels);
}
