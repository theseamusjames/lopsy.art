/**
 * Export choices photos-core's ExportSettings has no field for yet (spec
 * 5.5): the size by short edge or megapixels, enlarging, PNG bit depth and
 * how a download is packed. They travel with the settings object to the
 * export renderer (`withExtras` / `extrasOf`) and are saved beside an
 * export preset in a library setting. Pure.
 */

import type { ExportSettings } from '@lopsy/photos-core/export/types';
import type { Json } from '@lopsy/photos-core/library/types';

export type SizeSpec =
  | { readonly mode: 'original' }
  | { readonly mode: 'long' | 'short'; readonly px: number }
  | { readonly mode: 'megapixels'; readonly mp: number };

export interface ExportExtras {
  readonly size: SizeSpec;
  /** Off by default: a photo smaller than the size asked for stays as it is. */
  readonly allowEnlarge: boolean;
  /** PNG only: 16 bits per channel (the engine's PNG) or 8 (smaller files). */
  readonly pngDepth: 8 | 16;
  /** Download only: several files as one zip, or each file on its own. */
  readonly zip: boolean;
}

export const DEFAULT_EXTRAS: ExportExtras = { size: { mode: 'original' }, allowEnlarge: false, pngDepth: 16, zip: true };

/** The largest output this POC renders: 100 megapixels, 30 000 px on a side. */
const MAX_SIDE = 30_000;
const MAX_PIXELS = 100_000_000;

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/** The output size for an image, or the image's own size when nothing changes it. */
export function outputSize(image: PixelSize, extras: Pick<ExportExtras, 'size' | 'allowEnlarge'>): PixelSize {
  const { size } = extras;
  const long = Math.max(image.width, image.height);
  const short = Math.min(image.width, image.height);
  let scale = 1;
  if (size.mode === 'long') scale = size.px / long;
  else if (size.mode === 'short') scale = size.px / short;
  else if (size.mode === 'megapixels') scale = Math.sqrt((size.mp * 1_000_000) / (image.width * image.height));
  if (!Number.isFinite(scale) || scale <= 0) return image;
  if (!extras.allowEnlarge) scale = Math.min(scale, 1);
  scale = Math.min(scale, MAX_SIDE / long, Math.sqrt(MAX_PIXELS / (image.width * image.height)));
  if (Math.abs(scale - 1) < 1e-9) return image;
  return { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) };
}

const KEY = 'photosExportExtras';

/** Settings with the extras riding along, for the renderer. */
export function withExtras(settings: Partial<ExportSettings>, extras: ExportExtras): Partial<ExportSettings> {
  return { ...settings, [KEY]: extras } as Partial<ExportSettings>;
}

export function extrasOf(settings: ExportSettings): ExportExtras {
  return parseExtras((settings as unknown as Record<string, unknown>)[KEY]);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function positive(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null;
}

/** Extras read back from a setting: anything unknown falls back to the defaults. */
export function parseExtras(value: unknown): ExportExtras {
  if (!isRecord(value)) return DEFAULT_EXTRAS;
  const s = isRecord(value.size) ? value.size : {};
  let size: SizeSpec = { mode: 'original' };
  if ((s.mode === 'long' || s.mode === 'short') && positive(s.px, MAX_SIDE) !== null) size = { mode: s.mode, px: Math.round(s.px as number) };
  else if (s.mode === 'megapixels' && positive(s.mp, MAX_PIXELS / 1_000_000) !== null) size = { mode: 'megapixels', mp: s.mp as number };
  return {
    size,
    allowEnlarge: value.allowEnlarge === true,
    pngDepth: value.pngDepth === 8 ? 8 : 16,
    zip: value.zip !== false,
  };
}

export function extrasToJson(extras: ExportExtras): Json {
  return JSON.parse(JSON.stringify(extras)) as Json;
}

/** The library setting that keeps an export preset's extras. */
export function extrasSettingKey(presetId: string): string {
  return `exportPresetExtras.${presetId}`;
}

/** The long edge photos-core's own field can carry; null unless the size is by long edge. */
export function maxLongEdgeOf(extras: ExportExtras): number | null {
  return extras.size.mode === 'long' && !extras.allowEnlarge ? extras.size.px : null;
}

/** Built-in presets have no stored extras: what their settings imply. */
export function extrasFromSettings(settings: ExportSettings): ExportExtras {
  return {
    ...DEFAULT_EXTRAS,
    size: settings.maxLongEdge !== null ? { mode: 'long', px: settings.maxLongEdge } : { mode: 'original' },
  };
}
