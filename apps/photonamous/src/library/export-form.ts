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
