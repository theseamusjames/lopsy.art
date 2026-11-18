/**
 * The PhotosBackend on photos-core: the storage adapters, openLibrary, the
 * importer and the export job.
 */

import type { Asset, AssetId, LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { ImportJob, ImportOptions } from '@lopsy/photos-core/import/types';
import type { StorageAdapter, StorageQuota } from '@lopsy/photos-core/storage/types';
import type { ExportProgress as CoreProgress, ExportResult } from '@lopsy/photos-core/export/types';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { IndexedDbLocalStore } from '@lopsy/photos-core/library/local-store';
import { openBrowserStorage, openPickedFolder } from '@lopsy/photos-core/storage/local-folder-adapter';
import { GoogleDriveAdapter } from '@lopsy/photos-core/storage/google-drive/drive-adapter';
import { IndexedDbUploadSessionStore } from '@lopsy/photos-core/storage/google-drive/upload-sessions';
import { fetchGoogleAccount, GoogleTokenSource } from '@lopsy/photos-core/auth/google-token-source';
import { isStorageError } from '@lopsy/photos-core/storage/errors';
import { resumeImports, startImport } from '@lopsy/photos-core/import/importer';
import { OpfsStagingStore, type StagingStore } from '@lopsy/photos-core/import/staging';
import { IndexedDbImportQueueStore, type ImportQueueStore } from '@lopsy/photos-core/import/queue-store';
import { openAccountCaches, type AccountCaches } from '@lopsy/photos-core/cache/account-caches';
import { LibraryBusyError } from '@lopsy/photos-core/library/lock';
import { createBrowserPreviewRenderer } from '@lopsy/photos-core/import/browser-preview-renderer';
import { startExport } from '@lopsy/photos-core/export/exporter';
import {
  browserStorageChoices,
  ConnectCancelled,
  type Connection,
  type ConnectOptions,
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
import { createEngineExportRenderer } from '../../engine/export-renderer';
import {
  describeDevice,
  libraryStoreName,
  loadLastConnection,
  reconnectOffer,
  saveLastConnection,
  uploadSessionStoreName,
} from './connection-memory';
import { ensureReadWrite, loadFolderHandle, pickFolder, saveFolderHandle } from './folder-handle-store';
import { fromCoreProgress, toExportDestination, toExportSelection, toExportSettings } from './export-mapping';
import { getPreviewSource, setPreviewSource } from './preview-source';
import { storeEditPreviews } from './edit-previews';
import { guardSession } from '../guard-session';
import { showToast } from '../toasts';
import { downloadBlob } from '../download';

/** What a session needs beyond the LibrarySession itself. */
interface SessionExtras {
  readonly kind: StorageChoice;
  readonly tokenSource: GoogleTokenSource | null;
  /** Device caches; null for the browser's own storage, whose files are already on the device. */
  readonly caches: AccountCaches | null;
  readonly staging: StagingStore | null;
  readonly queue: ImportQueueStore | null;
}

/** The device-cache folder for an account: the Google `sub`, or 'local' for a picked folder. */
export function cacheAccountId(kind: StorageChoice, owner: string): string | null {
  if (kind === 'browser') return null;
  if (kind === 'local-folder') return 'local';
  return /^[A-Za-z0-9_-]{1,128}$/.test(owner) ? owner : null;
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
function downloadResult(result: ExportResult): void {
  const file = result.zip ?? result.files[0];
  if (file) downloadBlob(file.blob, file.name);
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

  constructor() {
    // Exports render on the engine (its own hidden canvas), one renderer for the page.
    let renderer: ReturnType<typeof createEngineExportRenderer> | null = null;
    setExportRendererFactory(() => {
      renderer ??= createEngineExportRenderer({
        loadOriginal: (asset, signal) => {
          const session = this.current;
          if (!session) return Promise.reject(new Error('No library is open'));
          return this.loadOriginal(session, asset, { signal });
        },
      });
      return renderer;
    });
  }
  private readonly previewRenderer = createBrowserPreviewRenderer();

  listStorageOptions(): readonly StorageChoice[] {
    return browserStorageChoices({ googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID });
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
    let rawSession: LibrarySession;
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
    const session = guardSession(rawSession, (message) => showToast(message));
    const accountId = cacheAccountId(kind, opened.owner);
    const [caches, staging, queue] = await Promise.all([
      accountId === null ? null : optional(() => openAccountCaches(accountId)),
      optional(() => OpfsStagingStore.open(session.libraryId)),
      optional(() => IndexedDbImportQueueStore.open()),
    ]);
    this.extras.set(session, { kind, tokenSource: opened.tokenSource, caches, staging, queue });
    setPreviewSource(caches ? { read: (s, ref) => caches.previews.readPreview(s.adapter, ref.fileId) } : null);
    saveLastConnection({ kind, label: opened.label });
    this.current = session;
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
          throw new Error(`Lopsy Photos needs permission to use the folder “${handle.name}”.`);
        }
        if (!handle) {
          handle = await pickFolder();
          if (!handle) throw new ConnectCancelled();
          if (!(await ensureReadWrite(handle))) throw new Error(`Lopsy Photos needs permission to change “${handle.name}”.`);
          await saveFolderHandle(handle).catch(() => undefined);
        }
        const adapter = await openPickedFolder(handle);
        return { adapter, owner: handle.name, label: handle.name, tokenSource: null };
      }
      case 'google-drive': {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) throw new Error('This build has no Google sign-in.');
        const tokenSource = new GoogleTokenSource({ clientId });
        let token: string;
        try {
          token = await tokenSource.requestInteractive();
        } catch (error) {
          if (isStorageError(error) && error.code === 'auth') {
            throw new Error('Google sign-in did not finish. Lopsy Photos needs access to the files it creates in your Drive.');
          }
          throw error;
        }
        const account = await fetchGoogleAccount(token);
        tokenSource.rememberAccount(account);
        const adapter = new GoogleDriveAdapter({
          tokenSource,
          label: account.email,
          uploadSessions: new IndexedDbUploadSessionStore(uploadSessionStoreName(account.id)),
        });
        return { adapter, owner: account.id, label: account.email, tokenSource };
      }
    }
  }

  async reauthorize(session: LibrarySession): Promise<void> {
    const tokenSource = this.extras.get(session)?.tokenSource;
    if (tokenSource) await tokenSource.requestInteractive();
    await session.syncNow();
  }

  startImport(files: readonly File[], session: LibrarySession, options: Partial<ImportOptions> = {}): ImportJob {
    const extras = this.extras.get(session);
    return startImport(files, {
      session,
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
      session,
      previewRenderer: this.previewRenderer,
      queueStore: extras.queue,
      ...(extras.staging ? { staging: extras.staging } : {}),
    });
  }

  readPreview(session: LibrarySession, ref: PreviewRef): Promise<Blob> {
    return getPreviewSource().read(session, ref);
  }

  loadOriginal(session: LibrarySession, asset: Asset, options: LoadOriginalOptions = {}): Promise<Blob> {
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
    return storeEditPreviews(session, versionId, previews, this.extras.get(session)?.caches?.previews ?? null);
  }

  async trashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
    const view = session.getView();
    const ids = new Set(assetIds);
    const originals: string[] = [];
    const previews: string[] = [];
    for (const id of ids) {
      const asset = view.assets.get(id);
      if (!asset) continue;
      originals.push(asset.fileId);
      if (asset.renderFileId) previews.push(asset.renderFileId);
    }
    for (const version of view.versions.values()) {
      if (!ids.has(version.assetId)) continue;
      if (version.thumb) previews.push(version.thumb.fileId);
      if (version.screen) previews.push(version.screen.fileId);
    }
    for (const fileId of originals) {
      try {
        await session.adapter.trash(fileId);
      } catch (error) {
        // Already gone is fine: the photo leaves the library either way.
        if (!(isStorageError(error) && error.code === 'not-found')) throw error;
      }
    }
    await Promise.allSettled(previews.map((fileId) => session.adapter.trash(fileId)));
    session.deleteAssets([...ids]);
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
          session,
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
        if (request.destination === 'download') downloadResult(result);
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
    const tokenSource = this.extras.get(session)?.tokenSource;
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
