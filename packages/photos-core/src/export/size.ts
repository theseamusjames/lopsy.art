/**
 * The output size of an export (spec 5.5): the original size, a long or
 * short edge in pixels, or a number of megapixels, never enlarged unless
 * asked. Pure.
 */

export type ExportSize =
  | { readonly mode: 'original' }
  | { readonly mode: 'long' | 'short'; readonly px: number }
  | { readonly mode: 'megapixels'; readonly mp: number };

/** The largest output: 100 megapixels, 30 000 px on a side. */
export const MAX_EXPORT_SIDE = 30_000;
export const MAX_EXPORT_PIXELS = 100_000_000;

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A size read from storage or a form; null when it is not a valid one. */
export function exportSizeFromJson(value: unknown): ExportSize | null {
  if (!isRecord(value)) return null;
  if (value.mode === 'original') return { mode: 'original' };
  const px = value.px;
  if ((value.mode === 'long' || value.mode === 'short') && typeof px === 'number' && Number.isInteger(px) && px > 0 && px <= MAX_EXPORT_SIDE) {
    return { mode: value.mode, px };
  }
  const mp = value.mp;
  if (value.mode === 'megapixels' && typeof mp === 'number' && Number.isFinite(mp) && mp > 0 && mp <= MAX_EXPORT_PIXELS / 1e6) {
    return { mode: 'megapixels', mp };
  }
  return null;
}

/** Why a size is not valid (for `exportSettingsProblem`). */
export function sizeProblem(size: unknown): string {
  return isRecord(size) && size.mode === 'megapixels'
    ? `Megapixels must be more than 0 and at most ${MAX_EXPORT_PIXELS / 1e6}.`
    : `The size must be a whole number of pixels, at most ${MAX_EXPORT_SIDE}.`;
}

/** The settings' size, with settings saved before `size` read from their long edge. */
export function exportSizeOf(settings: { readonly size?: ExportSize; readonly maxLongEdge: number | null }): ExportSize {
  if (settings.size) return settings.size;
  return settings.maxLongEdge !== null ? { mode: 'long', px: settings.maxLongEdge } : { mode: 'original' };
}

/** The long edge that `maxLongEdge` can carry for a size: only a long edge, without enlarging. */
export function maxLongEdgeFor(size: ExportSize, allowEnlarge: boolean): number | null {
  return size.mode === 'long' && !allowEnlarge ? size.px : null;
}

/** The output size for an image, or the image's own size (the same object) when nothing changes it. */
export function outputSize(image: PixelSize, options: { readonly size: ExportSize; readonly allowEnlarge: boolean }): PixelSize {
  const { size } = options;
  const long = Math.max(image.width, image.height);
  const short = Math.min(image.width, image.height);
  let scale = 1;
  if (size.mode === 'long') scale = size.px / long;
  else if (size.mode === 'short') scale = size.px / short;
  else if (size.mode === 'megapixels') scale = Math.sqrt((size.mp * 1_000_000) / (image.width * image.height));
  if (!Number.isFinite(scale) || scale <= 0) return image;
  if (!options.allowEnlarge) scale = Math.min(scale, 1);
  scale = Math.min(scale, MAX_EXPORT_SIDE / long, Math.sqrt(MAX_EXPORT_PIXELS / (image.width * image.height)));
  if (Math.abs(scale - 1) < 1e-9) return image;
  return { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) };
}
