/** The Export dialog's choices and photos-core's ExportSettings, both ways. Pure. */

import { colorSpacesFor, DEFAULT_EXPORT_SETTINGS, type ExportColorSpace, type ExportFormat, type ExportSettings } from '@lopsy/photos-core/export/types';

export interface ExportForm {
  readonly format: ExportFormat;
  /** 1 to 100. */
  readonly quality: number;
  readonly longEdge: number | null;
  readonly colorSpace: ExportColorSpace;
}

export const DEFAULT_EXPORT_FORM: ExportForm = { format: 'jpeg', quality: 90, longEdge: null, colorSpace: 'srgb' };

export function formFromSettings(settings: ExportSettings): ExportForm {
  return {
    format: settings.format,
    quality: Math.round(Math.min(1, Math.max(0.01, settings.quality)) * 100),
    longEdge: settings.maxLongEdge,
    colorSpace: settings.colorSpace ?? 'srgb',
  };
}

/** The colour space, made valid for the format (Rec. 2020 needs 16 bits). */
export function fitColorSpace(form: ExportForm): ExportForm {
  return colorSpacesFor(form.format).includes(form.colorSpace) ? form : { ...form, colorSpace: 'srgb' };
}

/** Settings to save as a preset; what the form does not show keeps the defaults. */
export function settingsFromForm(form: ExportForm, base: ExportSettings = DEFAULT_EXPORT_SETTINGS): ExportSettings {
  const fitted = fitColorSpace(form);
  return {
    ...base,
    format: fitted.format,
    quality: Math.min(1, Math.max(0.01, fitted.quality / 100)),
    maxLongEdge: fitted.longEdge,
    colorSpace: fitted.colorSpace,
  };
}

export const COLOR_SPACE_WORDS: Readonly<Record<ExportColorSpace, string>> = {
  srgb: 'sRGB — for screens and the web',
  'display-p3': 'Display P3 — wider colour, for recent screens',
  rec2020: 'Rec. 2020 — widest, 16-bit only',
};
