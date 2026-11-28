/**
 * Import contracts (spec 5.3, 6.8). Metadata and embedded previews are read
 * from the file's bytes by pure code that runs in a worker or in Node.
 * Rendering thumbnails needs the browser, so it is injected.
 */

import type { AssetId, CameraInfo, ExposureInfo, GpsInfo, ImageFormat } from '../library/types';

export interface ImageMetadata {
  readonly format: ImageFormat;
  readonly mimeType: string;
  /** Oriented size, when the file says. */
  readonly width: number | null;
  readonly height: number | null;
  /** EXIF orientation, 1 to 8; 1 when absent. */
  readonly orientation: number;
  /** DateTimeOriginal as 'YYYY-MM-DDTHH:mm:ss', with the offset appended when the file has one. */
  readonly capturedAt: string | null;
  readonly camera: CameraInfo | null;
  readonly lens: string | null;
  readonly exposure: ExposureInfo | null;
  readonly gps: GpsInfo | null;
}

export interface EmbeddedPreview {
  /** A JPEG the camera stored in the file (or the file itself for a JPEG). */
  readonly blob: Blob;
  /** Size as decoded with the blob's own orientation applied, before `orientation`. */
  readonly width: number | null;
  readonly height: number | null;
  /**
   * EXIF orientation still to apply when showing the preview. Camera
   * previews are usually stored unrotated.
   *
   * Relative to a decode that applies the blob's own EXIF orientation, as
   * browsers do (`<img>`, `createImageBitmap`'s default 'from-image'): a
   * RAF's JPEG carries the camera's tag, so this is 1 for it; a DNG
   * preview usually has no EXIF, so this is IFD0's orientation.
   */
  readonly orientation: number;
}

export interface InspectedImage {
  readonly metadata: ImageMetadata;
  readonly preview: EmbeddedPreview | null;
}

/** Renders a downscaled JPEG. The browser implementation uses createImageBitmap and OffscreenCanvas. */
export interface PreviewRenderer {
  render(
    source: Blob,
    maxSize: number,
    orientation: number,
  ): Promise<{ readonly blob: Blob; readonly width: number; readonly height: number }>;
}

export type ImportItemState =
  | 'queued'
  | 'reading'
  /** Copied into staging on this device, waiting to upload (spec 6.8). */
  | 'staged'
  | 'duplicate'
  | 'unsupported'
  | 'uploading'
  | 'verifying'
  | 'done'
  | 'failed'
  /** The JPEG half of a RAW+JPEG pair, left out because `rawPlusJpeg` is 'raw-only'. */
  | 'skipped';

export interface ImportItem {
  readonly id: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly state: ImportItemState;
  readonly sentBytes: number;
  readonly assetId: AssetId | null;
  readonly error: string | null;
}

export interface ImportProgress {
  readonly items: readonly ImportItem[];
  readonly finished: boolean;
  /**
   * The storage refused the sign-in (an expired or refused token) and no
   * new one can be had without the person: the job waits, nothing failed,
   * and it carries on by itself once `ImportContext.authorization` says a
   * new token was taken (the UI's Reconnect). Absent means false.
   */
  readonly needsSignIn?: boolean;
}

/** Says when the storage's sign-in has a new token; a job waiting for sign-in then carries on. */
export interface AuthorizationSignal {
  subscribe(listener: () => void): () => void;
}

export interface ImportOptions {
  /** Skip files whose SHA-256 is already in the library. Default true. */
  readonly skipDuplicates: boolean;
  /** For RAW+JPEG pairs: keep both (paired) or only the RAW. Default 'both'. */
  readonly rawPlusJpeg: 'both' | 'raw-only';
  /** How many files upload at once. Default 3. */
  readonly concurrency: number;
  /**
   * Apply `.xmp` sidecars found next to photos in the batch (ratings,
   * labels, keywords, title, caption, basic edits). Default true. The
   * sidecars themselves are never imported as photos.
   */
  readonly applySidecars?: boolean;
  /**
   * A saved or built-in edit preset (library/presets.ts) the new versions
   * start from. Ignored when the import is given a `recipe` directly, or
   * when no such preset exists.
   */
  readonly presetId?: string;
}

export interface ImportJob {
  readonly id: string;
  getProgress(): ImportProgress;
  subscribe(listener: () => void): () => void;
  /** Stops for good: unfinished items fail as cancelled and their staged copies are deleted. */
  cancel(): void;
  /**
   * Stops for now: in-flight uploads are aborted, and unfinished items stay
   * in the queue store for `resumeImports` (shown as 'queued', error
   * 'Paused'). Without a queue store it is the same as `cancel`.
   */
  pause(): void;
  /**
   * Resolves when every item has finished, failed or been skipped, or the
   * job was paused. A job waiting for sign-in (`needsSignIn`) has not
   * finished: it waits, however long, for a token or for pause or cancel.
   */
  readonly finished: Promise<ImportProgress>;
}
