/**
 * The one seam between the UI and everything behind it (storage, the
 * library database, import, export). The UI starts through this
 * interface and then talks to the `LibrarySession` it returns. The real
 * implementation wraps photos-core; `fake-backend.ts` is a development
 * double. `backend-registry.ts` picks one.
 */

import type { AssetId, LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { ImportJob, ImportOptions } from '@lopsy/photos-core/import/types';
import type { StorageQuota } from '@lopsy/photos-core/storage/types';

/** Where a library can live, as offered on the start screen. */
export type StorageChoice = 'google-drive' | 'browser' | 'local-folder';

export interface Connection {
  readonly session: LibrarySession;
  /** For the header: the account email, "This browser" or the folder's name. */
  readonly accountLabel: string;
}

export type ExportFormat = 'jpeg' | 'png';

export interface ExportRequest {
  readonly versionIds: readonly VersionId[];
  readonly format: ExportFormat;
  /** 1 to 100; JPEG only. */
  readonly quality: number;
  /** Longest edge in px, never enlarging; null for full size. */
  readonly longEdge: number | null;
  /** 'library': the library's Exports folder; 'download': the browser's downloads. */
  readonly destination: 'library' | 'download';
  /** The export's name; its folder under Exports. */
  readonly name: string;
}

export interface ExportFailure {
  readonly versionId: VersionId;
  readonly error: string;
}

export interface ExportProgress {
  readonly total: number;
  readonly done: number;
  readonly failures: readonly ExportFailure[];
  readonly finished: boolean;
}

export interface ExportJob {
  readonly id: string;
  getProgress(): ExportProgress;
  subscribe(listener: () => void): () => void;
  cancel(): void;
  readonly finished: Promise<ExportProgress>;
}

/** The last storage used, offered again on the start screen. */
export interface ReconnectOffer {
  readonly kind: StorageChoice;
  /** The account email or folder name. */
  readonly label: string;
  /** Open it at once without a click (nothing needs the user's permission). */
  readonly automatic: boolean;
}

export interface ConnectOptions {
  /** Reopen the last storage of this kind (the saved folder, the last Google account) instead of asking afresh. */
  readonly reconnect?: boolean;
}

export interface PhotosBackend {
  /** The storage choices this browser and build can offer, in display order. */
  listStorageOptions(): readonly StorageChoice[];

  /** What to offer to reopen, from the last visit. */
  getReconnectOffer(): Promise<ReconnectOffer | null>;

  /**
   * Opens (or creates) the library in that storage. May show a sign-in
   * popup, a folder picker or a permission prompt, so call it from a user
   * gesture. Rejects with an Error whose message the start screen shows;
   * a cancelled picker rejects with `ConnectCancelled`.
   */
  connect(kind: StorageChoice, options?: ConnectOptions): Promise<Connection>;

  /**
   * Asks the user to sign in again when sync is paused for it (Drive), then
   * syncs. Call from a click.
   */
  reauthorize(session: LibrarySession): Promise<void>;

  /** Starts importing files into the library. Each photo appears in the view as soon as it is read. */
  startImport(files: readonly File[], session: LibrarySession, options?: Partial<ImportOptions>): ImportJob;

  /** A stored preview's JPEG. */
  readPreview(session: LibrarySession, ref: PreviewRef): Promise<Blob>;

  /** Tombstones the assets and moves their original files to the storage's trash. */
  trashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void>;

  /** Renders and writes the versions. */
  exportVersions(session: LibrarySession, request: ExportRequest): ExportJob;

  /** Storage used and available (session.adapter.getQuota()). */
  getQuota(session: LibrarySession): Promise<StorageQuota>;

  /** Closes the session and forgets the sign-in on this device. */
  disconnect(session: LibrarySession): Promise<void>;
}

/** The user closed the picker or popup; the start screen just stays. */
export class ConnectCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'ConnectCancelled';
  }
}

/** Choices the browser itself can support, before any backend is asked. */
export function browserStorageChoices(env: { readonly googleClientId: string | undefined }): StorageChoice[] {
  const choices: StorageChoice[] = [];
  if (env.googleClientId) choices.push('google-drive');
  if (typeof navigator !== 'undefined' && navigator.storage && 'getDirectory' in navigator.storage) {
    choices.push('browser');
  }
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) choices.push('local-folder');
  return choices;
}
