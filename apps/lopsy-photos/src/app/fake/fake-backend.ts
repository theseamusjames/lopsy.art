/**
 * DEVELOPMENT DOUBLE of PhotosBackend. Everything lives in memory and is
 * gone on reload. Import and export walk through their states on timers so
 * the progress UI can be seen working. Use `?backend=fake&seed=N`.
 */

import type { Asset, AssetId, LibrarySession, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import type { KeepOriginals, OriginalsDownload } from '@lopsy/photos-core/cache/keep-originals';
import type { ImportItem, ImportJob, ImportOptions, ImportProgress } from '@lopsy/photos-core/import/types';
import type { StorageQuota } from '@lopsy/photos-core/storage/types';
import type { RepairReport } from '@lopsy/photos-core/library/repair';
import {
  browserStorageChoices,
  type Connection,
  type DeviceInfo,
  type EditPreviews,
  type ExportJob,
  type ExportProgress,
  type ExportRequest,
  type PhotosBackend,
  type ReconnectOffer,
  type StorageChoice,
} from '../backend';
import { baseNameOf, extensionOf, isPhotoFile, isRawFile } from '../../import/import-summary';
import { FakeSession, fakeId } from './fake-session';
import { importedFileOf, readFakePreview, rememberImportedFile, rememberPreview } from './fake-previews';
import { seedLibrary } from './fake-seed';

const LABELS: Record<StorageChoice, string> = {
  'google-drive': 'you@example.com',
  browser: 'This browser',
  'local-folder': 'Pictures',
};

const MIME: Record<string, string> = {
  raf: 'image/x-fujifilm-raf',
  dng: 'image/x-adobe-dng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function asFake(session: LibrarySession): FakeSession {
  if (!(session instanceof FakeSession)) throw new Error('The fake backend only works with its own sessions.');
  return session;
}

/** A tiny observable used by the fake jobs. */
class Observable<T> {
  private listeners = new Set<() => void>();
  constructor(protected state: T) {}
  get(): T {
    return this.state;
  }
  set(state: T): void {
    this.state = state;
    for (const l of this.listeners) l();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function fakeImport(files: readonly File[], session: FakeSession, options: Partial<ImportOptions>): ImportJob {
  const rawStems = new Set(files.filter((f) => isRawFile(f.name)).map((f) => baseNameOf(f.webkitRelativePath || f.name)));
  const isPairJpeg = (f: File) => !isRawFile(f.name) && rawStems.has(baseNameOf(f.webkitRelativePath || f.name));
  const kept = files.filter((f) => !(options.rawPlusJpeg === 'raw-only' && isPairJpeg(f)));
  const known = new Set([...session.getView().assets.values()].filter((a) => !a.deleted).map((a) => a.sha256));
  const progress = new Observable<ImportProgress>({
    finished: false,
    items: kept.map((f) => ({ id: fakeId('item'), fileName: f.name, byteSize: f.size, state: 'queued', sentBytes: 0, assetId: null, error: null })),
  });
  const importId = fakeId('import');
  const assetByStem = new Map<string, AssetId>();
  let cancelled = false;
  let resolveFinished: (p: ImportProgress) => void = () => {};
  const finished = new Promise<ImportProgress>((r) => (resolveFinished = r));
  const concurrency = options.concurrency ?? 3;

  const update = (i: number, patch: Partial<ImportItem>) => {
    const items = [...progress.get().items];
    const item = items[i];
    if (!item) return;
    items[i] = { ...item, ...patch };
    progress.set({ items, finished: false });
  };

  const step = (i: number): ImportItem['state'] | null => {
    const item = progress.get().items[i];
    const file = kept[i];
    if (!item || !file) return null;
    const ext = extensionOf(file.name);
    switch (item.state) {
      case 'queued':
        update(i, { state: 'reading' });
        return 'reading';
      case 'reading': {
        if (!isPhotoFile(file.name)) return update(i, { state: 'unsupported', error: 'Not a photo this app can read' }), null;
        const sha = `fake-sha:${file.name}:${file.size}`;
        if (options.skipDuplicates !== false && known.has(sha)) return update(i, { state: 'duplicate' }), null;
        known.add(sha);
        const stem = baseNameOf(file.webkitRelativePath || file.name);
        const { assetId } = session.addAsset({
          kind: 'original',
          fileId: fakeId('file'),
          sha256: sha,
          fileName: file.name,
          byteSize: file.size,
          format: ext === 'raf' ? 'raf' : ext === 'dng' ? 'dng' : ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg',
          mimeType: MIME[ext] ?? 'application/octet-stream',
          capturedAt: null,
          importedAt: new Date().toISOString(),
          importId,
          width: null,
          height: null,
          orientation: 1,
          camera: null,
          lens: null,
          exposure: null,
          gps: null,
          pairedWith: null,
          source: null,
          renderFileId: null,
        });
        rememberImportedFile(assetId, file);
        const partner = assetByStem.get(stem);
        if (partner && options.rawPlusJpeg !== 'raw-only') session.linkPair(partner, assetId);
        assetByStem.set(stem, assetId);
        update(i, { state: 'uploading', assetId });
        return 'uploading';
      }
      case 'uploading': {
        if (file.name.toLowerCase().includes('fail')) {
          if (item.assetId) session.deleteAssets([item.assetId]);
          update(i, { state: 'failed', assetId: null, error: 'The upload was refused (simulated)' });
          return null;
        }
        const sent = Math.min(item.byteSize, item.sentBytes + Math.max(1, Math.ceil(item.byteSize / 4)));
        update(i, { sentBytes: sent, state: sent >= item.byteSize ? 'verifying' : 'uploading' });
        return 'uploading';
      }
      case 'verifying':
        update(i, { state: 'done' });
        return null;
      default:
        return null;
    }
  };

  let next = 0;
  const run = async () => {
    while (!cancelled) {
      const i = next++;
      if (i >= kept.length) return;
      while (!cancelled && step(i) !== null) await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
    }
  };
  void Promise.all(Array.from({ length: concurrency }, run)).then(() => {
    const items = progress.get().items.map((it) =>
      it.state === 'queued' || it.state === 'reading' || it.state === 'uploading' ? { ...it, state: 'failed' as const, error: 'Stopped' } : it,
    );
    progress.set({ items, finished: true });
    resolveFinished(progress.get());
  });

  return {
    id: importId,
    getProgress: () => progress.get(),
    subscribe: (l) => progress.subscribe(l),
    cancel: () => {
      cancelled = true;
    },
    // The fake keeps no queue to resume from, so pausing stops it like cancel.
    pause: () => {
      cancelled = true;
    },
    finished,
  };
}

function fakeExport(request: ExportRequest): ExportJob {
  const total = request.versionIds.length;
  const progress = new Observable<ExportProgress>({ total, done: 0, failures: [], finished: total === 0 });
  let resolveFinished: (p: ExportProgress) => void = () => {};
  const finished = new Promise<ExportProgress>((r) => (resolveFinished = r));
  if (total === 0) resolveFinished(progress.get());
  const timer = setInterval(() => {
    const p = progress.get();
    const done = p.done + 1;
    progress.set({ ...p, done, finished: done >= total });
    if (done >= total) {
      clearInterval(timer);
      resolveFinished(progress.get());
    }
  }, 250);
  return {
    id: fakeId('export'),
    getProgress: () => progress.get(),
    subscribe: (l) => progress.subscribe(l),
    cancel: () => {
      clearInterval(timer);
      const p = progress.get();
      progress.set({ ...p, finished: true });
      resolveFinished(progress.get());
    },
    finished,
  };
}

export class FakeBackend implements PhotosBackend {
  constructor(private readonly seedCount: number) {}

  listStorageOptions(): readonly StorageChoice[] {
    const choices = browserStorageChoices({ googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID });
    return choices.includes('browser') ? choices : ['browser', ...choices];
  }

  async getReconnectOffer(): Promise<ReconnectOffer | null> {
    return null;
  }

  async reauthorize(session: LibrarySession): Promise<void> {
    await session.syncNow();
  }

  async connect(kind: StorageChoice): Promise<Connection> {
    await new Promise((r) => setTimeout(r, 400));
    const session = new FakeSession(kind === 'google-drive' ? 'google-drive' : kind, LABELS[kind]);
    seedLibrary(session, this.seedCount);
    return { session, accountLabel: LABELS[kind] };
  }

  startImport(files: readonly File[], session: LibrarySession, options: Partial<ImportOptions> = {}): ImportJob {
    return fakeImport(files, asFake(session), options);
  }

  readPreview(session: LibrarySession, ref: PreviewRef): Promise<Blob> {
    const assetId = ref.fileId.split(':')[1] ?? '';
    const name = session.getView().assets.get(assetId)?.fileName ?? '';
    return readFakePreview(ref, name);
  }

  canAddFromDrive(): boolean {
    return false;
  }

  async addFromDrive(): Promise<ImportJob | null> {
    return null;
  }

  async checkLibrary(session: LibrarySession): Promise<RepairReport> {
    const assets = [...session.getView().assets.values()].filter((a) => !a.deleted);
    const by = (status: string) => assets.filter((a) => (a.originalStatus ?? 'ok') === status).map((a) => a.id);
    return {
      originalsFound: assets.length,
      assetsChecked: assets.length,
      orphans: [],
      leftovers: [],
      missing: by('missing'),
      trashed: by('trashed'),
      changed: by('changed'),
      restored: [],
    };
  }

  addOrphans(session: LibrarySession): ImportJob {
    return fakeImport([], asFake(session), {});
  }

  async restoreOriginals(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
    asFake(session).setOriginalStatus(assetIds, 'ok');
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    return { deviceName: 'This browser (development backend)', cacheBytes: 0 };
  }

  async clearDeviceCache(): Promise<void> {}

  private keepOriginals: KeepOriginals = 'recent';

  getKeepOriginals(): KeepOriginals {
    return this.keepOriginals;
  }

  async setKeepOriginals(_session: LibrarySession, mode: KeepOriginals): Promise<void> {
    this.keepOriginals = mode;
  }

  getOriginalsDownload(): OriginalsDownload | null {
    return null;
  }

  async resumeImports(): Promise<ImportJob | null> {
    return null;
  }

  async loadOriginal(session: LibrarySession, asset: Asset): Promise<Blob> {
    const file = importedFileOf(asset.id);
    if (file) return file;
    const screen = session.getView().versions.get(asset.primaryVersionId)?.screen;
    if (!screen) throw new Error('This photo has no picture in the development backend.');
    return readFakePreview({ ...screen, fileId: `fake-preview:${asset.id}:screen` }, asset.fileName);
  }

  pinOriginal(): () => void {
    return () => {};
  }

  async storeEditPreviews(session: LibrarySession, versionId: VersionId, previews: EditPreviews): Promise<void> {
    for (const size of ['thumb', 'screen'] as const) {
      const fileId = `fake-edit:${versionId}:${size}:${previews.recipeHash}`;
      rememberPreview(fileId, previews[size]);
      const old = session.getView().versions.get(versionId)?.[size];
      session.setPreview(versionId, size, {
        fileId,
        recipeHash: previews.recipeHash,
        width: old?.width ?? (size === 'thumb' ? 512 : 2048),
        height: old?.height ?? (size === 'thumb' ? 341 : 1365),
      });
    }
  }

  async trashAssets(session: LibrarySession, assetIds: readonly AssetId[]): Promise<void> {
    const view = session.getView();
    // The record first, then the files (as the real backend does).
    session.deleteAssets(assetIds);
    await session.whenDurable();
    for (const id of assetIds) {
      const asset = view.assets.get(id);
      if (asset) await session.adapter.trash(asset.fileId);
    }
  }

  exportVersions(_session: LibrarySession, request: ExportRequest): ExportJob {
    return fakeExport(request);
  }

  getQuota(session: LibrarySession): Promise<StorageQuota> {
    return session.adapter.getQuota();
  }

  async disconnect(session: LibrarySession): Promise<void> {
    await session.close();
  }
}
