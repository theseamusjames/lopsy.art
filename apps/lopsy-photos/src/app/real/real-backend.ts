/**
 * The PhotosBackend on photos-core: the storage adapters, openLibrary, the
 * importer and the export job.
 */

import type { AssetId, LibrarySession, PreviewRef } from '@lopsy/photos-core/library/types';
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
import { startImport } from '@lopsy/photos-core/import/importer';
import { createBrowserPreviewRenderer } from '@lopsy/photos-core/import/browser-preview-renderer';
import { startExport } from '@lopsy/photos-core/export/exporter';
import {
  browserStorageChoices,
  ConnectCancelled,
  type Connection,
  type ConnectOptions,
  type ExportJob,
  type ExportProgress,
  type ExportRequest,
  type PhotosBackend,
  type ReconnectOffer,
  type StorageChoice,
} from '../backend';
import { getExportRenderer } from '../export-renderer-registry';
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
import { getPreviewSource } from './preview-source';

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
  if (!file) return;
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export class RealBackend implements PhotosBackend {
  private readonly tokenSources = new WeakMap<LibrarySession, GoogleTokenSource>();
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
    const opened = await this.openStorage(kind, options.reconnect === true);
    const session = await openLibrary({
      adapter: opened.adapter,
      store: new IndexedDbLocalStore(libraryStoreName(kind, opened.owner)),
      deviceName: describeDevice(navigator.userAgent),
    });
    if (opened.tokenSource) this.tokenSources.set(session, opened.tokenSource);
    saveLastConnection({ kind, label: opened.label });
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
    const tokenSource = this.tokenSources.get(session);
    if (tokenSource) await tokenSource.requestInteractive();
    await session.syncNow();
  }

  startImport(files: readonly File[], session: LibrarySession, options: Partial<ImportOptions> = {}): ImportJob {
    return startImport(files, { session, previewRenderer: this.previewRenderer, options });
  }

  readPreview(session: LibrarySession, ref: PreviewRef): Promise<Blob> {
    return getPreviewSource().read(session, ref);
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
    const tokenSource = this.tokenSources.get(session);
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
