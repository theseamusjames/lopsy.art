/**
 * The PhotosBackend on photos-core: the storage adapters, openLibrary, the
 * importer and the export job.
 */

import type { Asset, AssetId, LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { ImportJob, ImportOptions } from '@lopsy/photos-core/import/types';
import type { FileId, StorageAdapter, StorageQuota } from '@lopsy/photos-core/storage/types';
import type { ExportProgress as CoreProgress, ExportResult } from '@lopsy/photos-core/export/types';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { IndexedDbLocalStore } from '@lopsy/photos-core/library/local-store';
import { openBrowserStorage, openPickedFolder } from '@lopsy/photos-core/storage/local-folder-adapter';
import { GoogleDriveAdapter } from '@lopsy/photos-core/storage/google-drive/drive-adapter';
import { IndexedDbUploadSessionStore } from '@lopsy/photos-core/storage/google-drive/upload-sessions';
import { AccountMismatchError, fetchDriveAccountId, GoogleTokenSource } from '@lopsy/photos-core/auth/google-token-source';
import { isStorageError } from '@lopsy/photos-core/storage/errors';
import { resumeImports, startImport } from '@lopsy/photos-core/import/importer';
import { OpfsStagingStore, type StagingStore } from '@lopsy/photos-core/import/staging';
import { IndexedDbImportQueueStore, type ImportQueueStore } from '@lopsy/photos-core/import/queue-store';
import { openAccountCaches, type AccountCaches } from '@lopsy/photos-core/cache/account-caches';
import { LibraryBusyError } from '@lopsy/photos-core/library/lock';
import type { PhotosLibrarySession } from '@lopsy/photos-core/library/session';
import { repairLibrary, type RepairReport } from '@lopsy/photos-core/library/repair';
import { trashLeftoverOriginals } from './trash-assets';
import { startImportFromStorage } from '@lopsy/photos-core/import/from-storage';
import { pickDriveFiles } from '@lopsy/photos-core/storage/google-drive/picker';
import { budgetFor, OriginalsDownload, type KeepOriginals } from '@lopsy/photos-core/cache/keep-originals';
import { PREVIEWS_DEFAULT_BUDGET } from '@lopsy/photos-core/cache/preview-cache';

/** What the Picker offers: photos the importer reads. */
const DRIVE_PICK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/x-fujifilm-raf', 'image/x-adobe-dng', 'application/octet-stream'];
import { createBrowserPreviewRenderer } from '@lopsy/photos-core/import/browser-preview-renderer';
import { startExport } from '@lopsy/photos-core/export/exporter';
import {
  browserStorageChoices,
  storageEnv,
  ConnectCancelled,
  type Connection,
  type ConnectOptions,
  type DeviceInfo,
  type EditPreviews,
  type LoadOriginalOptions,
  type ExportJob,
  type ExportProgress,
  type ExportRequest,
  type PhotosBackend,
  type ReconnectOffer,
  type StorageChoice,
} from '../backend';
import { getExportRenderer, setExportRendererFactory } from '../export-renderer-registry';
import { createEngineExportRenderer, type EngineRenderer } from '../../engine/export-renderer';
import { PreviewRefresher } from '../preview-refresh';
import { useUi } from '../store';
import {
  DRIVE_LABEL,
  describeDevice,
  libraryStoreName,
  loadLastConnection,
  reconnectOffer,
  saveLastConnection,
  uploadSessionStoreName,
} from './connection-memory';
import { ensureReadWrite, loadFolderHandle, pickFolder, saveFolderHandle } from './folder-handle-store';
import { filesToDownload, fromCoreProgress, toExportDestination, toExportSelection, toExportSettings } from './export-mapping';
import { getPreviewSource, setPreviewSource } from './preview-source';
import { storeEditPreviews } from './edit-previews';
import { guardSession, unguarded } from '../guard-session';
import { trashAssets, untrashAssets } from './trash-assets';
import { showErrorToast, showToast } from '../toasts';
import { downloadBlob } from '../download';
import { loadKeepOriginals, saveKeepOriginals } from '../device-settings';
import { developSource } from '../../library/develop-source';

/** What a session needs beyond the LibrarySession itself. */
interface SessionExtras {
  readonly kind: StorageChoice;
  /** The unguarded session, for repair (setOriginalStatus). */
  readonly raw: PhotosLibrarySession;
  /** Drive's ID for the Google account, the folder name or 'opfs'; and what the storage is called. */
  readonly owner: string;
  readonly label: string;
  readonly tokenSource: GoogleTokenSource | null;
  /** Device caches; null for the browser's own storage, whose files are already on the device. */
  readonly caches: AccountCaches | null;
  readonly staging: StagingStore | null;
  readonly queue: ImportQueueStore | null;
}

/**
 * The device-cache folder for a storage: Drive's ID for the account; for a
 * picked folder, the folder's own identity (its storage root id), so two
 * folders (or a copy of one, whose file ids repeat) never share cached
 * previews. Null for the browser's own storage, which needs no cache.
 */
export function cacheAccountId(kind: StorageChoice, owner: string, rootId: string | null = null): string | null {
  if (kind === 'browser') return null;
  if (kind === 'local-folder') {
    if (rootId === null) return null;
    const id = `local-${rootId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    return id.slice(0, 128);
  }
  return /^[A-Za-z0-9_-]{1,128}$/.test(owner) ? owner : null;
}

/** Refuses a token for a different Google account than the library's. The app knows the accounts only by Drive's ID, so it cannot name them. */
export function checkSameAccount(expectedId: string, actualId: string): void {
  if (expectedId !== actualId) {
    throw new Error('You signed in with a different Google account than the one this library is in. Sign in with that account to keep saving.');
  }
}

async function optional<T>(open: () => Promise<T>): Promise<T | null> {
  try {
    return await open();
  } catch (error) {
    console.warn('A device store could not be opened; carrying on without it', error);
    return null;
  }
}

interface Opened {
  readonly adapter: StorageAdapter;
  /** Whose library it is, for the local database's name. */
  readonly owner: string;
  readonly label: string;
  readonly tokenSource: GoogleTokenSource | null;
}

function today(): string {
  const d = new Date();
  return `Export ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hands a finished download export to the browser. */
function downloadResult(result: ExportResult, zip: boolean): void {
  for (const file of filesToDownload(result, zip)) downloadBlob(file.blob, file.name);
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export class RealBackend implements PhotosBackend {
  private readonly extras = new WeakMap<LibrarySession, SessionExtras>();
  /** Storage opened for a library another tab holds, kept so "Use it here" needs no second sign-in. */
  private busy: { readonly kind: StorageChoice; readonly opened: Opened } | null = null;
  /** The open library; exports and Edit in Lopsy read originals through it. */
  private current: LibrarySession | null = null;

  /** Exports and background previews render on the engine (its own hidden canvas), one renderer for the page. */
  private engineRenderer: EngineRenderer | null = null;

  private getEngineRenderer(): EngineRenderer {
    this.engineRenderer ??= createEngineExportRenderer({
      loadOriginal: (asset, signal) => {
        const session = this.current;
        if (!session) return Promise.reject(new Error('No library is open'));
        return this.loadOriginal(session, asset, { signal });
      },
    });
    return this.engineRenderer;
  }

  /** Background previews for edits made outside the Edit view, per open library. */
  private readonly refreshers = new Map<LibrarySession, { refresher: PreviewRefresher; stop: () => void }>();

  constructor() {
    setExportRendererFactory(() => this.getEngineRenderer());
  }

  getPreviewRefresh(session: LibrarySession): PreviewRefresher | null {
    return this.refreshers.get(session)?.refresher ?? null;
  }

  private startPreviewRefresh(session: LibrarySession): void {
    const refresher = new PreviewRefresher({
      source: session,
      render: (asset, version, signal) => this.getEngineRenderer().renderPreviews(asset, version, signal),
      store: (versionId, previews) => this.storeEditPreviews(session, versionId, previews),
      reuse: (versionId, thumb, screen) => {
        session.setPreview(versionId, 'thumb', thumb);
        session.setPreview(versionId, 'screen', screen);
      },
      // The Edit view owns the GPU while it is open.
      isPaused: () => useUi.getState().editing !== null,
    });
    let editing = useUi.getState().editing !== null;
    const unsubscribeUi = useUi.subscribe((state) => {
      const now = state.editing !== null;
      if (now !== editing) {
        editing = now;
        refresher.refresh();
      }
    });
    refresher.start();
    this.refreshers.set(session, {
      refresher,
      stop: () => {
        unsubscribeUi();
        refresher.stop();
      },
    });
  }
  private readonly previewRenderer = createBrowserPreviewRenderer();

  listStorageOptions(): readonly StorageChoice[] {
    return browserStorageChoices(storageEnv());
  }

  async getReconnectOffer(): Promise<ReconnectOffer | null> {
    const last = loadLastConnection();
    const hasHandle = last?.kind === 'local-folder' ? (await loadFolderHandle()) !== null : false;
    return reconnectOffer(last, this.listStorageOptions(), hasHandle);
  }

  async connect(kind: StorageChoice, options: ConnectOptions = {}): Promise<Connection> {
    const reuse = options.takeOver === true && this.busy?.kind === kind ? this.busy.opened : null;
    this.busy = null;
    const opened = reuse ?? (await this.openStorage(kind, options.reconnect === true));
    let rawSession: PhotosLibrarySession;
    try {
      rawSession = await openLibrary({
        adapter: opened.adapter,
        store: new IndexedDbLocalStore(libraryStoreName(kind, opened.owner)),
        deviceName: describeDevice(navigator.userAgent),
        takeOver: options.takeOver === true,
      });
    } catch (error) {
      if (error instanceof LibraryBusyError) this.busy = { kind, opened };
      throw error;
    }
    const session = guardSession(rawSession, (message) => showErrorToast(message));
    const rootId = kind === 'local-folder' ? await opened.adapter.getRoot().then((r) => r.id, () => null) : null;
    const accountId = cacheAccountId(kind, opened.owner, rootId);
    const [caches, staging, queue] = await Promise.all([
      accountId === null ? null : optional(() => openAccountCaches(accountId)),
      optional(() => OpfsStagingStore.open(session.libraryId)),
      optional(() => IndexedDbImportQueueStore.open()),
    ]);
    this.extras.set(session, { kind, raw: rawSession, owner: opened.owner, label: opened.label, tokenSource: opened.tokenSource, caches, staging, queue });
    if (kind === 'google-drive' && caches) void this.applyKeepOriginals(session, loadKeepOriginals()).catch(() => undefined);
    setPreviewSource(caches ? { read: (s, ref) => caches.previews.readPreview(s.adapter, ref.fileId) } : null);
    saveLastConnection({ kind, label: opened.label, ...(kind === 'google-drive' ? { accountId: opened.owner } : {}) });
    this.current = session;
    this.startPreviewRefresh(session);
    return { session, accountLabel: opened.label };
  }

  private async openStorage(kind: StorageChoice, reconnect: boolean): Promise<Opened> {
    switch (kind) {
      case 'browser': {
        const adapter = await openBrowserStorage();
        return { adapter, owner: 'opfs', label: adapter.label, tokenSource: null };
      }
      case 'local-folder': {
        let handle = reconnect ? await loadFolderHandle() : null;
        if (handle && !(await ensureReadWrite(handle))) {
          throw new Error(`Photonamous needs permission to use the folder “${handle.name}”.`);
        }
        if (!handle) {
          handle = await pickFolder();
          if (!handle) throw new ConnectCancelled();
          if (!(await ensureReadWrite(handle))) throw new Error(`Photonamous needs permission to change “${handle.name}”.`);
          await saveFolderHandle(handle).catch(() => undefined);
        }
        const adapter = await openPickedFolder(handle);
        return { adapter, owner: handle.name, label: handle.name, tokenSource: null };
      }
      case 'google-drive': {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) throw new Error('This build has no Google sign-in.');
        // Owned here so the account can be pinned once known: from then on
        // every grant (refreshes, Reconnect) must be for this library's account.
        const last = reconnect ? loadLastConnection() : null;
        const tokenOptions: { clientId: string; expectedAccountId?: string } = { clientId };
        if (last?.kind === 'google-drive' && last.accountId) tokenOptions.expectedAccountId = last.accountId;
        const tokenSource = new GoogleTokenSource(tokenOptions);
        let token: string;
        try {
          token = await tokenSource.requestInteractive();
        } catch (error) {
          if (error instanceof AccountMismatchError) throw error;
          if (isStorageError(error) && error.code === 'auth') {
            throw new Error('Google sign-in did not finish. Photonamous needs access to the files it creates in your Drive.');
          }
          throw error;
        }
        // All the app learns about the account: Drive's opaque ID for it, to keep its data on this device apart.
        const accountId = await fetchDriveAccountId(token);
        tokenOptions.expectedAccountId = accountId;
        const adapter = new GoogleDriveAdapter({
          tokenSource,
          label: DRIVE_LABEL,
          uploadSessions: new IndexedDbUploadSessionStore(uploadSessionStoreName(accountId)),
        });
        return { adapter, owner: accountId, label: DRIVE_LABEL, tokenSource };
      }
    }
  }

  async reauthorize(session: LibrarySession): Promise<void> {
    const extras = this.extras.get(session);
    const tokenSource = extras?.tokenSource;
    if (extras && tokenSource) {
      const token = await tokenSource.requestInteractive();
      // The popup lets the user pick any account; only the library's own may write to it.
      const accountId = await fetchDriveAccountId(token);
      try {
        checkSameAccount(extras.owner, accountId);
      } catch (error) {
        tokenSource.invalidate();
        throw error;
      }
    }
    await session.syncNow();
  }

  startImport(files: readonly File[], session: LibrarySession, options: Partial<ImportOptions> = {}): ImportJob {
    const extras = this.extras.get(session);
    return startImport(files, {
      session: unguarded(session),
      previewRenderer: this.previewRenderer,
      options,
      ...(extras?.queue ? { queueStore: extras.queue } : {}),
      ...(extras?.staging ? { staging: extras.staging } : {}),
    });
  }

  async resumeImports(session: LibrarySession): Promise<ImportJob | null> {
    const extras = this.extras.get(session);
    if (!extras?.queue) return null;
    return resumeImports({
      session: unguarded(session),
      previewRenderer: this.previewRenderer,
      queueStore: extras.queue,
      ...(extras.staging ? { staging: extras.staging } : {}),
    });
  }

  canAddFromDrive(session: LibrarySession): boolean {
    return (
      session.adapter.kind === 'google-drive' &&
      Boolean(import.meta.env.VITE_GOOGLE_API_KEY) &&
      Boolean(import.meta.env.VITE_GOOGLE_APP_ID)
    );
  }

  async addFromDrive(session: LibrarySession, options: { readonly move: boolean }): Promise<ImportJob | null> {
    const extras = this.extras.get(session);
    const developerKey = import.meta.env.VITE_GOOGLE_API_KEY;
    const appId = import.meta.env.VITE_GOOGLE_APP_ID;
    if (!extras?.tokenSource || !developerKey || !appId) throw new Error('Adding from Google Drive is not available here.');
    const ids = await pickDriveFiles({
      developerKey,
      appId,
      oauthToken: await extras.tokenSource.getToken(),
      mimeTypes: DRIVE_PICK_TYPES,
      title: 'Choose photos to add to your library',
    });
    if (ids.length === 0) return null;
    return startImportFromStorage(ids, {
      session: unguarded(session),
      previewRenderer: this.previewRenderer,
      ...(extras.caches ? { originalsCache: extras.caches.originals } : {}),
      options: { move: options.move },
    });
  }

  checkLibrary(session: LibrarySession): Promise<RepairReport> {
    const raw = this.extras.get(session)?.raw;
    if (!raw) return Promise.reject(new Error('No library is open'));
    return repairLibrary(raw);
  }

  addOrphans(session: LibrarySession, fileIds: readonly FileId[]): ImportJob {
    const caches = this.extras.get(session)?.caches;
    return startImportFromStorage(fileIds, {
      session: unguarded(session),
      previewRenderer: this.previewRenderer,
      ...(caches ? { originalsCache: caches.originals } : {}),
      // They are already in Originals/.
      options: { move: false },
    });
  }

  async trashLeftovers(session: LibrarySession, fileIds: readonly FileId[]): Promise<number> {
    return trashLeftoverOriginals(session, fileIds);
  }

  async restoreOriginals(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
    const view = session.getView();
    for (const id of assetIds) {
      const asset = view.assets.get(id);
      if (asset) await session.adapter.untrash(asset.fileId);
    }
  }

  async getDeviceInfo(session: LibrarySession): Promise<DeviceInfo> {
    const caches = this.extras.get(session)?.caches;
    const cacheBytes = caches ? (await caches.originals.cache.usage()) + (await caches.previews.cache.usage()) : null;
    return { deviceName: describeDevice(navigator.userAgent), cacheBytes };
  }

  async clearDeviceCache(session: LibrarySession): Promise<void> {
    const caches = this.extras.get(session)?.caches;
    if (!caches) return;
    // Only the caches: the library's own state and its unsaved changes live elsewhere (IndexedDB).
    for (const cache of [caches.originals.cache, caches.previews.cache]) {
      const used = await cache.usage();
      await cache.setBudget(0);
      const budget = cache === caches.originals.cache ? await budgetFor(this.getKeepOriginals(session) ?? 'recent') : PREVIEWS_DEFAULT_BUDGET;
      await cache.setBudget(Number.isFinite(budget) ? Math.max(used, budget) : budget);
    }
    // All keeps every original: start fetching them again.
    void this.keepState.get(session)?.download?.resume();
  }

  /** Keep originals per open Drive library, and its All download. */
  private readonly keepState = new Map<LibrarySession, { mode: KeepOriginals; download: OriginalsDownload | null }>();

  getKeepOriginals(session: LibrarySession): KeepOriginals | null {
    const extras = this.extras.get(session);
    if (!extras?.caches || extras.kind !== 'google-drive') return null;
    return this.keepState.get(session)?.mode ?? loadKeepOriginals();
  }

  async setKeepOriginals(session: LibrarySession, mode: KeepOriginals): Promise<void> {
    saveKeepOriginals(mode);
    await this.applyKeepOriginals(session, mode);
  }

  getOriginalsDownload(session: LibrarySession): OriginalsDownload | null {
    return this.keepState.get(session)?.download ?? null;
  }

  private async applyKeepOriginals(session: LibrarySession, mode: KeepOriginals): Promise<void> {
    const caches = this.extras.get(session)?.caches;
    if (!caches) return;
    const previous = this.keepState.get(session);
    if (previous?.mode === mode) return;
    previous?.download?.stop();
    const download =
      mode === 'all'
        ? new OriginalsDownload({
            originals: caches.originals,
            adapter: session.adapter,
            list: () =>
              [...session.getView().assets.values()]
                .filter((asset) => !asset.deleted && asset.kind === 'original' && asset.originalStatus !== 'missing')
                .map((asset) => ({ fileId: asset.fileId, sha256: asset.sha256, byteSize: asset.byteSize })),
          })
        : null;
    this.keepState.set(session, { mode, download });
    await caches.originals.cache.setBudget(await budgetFor(mode));
    void download?.resume();
  }

  readPreview(session: LibrarySession, ref: PreviewRef): Promise<Blob> {
    return getPreviewSource().read(session, ref);
  }

  loadOriginal(session: LibrarySession, asset: Asset, options: LoadOriginalOptions = {}): Promise<Blob> {
    // A Lopsy document develops from its flattened render. The library records no checksum for the
    // render, which the originals cache verifies against, so it is read from storage each time.
    if (asset.kind === 'document') {
      const { signal, onProgress } = options;
      return session.adapter.readContent(developSource(asset).fileId, { ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}) });
    }
    const caches = this.extras.get(session)?.caches;
    if (caches) return caches.originals.readOriginal(session.adapter, asset, options);
    return session.adapter.readContent(asset.fileId, options.signal ? { signal: options.signal } : {});
  }

  pinOriginal(session: LibrarySession, asset: Asset): () => void {
    const caches = this.extras.get(session)?.caches;
    if (!caches) return () => {};
    caches.originals.pin(asset.sha256);
    return () => caches.originals.unpin(asset.sha256);
  }

  storeEditPreviews(session: LibrarySession, versionId: VersionId, previews: EditPreviews): Promise<void> {
    return storeEditPreviews(unguarded(session), versionId, previews, this.extras.get(session)?.caches?.previews ?? null);
  }

  trashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
    return trashAssets(session, assetIds);
  }

  untrashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
    return untrashAssets(session, assetIds);
  }

  exportVersions(session: LibrarySession, request: ExportRequest): ExportJob {
    const selection = toExportSelection(session.getView(), request.versionIds);
    const listeners = new Set<() => void>();
    let core: { getProgress(): CoreProgress; cancel(): void } | null = null;
    let cancelled = false;
    let lastCore: CoreProgress | null = null;
    let snapshot: ExportProgress = { total: selection.length, done: 0, failures: [], finished: false };
    const notify = () => {
      for (const l of listeners) l();
    };
    const refresh = () => {
      if (!core) return;
      const p = core.getProgress();
      if (p !== lastCore) {
        lastCore = p;
        snapshot = fromCoreProgress(p);
      }
      notify();
    };
    const fail = (message: string): ExportProgress => {
      snapshot = {
        total: selection.length,
        done: selection.length,
        failures: selection.map((s) => ({ versionId: s.versionId, error: message })),
        finished: true,
      };
      notify();
      return snapshot;
    };

    const finished: Promise<ExportProgress> = getExportRenderer().then(
      async (renderer) => {
        if (cancelled) return fail('Cancelled');
        const job = startExport(selection, {
          session: unguarded(session),
          renderer,
          settings: toExportSettings(request),
          destination: toExportDestination(request, today()),
        });
        core = job;
        const unsubscribe = job.subscribe(refresh);
        refresh();
        const result = await job.finished;
        unsubscribe();
        lastCore = null;
        core = { getProgress: () => result, cancel: () => {} };
        refresh();
        if (request.destination === 'download') downloadResult(result, request.extras?.zip ?? true);
        if (request.destination === 'library' && result.folderId !== null) {
          const folderId = result.folderId;
          const webLink = session.adapter.webLink ? await session.adapter.webLink(folderId).catch(() => null) : null;
          snapshot = { ...snapshot, folder: { id: folderId, name: request.name, webLink } };
          notify();
          if (webLink !== null) {
            const where = session.adapter.kind === 'google-drive' ? 'Drive' : 'storage';
            showToast(`Exported to “${request.name}”. Share it from the sync panel.`, 12_000, {
              label: `Show in ${where}`,
              run: () => window.open(webLink, '_blank', 'noopener'),
            });
          }
        }
        return snapshot;
      },
      (error: unknown) => fail(messageOf(error)),
    );

    return {
      id: `export-${Date.now()}`,
      getProgress: () => snapshot,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      cancel: () => {
        cancelled = true;
        core?.cancel();
      },
      finished,
    };
  }

  getQuota(session: LibrarySession): Promise<StorageQuota> {
    return session.adapter.getQuota();
  }

  async disconnect(session: LibrarySession): Promise<void> {
    this.refreshers.get(session)?.stop();
    this.refreshers.delete(session);
    const tokenSource = this.extras.get(session)?.tokenSource;
    this.keepState.get(session)?.download?.stop();
    this.keepState.delete(session);
    setPreviewSource(null);
    if (this.current === session) this.current = null;
    try {
      await session.close();
    } finally {
      if (tokenSource) {
        await tokenSource.signOut();
        // Signed out: the next visit asks which account again.
        saveLastConnection(null);
      }
    }
  }
}
