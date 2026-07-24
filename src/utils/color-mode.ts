import type { Color } from '../types/color';
import type { DocumentColorMode } from '../types/color-mode';

const MODE_LABELS: Record<DocumentColorMode, string> = {
  rgb: 'RGB',
  grayscale: 'Grayscale',
  indexed: 'Indexed',
  lab: 'Lab',
  cmyk: 'CMYK',
};

/** Human-readable label for a color mode (menus, status bar). */
export function colorModeLabel(mode: DocumentColorMode): string {
  return MODE_LABELS[mode];
}

/**
 * Rec. 709 luma of an 8-bit sRGB triple, applied to the stored (gamma-encoded)
 * values to match `adjustments.glsl` and the engine's grayscale bake.
 */
export function luminance8(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/** Collapse a color to neutral gray, preserving alpha. */
export function toGrayscaleColor(color: Color): Color {
  const v = luminance8(color.r, color.g, color.b);
  return { r: v, g: v, b: v, a: color.a };
}

/**
 * Nearest palette entry by squared distance in RGB, mirroring the engine's
 * `nearest_palette_index`. Returns the input unchanged for an empty palette.
 */
export function snapToPalette(color: Color, palette: readonly Color[]): Color {
  let best: Color | undefined;
  let bestDist = Infinity;
  for (const entry of palette) {
    const dr = entry.r - color.r;
    const dg = entry.g - color.g;
    const db = entry.b - color.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best ? { ...best, a: color.a } : color;
}

/**
 * Snap a color to the value space of the document's color mode before it is
 * handed to the engine at a paint entry point.
 */
export function convertColorToDocMode(
  color: Color,
  mode: DocumentColorMode,
  palette?: readonly Color[],
): Color {
  if (mode === 'grayscale') return toGrayscaleColor(color);
  if (mode === 'indexed' && palette && palette.length > 0) return snapToPalette(color, palette);
  return color;
}
