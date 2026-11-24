/** What the Export dialog offers and says about photos-core's ExportSettings. Pure. */

import { colorSpacesFor, exportKeepsLocation, type ExportColorSpace, type ExportFormat, type ExportSettings } from '@lopsy/photos-core/export/types';

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
