/**
 * The page the browser specs drive. It imports photos-core's real modules
 * through Vite and exposes small scenarios on `window.harness`; specs call
 * them with page.evaluate and assert on the plain data they return.
 */

import { fetchGoogleAccount, GoogleTokenSource } from '../../src/auth/google-token-source';
import { StaticTokenSource } from '../../src/auth/static-token-source';
import { OpfsBlobCache } from '../../src/cache/opfs-blob-cache';
import { IndexedDbLocalStore } from '../../src/library/local-store';
import { NoopLibraryLock, WebLocksLibraryLock, type LibraryLockHandle } from '../../src/library/lock';
import { openLibrary } from '../../src/library/session';
import type { LibrarySession, OpEnvelope } from '../../src/library/types';
import { sha256Hex } from '../../src/storage/content-hash';
import { GoogleDriveAdapter } from '../../src/storage/google-drive/drive-adapter';
import { IndexedDbUploadSessionStore } from '../../src/storage/google-drive/upload-sessions';
import { openBrowserStorage } from '../../src/storage/local-folder-adapter';

const KIB = 1024;

function op(seq: number, extra: Record<string, unknown> = {}): OpEnvelope {
  return {
    id: `dev1:${seq}`,
    device: 'dev1',
    seq,
    hlc: `0000000000${seq}-0000-dev1`,
    v: 1,
    op: { t: 'set', kind: 'setting', id: 'theme', fields: { value: `v${seq}` } },
    ...extra,
  };
}

/** Deterministic bytes, so a page after reload can rebuild the same content. */
function pattern(size: number): Blob {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
  return new Blob([bytes], { type: 'image/x-fuji-raf' });
}

function driveAdapter(options: { uploadSessions?: IndexedDbUploadSessionStore } = {}): GoogleDriveAdapter {
  return new GoogleDriveAdapter({
    tokenSource: new StaticTokenSource('test-token'),
    label: 'tester@example.com',
    resumableThreshold: 256 * KIB,
    chunkSize: 256 * KIB,
    ...options,
  });
}

const locks = new Map<string, { handle: LibraryLockHandle; lost: boolean }>();
let firstChunk: Promise<void> | null = null;
const sessions = new Map<string, LibrarySession>();

export const harness = {
  async localStoreWrite(db: string, libraryId: string): Promise<{ failedPatch: string }> {
    const store = new IndexedDbLocalStore(db);
    await store.write(libraryId, { deviceId: 'dev1', nextSeq: 3, appendOutbox: [op(1), op(2)] });
    await store.write(libraryId, { nextSeq: 4, appendOutbox: [op(3)], removeOutboxThrough: 1 });
    let failedPatch = 'did not fail';
    try {
      // A function cannot be stored in IndexedDB: the whole patch must roll back, nextSeq included.
      await store.write(libraryId, { nextSeq: 99, appendOutbox: [op(4, { op: () => undefined })] });
    } catch (error) {
      failedPatch = error instanceof Error ? error.name : String(error);
    }
    return { failedPatch };
  },

  async localStoreLoad(db: string, libraryId: string): Promise<{ deviceId: string; nextSeq: number; outboxSeqs: number[] } | null> {
    const saved = await new IndexedDbLocalStore(db).load(libraryId);
    return saved ? { deviceId: saved.deviceId, nextSeq: saved.nextSeq, outboxSeqs: saved.outbox.map((item) => item.seq) } : null;
  },

  async acquireLock(name: string, steal: boolean): Promise<'granted' | 'busy'> {
    const handle = await new WebLocksLibraryLock().acquire(name, { steal });
    if (!handle) return 'busy';
    const entry = { handle, lost: false };
    handle.onLost(() => {
      entry.lost = true;
    });
    locks.set(name, entry);
    return 'granted';
  },

  lockLost(name: string): boolean {
    return locks.get(name)?.lost ?? false;
  },

  releaseLock(name: string): void {
    locks.get(name)?.handle.release();
    locks.delete(name);
  },

  async resetOpfs(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    for (const name of ['lopsy-photos', 'cache-test']) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
  },

  async opfsCreate(): Promise<{ rootId: string; folderId: string; fileId: string; trashedId: string; cursor: string; changed: string[]; kind: string }> {
    const adapter = await openBrowserStorage();
    const root = await adapter.getRoot();
    const cursor = await adapter.getChangeCursor();
    const folder = await adapter.createFolder(root.id, 'Lopsy Photos', { 'lp.role': 'library' });
    const file = await adapter.createFile(
      { parentId: folder.id, name: 'DSCF1.RAF', mimeType: 'image/x-fuji-raf', properties: { 'lp.role': 'original' } },
      new Blob(['raw bytes']),
    );
    const trashed = await adapter.createFile({ parentId: folder.id, name: 'gone.txt', mimeType: 'text/plain' }, new Blob(['bye']));
    await adapter.trash(trashed.id);
    const changes = await adapter.listChanges(cursor);
    return {
      rootId: root.id,
      folderId: folder.id,
      fileId: file.id,
      trashedId: trashed.id,
      cursor,
      changed: changes.changes.map((change) => change.fileId),
      kind: adapter.kind,
    };
  },

  async opfsRead(folderId: string, fileId: string, trashedId: string): Promise<{
    text: string;
    range: string;
    children: string[];
    trashed: boolean | null;
    found: number;
    onDisk: string[];
  }> {
    const adapter = await openBrowserStorage();
    const text = await (await adapter.readContent(fileId)).text();
    const range = await (await adapter.readContent(fileId, { range: { start: 4, end: 9 } })).text();
    const children = (await adapter.listChildren(folderId)).map((child) => child.name);
    const trashed = (await adapter.getFile(trashedId))?.trashed ?? null;
    const found = (await adapter.findByProperty('lp.role', 'original')).length;
    const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('lopsy-photos')).getDirectoryHandle('Lopsy Photos');
    const raw = await (await dir.getFileHandle('DSCF1.RAF')).getFile();
    return { text, range, children, trashed, found, onDisk: [raw.name, await raw.text()] };
  },

  async blobCacheFill(): Promise<{ usage: number; b: boolean }> {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('cache-test', { create: true });
    const cache = await OpfsBlobCache.open(dir, { budget: 30 });
    for (const key of ['a', 'b', 'c']) await cache.put(key, new Blob([new Uint8Array(10)]));
    await cache.get('a');
    await cache.put('d', new Blob([new Uint8Array(10)]));
    return { usage: await cache.usage(), b: (await cache.get('b')) !== null };
  },

  async blobCacheReopen(): Promise<{ usage: number; present: string[] }> {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('cache-test', { create: true });
    const cache = await OpfsBlobCache.open(dir, { budget: 30 });
    const present: string[] = [];
    for (const key of ['a', 'b', 'c', 'd']) if (await cache.get(key)) present.push(key);
    await cache.setBudget(10);
    return { usage: await cache.usage(), present };
  },

  async gisToken(): Promise<{ interactive: string; silent: string; email: string }> {
    const source = new GoogleTokenSource({ clientId: 'test-client' });
    const interactive = await source.requestInteractive();
    const silent = await source.getToken();
    const account = await fetchGoogleAccount(silent);
    return { interactive, silent, email: account.email };
  },

  /** Starts a resumable upload; resolves once Drive confirmed its first chunk, while the rest is still in flight. */
  async startUpload(size: number): Promise<void> {
    const adapter = driveAdapter({ uploadSessions: new IndexedDbUploadSessionStore('harness-uploads') });
    const root = await adapter.getRoot();
    firstChunk = new Promise((resolve) => {
      void adapter.createFile({ parentId: root.id, name: 'big.raf', mimeType: 'image/x-fuji-raf' }, pattern(size), {
        resumeKey: 'asset-1:original',
        onProgress: (sent) => {
          if (sent > 0) resolve();
        },
      });
    });
    await firstChunk;
  },

  async resumeUpload(size: number): Promise<{ fileId: string; firstProgress: number; sha: string; expectedSha: string; storeEmpty: boolean }> {
    const store = new IndexedDbUploadSessionStore('harness-uploads');
    const adapter = driveAdapter({ uploadSessions: store });
    const root = await adapter.getRoot();
    const progress: number[] = [];
    const content = pattern(size);
    const file = await adapter.createFile({ parentId: root.id, name: 'big.raf', mimeType: 'image/x-fuji-raf' }, content, {
      resumeKey: 'asset-1:original',
      onProgress: (sent) => progress.push(sent),
    });
    return {
      fileId: file.id,
      firstProgress: progress[0] ?? -1,
      sha: file.sha256 ?? '',
      expectedSha: await sha256Hex(content),
      storeEmpty: (await store.get('asset-1:original')) === null,
    };
  },

  async readWithProgress(fileId: string): Promise<{ size: number; calls: number; last: [number, number | null] | null }> {
    const calls: [number, number | null][] = [];
    const blob = await driveAdapter().readContent(fileId, { onProgress: (received, total) => calls.push([received, total]) });
    return { size: blob.size, calls: calls.length, last: calls[calls.length - 1] ?? null };
  },

  async openDevice(device: string): Promise<string> {
    const session = await openLibrary({
      adapter: driveAdapter(),
      store: new IndexedDbLocalStore(`harness-device-${device}`),
      deviceName: device,
      autoSync: false,
      lock: new NoopLibraryLock(),
    });
    sessions.set(device, session);
    return session.libraryId;
  },

  addAsset(device: string, fileName: string): string {
    const session = sessions.get(device);
    if (!session) throw new Error(`No session ${device}`);
    return session.addAsset({
      kind: 'original',
      fileId: `file-${fileName}`,
      sha256: '0'.repeat(64),
      fileName,
      byteSize: 1,
      format: 'jpeg',
      mimeType: 'image/jpeg',
      capturedAt: null,
      importedAt: new Date().toISOString(),
      importId: 'import-1',
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
    }).assetId;
  },

  setRating(device: string, assetId: string, rating: 0 | 1 | 2 | 3 | 4 | 5): void {
    sessions.get(device)?.setMarks([assetId], { rating });
  },

  async syncNow(device: string): Promise<void> {
    await sessions.get(device)?.syncNow();
  },

  view(device: string): { name: string; rating: number }[] {
    const session = sessions.get(device);
    if (!session) return [];
    return [...session.getView().assets.values()]
      .map((asset) => ({ name: asset.fileName, rating: asset.rating }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};

export type Harness = typeof harness;

Reflect.set(window, 'harness', harness);
const status = document.getElementById('status');
if (status) status.textContent = 'ready';
