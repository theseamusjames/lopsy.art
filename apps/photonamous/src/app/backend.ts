/**
 * The one seam between the UI and everything behind it (storage, the
 * library database, import, export). The UI starts through this
 * interface and then talks to the `LibrarySession` it returns. The real
 * implementation wraps photos-core; `fake-backend.ts` is a development
 * double. `backend-registry.ts` picks one.
 */

import type { DrivePicker } from '../import/drive-picker';
import type { Asset, AssetId, LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { KeepOriginals, OriginalsDownload } from '@lopsy/photos-core/cache/keep-originals';
import type { PreviewRefresher } from './preview-refresh';
import type { ImportJob, ImportOptions } from '@lopsy/photos-core/import/types';
import type { InterruptedImport } from '@lopsy/photos-core/import/interrupted';
import type { FileId, StorageQuota } from '@lopsy/photos-core/storage/types';
import type { RepairReport } from '@lopsy/photos-core/library/repair';
import type { ExportExtras } from '../library/export-size';
import type { ExportColorSpace, ExportFormat as CoreExportFormat, ExportSettings } from '@lopsy/photos-core/export/types';

/** Where a library can live, as offered on the start screen. */
export type StorageChoice = 'google-drive' | 'browser' | 'local-folder';

export interface Connection {
  readonly session: LibrarySession;
  /** The account email, "This browser" or the folder's name. Settings shows it; the header does unless it is an email. */
  readonly accountLabel: string;
}

export interface LoadOriginalOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (loadedBytes: number, totalBytes: number | null) => void;
}

/** What the Edit view renders when edits settle. */
export interface EditPreviews {
  readonly thumb: Blob;
  readonly screen: Blob;
  readonly recipeHash: string;
}

export interface DeviceInfo {
  readonly deviceName: string;
  /** Bytes in the caches of originals and previews; null when this storage keeps none (it is on the device already). */
  readonly cacheBytes: number | null;
}

export type ExportFormat = CoreExportFormat;

export interface ExportRequest {
  readonly versionIds: readonly VersionId[];
  readonly format: ExportFormat;
  /** Absent means sRGB. */
  readonly colorSpace?: ExportColorSpace;
  /** The preset the dialog started from: its metadata and naming choices carry over. */
  readonly base?: ExportSettings;
  /** 1 to 100; JPEG only. */
  readonly quality: number;
  /** Longest edge in px, never enlarging; null for full size. */
  readonly longEdge: number | null;
  /** 'library': the library's Exports folder; 'download': the browser's downloads. */
  readonly destination: 'library' | 'download';
  /** Size by short edge or megapixels, enlarging, PNG depth, zip or not (library/export-size.ts). */
  readonly extras?: ExportExtras;
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
  /** A finished export into the library: its folder under Exports, for Show in Drive and sharing. */
  readonly folder?: ExportFolder;
}

export interface ExportFolder {
  readonly id: FileId;
  /** Its name under Exports. */
  readonly name: string;
  /** Its page in the storage's web UI; null when the storage has none. */
  readonly webLink: string | null;
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
  /** Take the library over from another tab that has it open. */
  readonly takeOver?: boolean;
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

  /** Whether "Add from Google Drive" can be offered (Drive storage). */
  canAddFromDrive(session: LibrarySession): boolean;

  /** Whether Google's Picker can be shown in the page (a Picker key in this build). In a window of its own it always can. */
  canPickDriveInPage(session: LibrarySession): boolean;

  /**
   * Opens Google's Picker, in the page or in a window of its own
   * (`src/import/drive-picker.ts`), and imports the picked files; null
   * when nothing was picked. Call it straight from a click: the window is
   * a pop-up, which a browser allows only then. `signal` closes the
   * Picker in the page.
   */
  addFromDrive(
    session: LibrarySession,
    options: { readonly move: boolean; readonly picker: DrivePicker; readonly signal?: AbortSignal },
  ): Promise<ImportJob | null>;

  /** Checks every original against storage and marks the ones that are missing, trashed or changed. */
  checkLibrary(session: LibrarySession): Promise<RepairReport>;

  /** Adds originals found in storage that the library has no entry for (they stay where they are). */
  addOrphans(session: LibrarySession, fileIds: readonly FileId[]): ImportJob;

  /**
   * Moves originals of deleted photos (a repair's `leftovers`) to the
   * storage's trash. Files that still belong to a photo in the library are
   * left alone. Resolves with how many were moved.
   */
  trashLeftovers(session: LibrarySession, fileIds: readonly FileId[]): Promise<number>;

  /** Takes trashed originals back out of the storage's trash. */
  restoreOriginals(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void>;

  /** This device: its name and what its caches hold (null when it keeps no cache). */
  getDeviceInfo(session: LibrarySession): Promise<DeviceInfo>;

  /** Empties this device's caches of originals and previews; changes waiting to be saved are kept. */
  clearDeviceCache(session: LibrarySession): Promise<void>;

  /** Keep originals (spec 5.7); null when this storage's originals are on the device anyway. */
  getKeepOriginals(session: LibrarySession): KeepOriginals | null;

  /** Saves the choice for this device and applies it (All starts downloading). */
  setKeepOriginals(session: LibrarySession, mode: KeepOriginals): Promise<void>;

  /** The background download of every original while Keep originals is All; null otherwise. */
  getOriginalsDownload(session: LibrarySession): OriginalsDownload | null;

  /** Continues imports a reload interrupted, as one job; null when there are none. */
  resumeImports(session: LibrarySession): Promise<ImportJob | null>;

  /**
   * What a reload left of imports whose files were never staged on this
   * device: one summary, cleared once nothing is missing. Choosing the
   * same files again (startImport) imports only what is missing. Null when
   * there is none.
   */
  getInterruptedImport(session: LibrarySession): Promise<InterruptedImport | null>;

  /** Forgets the interrupted imports' summary. */
  dismissInterruptedImport(session: LibrarySession): Promise<void>;

  /** A stored preview's JPEG. */
  readPreview(session: LibrarySession, ref: PreviewRef): Promise<Blob>;

  /** The original file, from the device cache or downloaded (with progress). */
  loadOriginal(session: LibrarySession, asset: Asset, options?: LoadOriginalOptions): Promise<Blob>;

  /** Keeps the original in the device cache while it is open in Edit. Returns the release. */
  pinOriginal(session: LibrarySession, asset: Asset): () => void;

  /** Background previews for versions changed outside the Edit view; null when this backend has none. */
  getPreviewRefresh(session: LibrarySession): PreviewRefresher | null;

  /** Stores the Edit view's rendered previews as the version's thumb and screen, replacing the old ones. */
  storeEditPreviews(session: LibrarySession, versionId: VersionId, previews: EditPreviews): Promise<void>;

  /** Tombstones the assets and moves their original files to the storage's trash. */
  trashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void>;

  /** Undoes trashAssets: the photos and their files come back. */
  untrashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void>;

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

/** What decides the storage a build offers. */
export interface StorageEnv {
  /** `VITE_GOOGLE_CLIENT_ID`; without it there is no Google sign-in. */
  readonly googleClientId: string | undefined;
  /** Whether libraries kept on this computer (this browser, a picked folder) are offered. */
  readonly localLibraries: boolean;
}

/**
 * This build's storage settings. Libraries on this computer are for
 * development and tests: storage the browser may clear is too easily lost
 * for a photo library, so a production build offers cloud storage only,
 * unless it was built with `VITE_LOCAL_LIBRARIES=true` (the site tests are).
 */
export function storageEnv(): StorageEnv {
  return {
    googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    localLibraries: import.meta.env.DEV || import.meta.env.VITE_LOCAL_LIBRARIES === 'true',
  };
}

/** Choices this build offers and the browser can support, before any backend is asked. */
export function browserStorageChoices(env: StorageEnv): StorageChoice[] {
  const choices: StorageChoice[] = [];
  if (env.googleClientId) choices.push('google-drive');
  if (!env.localLibraries) return choices;
  if (typeof navigator !== 'undefined' && navigator.storage && 'getDirectory' in navigator.storage) {
    choices.push('browser');
  }
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) choices.push('local-folder');
  return choices;
}
