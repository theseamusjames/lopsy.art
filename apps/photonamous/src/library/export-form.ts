/** What the Export dialog offers and says about photos-core's ExportSettings. Pure. */

import {
  canEnlarge,
  colorSpacesFor,
  exportKeepsLocation,
  isAlwaysFullSize,
  isHdrFormat,
  type ExportColorSpace,
  type ExportFormat,
  type ExportSettings,
} from '@lopsy/photos-core/export/types';
import { maxLongEdgeOf, type ExportExtras, type SizeSpec } from './export-size';

/**
 * The colour spaces the dialog offers for a format: sRGB and Display P3
 * always, Rec. 2020 too for a 16-bit file (TIFF, 16-bit PNG), which the
 * engine renders straight into that space and tags (`exportPng16`,
 * `exportTiff16`).
 */
export function offeredColorSpaces(format: ExportFormat, pngDepth: 8 | 16 = 16): ExportColorSpace[] {
  return [...colorSpacesFor(format, pngDepth)];
}

export const COLOR_SPACE_WORDS: Readonly<Record<ExportColorSpace, string>> = {
  srgb: 'sRGB — for screens and the web',
  'display-p3': 'Display P3 — wider colour, for recent screens',
  rec2020: 'Rec. 2020 — widest, for 16-bit files',
};

/** Whether the exported files will say where the photos were taken. The engine's TIFF carries no EXIF, so never for TIFF. */
export function locationKept(settings: ExportSettings): boolean {
  return settings.format !== 'tiff' && exportKeepsLocation(settings);
}

export type HdrFormat = 'hdr-png' | 'hdr-jpeg';

/**
 * The dialog's words for the HDR formats: what each is, which programs it
 * is designed to show in HDR, and what the others show. None has been
 * checked by a person on an HDR display yet (plan decisions 13 to 15), so
 * each says what the format is made for, not what will happen.
 */
export const HDR_FORMAT_WORDS: Readonly<Record<HdrFormat, { readonly label: string; readonly help: string }>> = {
  'hdr-jpeg': {
    label: 'HDR JPEG (gain map)',
    help:
      'An ordinary JPEG in every program, with a gain map that Chrome, Edge, Safari 26 and Android are designed to use to show the highlights in HDR. The one to send to people.',
  },
  'hdr-png': {
    label: 'HDR PNG (16-bit, PQ)',
    help:
      '16-bit Rec. 2020 with the HDR (PQ) curve, made for HDR viewers such as Safari 26. Programs that do not read its HDR tag show it with flat, dull colours.',
  },
};

/** The order the dialog lists the HDR formats in: the one that opens everywhere first. */
export const HDR_FORMATS: readonly HdrFormat[] = ['hdr-jpeg', 'hdr-png'];

/** What the Colours field says for a format that has no choice of space; null when it offers one. */
export function fixedColorWords(format: ExportFormat): string | null {
  if (format === 'hdr-png') return 'Rec. 2020, HDR (PQ)';
  if (format === 'hdr-jpeg') return 'sRGB, with the HDR gain map';
  return null;
}

/**
 * Why the HDR formats are not offered, or null when they are: they need
 * the engine's float working space, which the 8-bit fallback lacks.
 */
export function hdrUnavailableReason(isEightBit: boolean): string | null {
  return isEightBit ? 'HDR files are not available: this GPU cannot render in floating point.' : null;
}

/** Settings and extras made consistent: a colour space the format can carry, TIFF at full size, HDR files never enlarged. */
export function fitExportChoices(settings: ExportSettings, extras: ExportExtras): { settings: ExportSettings; extras: ExportExtras } {
  const space = settings.colorSpace ?? 'srgb';
  const offered = offeredColorSpaces(settings.format, extras.pngDepth);
  const fitted = offered.includes(space) ? settings : { ...settings, colorSpace: offered[0] ?? 'srgb' };
  const ex = isAlwaysFullSize(settings.format)
    ? { ...extras, size: { mode: 'original' as const }, allowEnlarge: false }
    : canEnlarge(settings.format)
      ? extras
      : { ...extras, allowEnlarge: false };
  return { settings: { ...fitted, maxLongEdge: maxLongEdgeOf(ex) }, extras: ex };
}

/**
 * What the dialog's Size field offers for a format: whether the size can
 * be chosen, whether "Don't enlarge" is offered, and the line said under
 * it. HDR files can be made smaller but never larger than the photo (the
 * engine reduces the HDR picture but cannot enlarge it).
 */
export function sizeChoicesFor(
  format: ExportFormat,
  mode: SizeSpec['mode'],
): { readonly canChoose: boolean; readonly offersEnlarge: boolean; readonly note: string | null } {
  if (isAlwaysFullSize(format)) {
    return { canChoose: false, offersEnlarge: false, note: 'TIFF is always the full size. It keeps no camera details (EXIF).' };
  }
  if (isHdrFormat(format)) {
    return {
      canChoose: true,
      offersEnlarge: false,
      note: mode === 'original' ? null : 'HDR files are never enlarged: a photo smaller than this stays as it is.',
    };
  }
  return { canChoose: true, offersEnlarge: mode !== 'original', note: null };
}
