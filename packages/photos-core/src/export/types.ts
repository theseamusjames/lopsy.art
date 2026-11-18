/**
 * Export contracts (spec 5.5, 6.11). Rendering needs the engine, so it is
 * injected; naming, metadata, packaging and writing are plain code.
 */

import type { Asset, AssetId, Version, VersionId } from '../library/types';
import type { FileId } from '../storage/types';

export interface ExportSettings {
  readonly format: 'jpeg' | 'png';
  /** JPEG quality, 0 to 1. */
  readonly quality: number;
  /** Longest edge in pixels, never enlarging; null for the full size. */
  readonly maxLongEdge: number | null;
  /** all: camera, exposure, date, copyright (and location unless removed); copyright: Artist and Copyright only; none. */
  readonly metadata: 'all' | 'copyright' | 'none';
  readonly removeLocation: boolean;
  /** Tokens: {name} {date} {seq} {seq:3} {title} {version} {camera}. */
  readonly fileNameTemplate: string;
  readonly copyright?: string;
  readonly creator?: string;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: 'jpeg',
  quality: 0.9,
  maxLongEdge: null,
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
