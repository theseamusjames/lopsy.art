/**
 * Export contracts (spec 5.5, 6.11). Rendering needs the engine, so it is
 * injected; naming, metadata, packaging and writing are plain code.
 */

import type { Asset, AssetId, Version, VersionId } from '../library/types';
import type { FileId } from '../storage/types';

/** 'tiff' is 16-bit, Deflate-compressed, encoded by the engine (`exportTiff16`). */
export type ExportFormat = 'jpeg' | 'png' | 'tiff';

export type ExportColorSpace = 'srgb' | 'display-p3' | 'rec2020';

export interface ExportSettings {
  readonly format: ExportFormat;
  /** Absent means sRGB. Rec. 2020 only with a 16-bit format (`colorSpacesFor`). */
  readonly colorSpace?: ExportColorSpace;
  /** JPEG quality, 0 to 1. */
  readonly quality: number;
  /**
   * Longest edge in pixels, never enlarging; null for the full size. Kept
   * for settings saved before `size`; when `size` is set it wins, and
   * `maxLongEdge` mirrors it where it can (a long edge without enlarging).
   */
  readonly maxLongEdge: number | null;
  /** The output size (export/size.ts). Absent: what `maxLongEdge` says. */
  readonly size?: ExportSize;
  /** Whether a photo smaller than `size` is scaled up. Default false. */
  readonly allowEnlarge?: boolean;
  /** PNG only: bits per channel. Default 16. */
  readonly pngDepth?: 8 | 16;
  /** Download only: several files packed into one zip. Default true. */
  readonly zip?: boolean;
  /** all: camera, exposure, date, copyright (and location unless removed); copyright: Artist and Copyright only; none. */
  readonly metadata: 'all' | 'copyright' | 'none';
  readonly removeLocation: boolean;
  /** Tokens: {name} {date} {seq} {seq:3} {title} {version} {camera}. */
  readonly fileNameTemplate: string;
  readonly copyright?: string;
  readonly creator?: string;
}

import { exportSizeFromJson, sizeProblem, type ExportSize } from './size';

const MIME_TYPES: Readonly<Record<ExportFormat, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
};

/** The media type of an exported file. */
export function mimeTypeFor(format: ExportFormat): string {
  return MIME_TYPES[format];
}

/** Whether the format keeps 16 bits per channel. */
export function isSixteenBit(format: ExportFormat): boolean {
  return format === 'tiff';
}

/** The colour spaces offered for a format: Rec. 2020 bands badly in 8 bits, so it needs a 16-bit format. */
export function colorSpacesFor(format: ExportFormat): readonly ExportColorSpace[] {
  return isSixteenBit(format) ? ['srgb', 'display-p3', 'rec2020'] : ['srgb', 'display-p3'];
}

/**
 * Whether an export with these settings carries the photo's GPS location
 * (spec 6.13 removes it by default). A synced export preset may turn this
 * on; the UI should say "Location will be kept" whenever it is true.
 */
export function exportKeepsLocation(settings: Pick<ExportSettings, 'metadata' | 'removeLocation'>): boolean {
  return settings.metadata === 'all' && !settings.removeLocation;
}

/** Why the settings cannot be used, or null when they can. */
export function exportSettingsProblem(settings: ExportSettings): string | null {
  const space = settings.colorSpace ?? 'srgb';
  if (!colorSpacesFor(settings.format).includes(space)) return 'Rec. 2020 needs a 16-bit format (TIFF).';
  if (!(settings.quality >= 0 && settings.quality <= 1)) return 'Quality must be between 0 and 1.';
  if (settings.maxLongEdge !== null && !(Number.isInteger(settings.maxLongEdge) && settings.maxLongEdge > 0)) {
    return 'The long edge must be a whole number of pixels.';
  }
  if (settings.size !== undefined && exportSizeFromJson(settings.size) === null) return sizeProblem(settings.size);
  if (settings.pngDepth !== undefined && settings.pngDepth !== 8 && settings.pngDepth !== 16) return 'PNG depth must be 8 or 16 bits.';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Export settings read back from storage (an export preset): unknown or
 * invalid values fall back to the defaults, and a colour space the
 * format cannot carry falls back to sRGB.
 */
export function exportSettingsFromJson(value: unknown): ExportSettings {
  const v = isRecord(value) ? value : {};
  const d = DEFAULT_EXPORT_SETTINGS;
  const format: ExportFormat = v.format === 'png' || v.format === 'tiff' ? v.format : 'jpeg';
  const space = v.colorSpace === 'display-p3' || v.colorSpace === 'rec2020' ? v.colorSpace : 'srgb';
  const quality = typeof v.quality === 'number' && v.quality >= 0 && v.quality <= 1 ? v.quality : d.quality;
  const edge = v.maxLongEdge;
  const maxLongEdge = typeof edge === 'number' && Number.isInteger(edge) && edge > 0 && edge <= 100_000 ? edge : null;
  return {
    format,
    colorSpace: colorSpacesFor(format).includes(space) ? space : 'srgb',
    quality,
    maxLongEdge,
    // Settings saved before these fields: the size is what the long edge said.
    size: exportSizeFromJson(v.size) ?? (maxLongEdge !== null ? { mode: 'long', px: maxLongEdge } : { mode: 'original' }),
    allowEnlarge: v.allowEnlarge === true,
    pngDepth: v.pngDepth === 8 ? 8 : 16,
    zip: v.zip !== false,
    metadata: v.metadata === 'copyright' || v.metadata === 'none' ? v.metadata : 'all',
    removeLocation: typeof v.removeLocation === 'boolean' ? v.removeLocation : d.removeLocation,
    fileNameTemplate:
      typeof v.fileNameTemplate === 'string' && v.fileNameTemplate.length <= 200 ? v.fileNameTemplate : d.fileNameTemplate,
    ...(typeof v.copyright === 'string' ? { copyright: v.copyright.slice(0, 500) } : {}),
    ...(typeof v.creator === 'string' ? { creator: v.creator.slice(0, 500) } : {}),
  };
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'jpeg',
  quality: 0.9,
  maxLongEdge: null,
  size: { mode: 'original' },
  allowEnlarge: false,
  pngDepth: 16,
  zip: true,
  metadata: 'all',
  removeLocation: true,
  fileNameTemplate: '{name}',
};

export type ExportDestination =
  /** `Exports/<folderName>/` in the library's storage. */
  | { readonly kind: 'library'; readonly folderName: string }
  /** Blobs handed back to the app; several are also packed into one zip. */
  | { readonly kind: 'download'; readonly zipName?: string };

/** Renders a version at the settings' size and format. The app implements it with the engine. */
export interface ExportRenderer {
  render(asset: Asset, version: Version, settings: ExportSettings, signal: AbortSignal): Promise<Blob>;
}

export type ExportItemState = 'queued' | 'rendering' | 'writing' | 'done' | 'failed';

export interface ExportItem {
  readonly id: string;
  readonly assetId: AssetId;
  readonly versionId: VersionId;
  readonly state: ExportItemState;
  /** Chosen when the item is written. */
  readonly fileName: string | null;
  readonly byteSize: number | null;
  /** The written file, for library exports. */
  readonly fileId: FileId | null;
  readonly error: string | null;
}

export interface ExportProgress {
  readonly items: readonly ExportItem[];
  readonly finished: boolean;
}

export interface ExportedFile {
  readonly name: string;
  readonly blob: Blob;
}

export interface ExportResult extends ExportProgress {
  /** Download exports: every file written, in selection order. */
  readonly files: readonly ExportedFile[];
  /** Download exports of more than one file: all of them in one stored zip. */
  readonly zip: ExportedFile | null;
  /** Library exports: the `Exports/<folderName>/` folder, once created. */
  readonly folderId: FileId | null;
}

export interface ExportJob {
  readonly id: string;
  getProgress(): ExportProgress;
  subscribe(listener: () => void): () => void;
  cancel(): void;
  /** Resolves when every item has finished or failed. */
  readonly finished: Promise<ExportResult>;
}
