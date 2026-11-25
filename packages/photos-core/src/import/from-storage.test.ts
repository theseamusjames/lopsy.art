import { describe, expect, it } from 'vitest';
import { MemoryBlobCache } from '../cache/blob-cache';
import { OriginalsCache } from '../cache/originals-cache';
import { StorageError } from '../storage/errors';
import { MemoryAdapter } from '../storage/memory-adapter';
import type { FileId, StorageAdapter, StoredFile } from '../storage/types';
import { startImportFromStorage } from './from-storage';
import type { StorageImportContext } from './from-storage';
import { sha256Hex } from './hash';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import type { PreviewRenderer } from './types';

const DAY = new Date(2026, 10, 18, 12);

function jpeg(seed: number, date = '2026:11:14 16:02:11'): Uint8Array<ArrayBuffer> {
  const exif = buildTiff({
    entries: [{ tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: date }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] }],
  });
  return buildJpeg({ width: 600 + seed, height: 400, exif });
}

/** A TIFF with the DNGVersion tag and an embedded JPEG: DNG container structure, no raw data. */
function dng(date: string): Uint8Array<ArrayBuffer> {
  const preview = buildJpeg({ width: 1024, height: 683 });
  return buildTiff({
    entries: [
      { tag: 0x00fe, type: 4, values: [1] },
      { tag: 0x0201, blob: preview },
      { tag: 0x0202, type: 4, values: [preview.length] },
      { tag: 0xc612, type: 1, values: [1, 4, 0, 0] },
      { tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: date }] }] },
    ],
  });
}

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob([`p${maxSize}`], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

/** Drive reports checksums for binary files; some backends do not. */
class NoChecksumAdapter extends MemoryAdapter {
  override async getFile(id: FileId): Promise<StoredFile | null> {
    const file = await super.getFile(id);
    return file && { ...file, sha256: null };
  }
}

async function setup(adapter: MemoryAdapter = new MemoryAdapter()) {
  const root = await adapter.getRoot();
  const library = await adapter.createFolder(root.id, 'Photonamous');
  const originals = await adapter.createFolder(library.id, 'Originals');
  const previews = await adapter.createFolder(library.id, 'previews');
  const elsewhere = await adapter.createFolder(root.id, 'Camera uploads');
  const deeper = await adapter.createFolder(elsewhere.id, 'Trip');
  const session = new FakeLibrarySession(adapter as StorageAdapter, {
    rootId: library.id,
    originalsId: originals.id,
    previewsId: previews.id,
  });
  const put = async (parentId: FileId, name: string, bytes: Uint8Array<ArrayBuffer>, mimeType = 'image/jpeg') =>
    (await adapter.createFile({ parentId, name, mimeType }, new Blob([bytes]))).id;
  const ctx = (extra: Partial<StorageImportContext> = {}): StorageImportContext => ({
    session,
    previewRenderer: renderer,
    now: () => DAY,
    ...extra,
  });
  const pathOf = async (id: FileId) => {
    const parts: string[] = [];
    for (let f = await adapter.getFile(id); f && f.parentId !== null; f = await adapter.getFile(f.parentId)) parts.unshift(f.name);
    return parts.join('/');
  };
  return { adapter, session, root, elsewhere, deeper, put, ctx, pathOf };
}

describe('startImportFromStorage', () => {
  it('moves picked files into Originals by capture date and tags them', async () => {
    const { session, elsewhere, deeper, put, ctx, pathOf, adapter } = await setup();
    const a = await put(elsewhere.id, 'A.JPG', jpeg(1));
    const b = await put(deeper.id, 'B.JPG', jpeg(2, '2025:01:02 03:04:05'));
    const result = await startImportFromStorage([a, b], ctx()).finished;
    expect(result.items.map((i) => [i.fileName, i.state])).toEqual([
      ['A.JPG', 'done'],
      ['B.JPG', 'done'],
    ]);
    expect(await pathOf(a)).toBe('Photonamous/Originals/2026/2026-11-14/A.JPG');
    expect(await pathOf(b)).toBe('Photonamous/Originals/2025/2025-01-02/B.JPG');
    const asset = session.getView().assets.get(result.items[0]?.assetId ?? '');
    expect(asset).toMatchObject({ fileId: a, fileName: 'A.JPG', format: 'jpeg', capturedAt: '2026-11-14T16:02:11' });
    expect((await adapter.getFile(a))?.properties).toEqual({
      'lp.lib': 'lib-test',
      'lp.role': 'original',
      'lp.asset': asset?.id,
      'lp.sha': asset?.sha256,
    });
    expect(session.getView().versions.get(asset?.primaryVersionId ?? '')?.thumb).not.toBeNull();
    expect(adapter.callCount('createFile')).toBe(2 + 4);
  });

  it('leaves files in place and only tags them when move is false', async () => {
    const { session, deeper, put, ctx, pathOf, adapter } = await setup();
    const a = await put(deeper.id, 'A.JPG', jpeg(1));
    const result = await startImportFromStorage([a], ctx({ options: { move: false } })).finished;
    expect(result.items[0]?.state).toBe('done');
    expect(await pathOf(a)).toBe('Camera uploads/Trip/A.JPG');
    expect((await adapter.getFile(a))?.properties['lp.role']).toBe('original');
    expect(session.getView().assets.get(result.items[0]?.assetId ?? '')?.fileId).toBe(a);
  });

  it('skips duplicates by Drive checksum before downloading, and the same file picked twice', async () => {
    const { session, elsewhere, put, ctx, adapter } = await setup();
    const first = await put(elsewhere.id, 'A.JPG', jpeg(1));
    const done = await startImportFromStorage([first], ctx()).finished;
    const reads = adapter.callCount('readContent');
    const copy = await put(elsewhere.id, 'A copy.JPG', jpeg(1));
    const other = await put(elsewhere.id, 'C.JPG', jpeg(3));
    const result = await startImportFromStorage([copy, other, other], ctx({ options: { concurrency: 1 } })).finished;
    expect(result.items.map((i) => i.state)).toEqual(['duplicate', 'done', 'duplicate']);
    expect(result.items[0]?.assetId).toBe(done.items[0]?.assetId);
    expect(result.items[2]?.assetId).toBe(result.items[1]?.assetId);
    expect(adapter.callCount('readContent') - reads).toBe(1);
    expect(session.getView().assets.size).toBe(2);
  });

  it('finds duplicates after hashing when the backend has no checksum, and caches the download', async () => {
    const adapter = new NoChecksumAdapter();
    const { session, elsewhere, put, ctx } = await setup(adapter);
    const a = await put(elsewhere.id, 'A.JPG', jpeg(1));
    const b = await put(elsewhere.id, 'B.JPG', jpeg(1));
    const cache = new MemoryBlobCache();
    const result = await startImportFromStorage([a, b], ctx({ originalsCache: new OriginalsCache(cache), options: { concurrency: 1 } })).finished;
    expect(result.items.map((i) => i.state)).toEqual(['done', 'duplicate']);
    expect(session.getView().assets.size).toBe(1);
    expect(await cache.get(await sha256Hex(jpeg(1)))).not.toBeNull();
  });

  it('caches downloads through the originals cache when Drive reports the checksum', async () => {
    const { elsewhere, put, ctx } = await setup();
    const a = await put(elsewhere.id, 'A.JPG', jpeg(4));
    const cache = new MemoryBlobCache();
    await startImportFromStorage([a], ctx({ originalsCache: new OriginalsCache(cache) })).finished;
    expect(await cache.get(await sha256Hex(jpeg(4)))).not.toBeNull();
  });

  it('marks folders, trashed files, other types and unreadable bytes unsupported, and missing files failed', async () => {
    const { elsewhere, deeper, put, ctx, adapter } = await setup();
    const doc = await put(elsewhere.id, 'notes.txt', new TextEncoder().encode('hello'), 'text/plain');
    const fake = await put(elsewhere.id, 'fake.jpg', new TextEncoder().encode('not really'));
    const trashed = await put(elsewhere.id, 'T.JPG', jpeg(5));
    await adapter.trash(trashed);
    const result = await startImportFromStorage([deeper.id, doc, fake, trashed, 'missing-id'], ctx()).finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual([
      ['unsupported', 'A folder: pick the photos in it'],
      ['unsupported', 'Not a supported photo format'],
      ['unsupported', 'Not a supported photo format'],
      ['unsupported', "In Drive's trash"],
      ['failed', 'Not found, or not shared with the app'],
    ]);
  });

  it('fails a file whose download fails and carries on', async () => {
    const { elsewhere, put, ctx, adapter, session, pathOf } = await setup();
    const a = await put(elsewhere.id, 'A.JPG', jpeg(1));
    const b = await put(elsewhere.id, 'B.JPG', jpeg(2));
    adapter.failNext('readContent', new StorageError('network', 'Connection dropped'));
    const result = await startImportFromStorage([a, b], ctx({ options: { concurrency: 1 } })).finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual([
      ['failed', 'Connection dropped'],
      ['done', null],
    ]);
    expect(await pathOf(a)).toBe('Camera uploads/A.JPG');
    expect(session.getView().assets.size).toBe(1);
  });

  it('pairs RAW and JPEG, or skips the JPEG for raw-only', async () => {
    const { elsewhere, put, ctx, session } = await setup();
    const j = await put(elsewhere.id, 'DSCF9.JPG', jpeg(1, '2026:11:14 16:02:12'));
    const r = await put(elsewhere.id, 'DSCF9.DNG', dng('2026:11:14 16:02:11'), 'image/x-adobe-dng');
    const both = await startImportFromStorage([j, r], ctx()).finished;
    const view = session.getView();
    expect(view.assets.get(both.items[0]?.assetId ?? '')?.pairedWith).toBe(both.items[1]?.assetId);

    const { elsewhere: e2, put: put2, ctx: ctx2, session: s2 } = await setup();
    const j2 = await put2(e2.id, 'DSCF9.JPG', jpeg(1, '2026:11:14 16:02:12'));
    const r2 = await put2(e2.id, 'DSCF9.DNG', dng('2026:11:14 16:02:11'), 'application/octet-stream');
    const rawOnly = await startImportFromStorage([j2, r2], ctx2({ options: { rawPlusJpeg: 'raw-only' } })).finished;
    expect(rawOnly.items.map((i) => i.state)).toEqual(['skipped', 'done']);
    expect(s2.getView().assets.size).toBe(1);
  });

  it('cancels', async () => {
    const { elsewhere, put, ctx, session } = await setup();
    const ids = await Promise.all([1, 2, 3].map((i) => put(elsewhere.id, `X${i}.JPG`, jpeg(i))));
    const job = startImportFromStorage(ids, ctx({ options: { concurrency: 1 } }));
    job.cancel();
    const result = await job.finished;
    expect(result.items.every((i) => i.state === 'failed' && i.error === 'Cancelled')).toBe(true);
    expect(session.getView().assets.size).toBe(0);
  });
});
