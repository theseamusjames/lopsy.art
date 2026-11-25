/**
 * The Export dialog's size and packing choices (spec 5.5): the size by
 * long or short edge or megapixels, enlarging, PNG bit depth and how a
 * download is packed. They are photos-core ExportSettings fields
 * (`size`, `allowEnlarge`, `pngDepth`, `zip`); the dialog keeps them
 * together as `ExportExtras`, and `withExtras` / `extrasOf` move them in
 * and out of the settings. Pure.
 */

import type { ExportSettings } from '@lopsy/photos-core/export/types';
import { exportSizeFromJson, exportSizeOf, maxLongEdgeFor, type ExportSize } from '@lopsy/photos-core/export/size';

export { outputSize, type PixelSize } from '@lopsy/photos-core/export/size';

export type SizeSpec = ExportSize;

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

/** The settings with the extras in their fields; `maxLongEdge` mirrors the size where it can. */
export function withExtras<S extends Partial<ExportSettings>>(settings: S, extras: ExportExtras): S {
  return {
    ...settings,
    size: extras.size,
    allowEnlarge: extras.allowEnlarge,
    pngDepth: extras.pngDepth,
    zip: extras.zip,
    maxLongEdge: maxLongEdgeOf(extras),
  };
}

/** The extras the settings carry; settings saved before the fields existed give their long edge and the defaults. */
export function extrasOf(settings: ExportSettings): ExportExtras {
  return {
    size: exportSizeOf(settings),
    allowEnlarge: settings.allowEnlarge === true,
    pngDepth: settings.pngDepth === 8 ? 8 : 16,
    zip: settings.zip !== false,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Extras read back from the setting older presets kept them in: anything unknown falls back to the defaults. */
export function parseExtras(value: unknown): ExportExtras {
  if (!isRecord(value)) return DEFAULT_EXTRAS;
  return {
    size: exportSizeFromJson(isRecord(value.size) && typeof value.size.px === 'number' ? { ...value.size, px: Math.round(value.size.px) } : value.size) ?? {
      mode: 'original',
    },
    allowEnlarge: value.allowEnlarge === true,
    pngDepth: value.pngDepth === 8 ? 8 : 16,
    zip: value.zip !== false,
  };
}

/**
 * The library setting where export presets saved before the fields existed
 * kept their extras. Only read: an old preset's extras come from it.
 */
export function extrasSettingKey(presetId: string): string {
  return `exportPresetExtras.${presetId}`;
}

/** The long edge photos-core's `maxLongEdge` can carry; null unless the size is by long edge without enlarging. */
export function maxLongEdgeOf(extras: ExportExtras): number | null {
  return maxLongEdgeFor(extras.size, extras.allowEnlarge);
}

/**
 * A preset's extras: its own fields, or for a preset saved before they
 * existed, the setting it kept them in.
 */
export function presetExtras(settings: ExportSettings, legacy: unknown): ExportExtras {
  return legacy !== undefined ? parseExtras(legacy) : extrasOf(settings);
}
