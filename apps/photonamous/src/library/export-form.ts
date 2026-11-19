/** What the Export dialog offers and says about photos-core's ExportSettings. Pure. */

import { colorSpacesFor, exportKeepsLocation, type ExportColorSpace, type ExportFormat, type ExportSettings } from '@lopsy/photos-core/export/types';

/**
 * The colour spaces the dialog offers for a format. Rec. 2020 is left out:
 * photos-core allows it with 16 bits, but the engine encodes sRGB and
 * Display P3 only (`exportPng16`, `exportTiff16`).
 */
export function offeredColorSpaces(format: ExportFormat): ExportColorSpace[] {
  return colorSpacesFor(format).filter((space) => space !== 'rec2020');
}

export const COLOR_SPACE_WORDS: Readonly<Record<ExportColorSpace, string>> = {
  srgb: 'sRGB — for screens and the web',
  'display-p3': 'Display P3 — wider colour, for recent screens',
  rec2020: 'Rec. 2020 — widest, 16-bit only',
};

/** Whether the exported files will say where the photos were taken. The engine's TIFF carries no EXIF, so never for TIFF. */
export function locationKept(settings: ExportSettings): boolean {
  return settings.format !== 'tiff' && exportKeepsLocation(settings);
}
