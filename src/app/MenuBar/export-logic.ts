/**
 * Export logic — pure functions for computing export parameters.
 * No DOM, no React, fully unit-testable.
 */

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp';

export interface ExportOptions {
  format: ExportFormat;
  quality: number; // 1–100
  highQuality: boolean; // PNG: true = 16-bit, false = 8-bit
  filename: string;
}

/** Formats that support lossy quality settings. */
export const LOSSY_FORMATS: ReadonlySet<ExportFormat> = new Set(['jpeg', 'webp']);

/** Whether a format's quality slider should be shown. */
export function isLossyFormat(format: ExportFormat): boolean {
  return LOSSY_FORMATS.has(format);
}

/** Clamp quality to valid range. Quality is irrelevant for lossless formats. */
export function normaliseQuality(quality: number, format: ExportFormat): number {
  if (!isLossyFormat(format)) return 100;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

/** Convert quality 1–100 to 0–1 for canvas API. */
export function qualityToFraction(quality: number): number {
  return quality / 100;
}

export const FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export const FORMAT_EXT: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  bmp: 'bmp',
};

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  bmp: 'BMP',
};
