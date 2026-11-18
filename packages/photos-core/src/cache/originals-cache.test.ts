import { describe, expect, it } from 'vitest';
import { StaticTokenSource } from '../auth/static-token-source';
import { sha256Hex } from '../storage/content-hash';
import { createFakeDrive } from '../storage/google-drive/fake-drive';
import { GoogleDriveAdapter } from '../storage/google-drive/drive-adapter';
import { MemoryAdapter } from '../storage/memory-adapter';
import { FakeDirectoryHandle, listPaths } from '../storage/test-support/fake-fs-handle';
import { openAccountCaches } from './account-caches';
import { MemoryBlobCache } from './blob-cache';
import { defaultOriginalsBudget, ORIGINALS_MAX_BUDGET, OriginalsCache, type OriginalRef } from './originals-cache';
import { PreviewCache } from './preview-cache';

async function storeOriginal(adapter: MemoryAdapter, content: Blob): Promise<OriginalRef> {
  const root = await adapter.getRoot();
  const file = await adapter.createFile({ parentId: root.id, name: 'DSCF1.RAF', mimeType: 'image/x-fuji-raf' }, content);
  return { fileId: file.id, sha256: await sha256Hex(content), byteSize: content.size };
}

describe('OriginalsCache', () => {
  it('downloads once, then serves from the cache', async () => {
    const adapter = new MemoryAdapter();
    const asset = await storeOriginal(adapter, new Blob(['raw bytes']));
    const originals = new OriginalsCache(new MemoryBlobCache());
    expect(await (await originals.readOriginal(adapter, asset)).text()).toBe('raw bytes');
    expect(await (await originals.readOriginal(adapter, asset)).text()).toBe('raw bytes');
    expect(adapter.callCount('readContent')).toBe(1);
  });

  it('shares one download between concurrent reads', async () => {
    const adapter = new MemoryAdapter({ latencyMs: 20 });
    const asset = await storeOriginal(adapter, new Blob(['shared']));
    const originals = new OriginalsCache(new MemoryBlobCache());
    const progress: number[][] = [[], [], []];
    const results = await Promise.all(
      progress.map((list) => originals.readOriginal(adapter, asset, { onProgress: (received) => list.push(received) })),
    );
    expect(await Promise.all(results.map((blob) => blob.text()))).toEqual(['shared', 'shared', 'shared']);
    expect(adapter.callCount('readContent')).toBe(1);
    for (const list of progress) expect(list[list.length - 1]).toBe(6);
  });

  it('rejects and does not cache content that fails its checksum', async () => {
    const adapter = new MemoryAdapter();
    const asset = await storeOriginal(adapter, new Blob(['original']));
    const cache = new MemoryBlobCache();
    const originals = new OriginalsCache(cache);
    await expect(originals.readOriginal(adapter, { ...asset, sha256: 'ff'.repeat(32) })).rejects.toMatchObject({ code: 'invalid' });
    await adapter.updateContent(asset.fileId, new Blob(['replaced']));
    await expect(originals.readOriginal(adapter, asset)).rejects.toMatchObject({ code: 'invalid' });
    expect(await cache.usage()).toBe(0);
  });

  it('cancels the download only when every reader has aborted', async () => {
    const adapter = new MemoryAdapter({ latencyMs: 30 });
    const asset = await storeOriginal(adapter, new Blob(['abc']));
    const originals = new OriginalsCache(new MemoryBlobCache());
    const one = new AbortController();
    const first = originals.readOriginal(adapter, asset, { signal: one.signal });
    const second = originals.readOriginal(adapter, asset);
    one.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    expect(await (await second).text()).toBe('abc');

    const other = await storeOriginal(adapter, new Blob(['xyz']));
    const two = new AbortController();
    const lone = originals.readOriginal(adapter, other, { signal: two.signal });
    two.abort();
    await expect(lone).rejects.toMatchObject({ code: 'aborted' });
  });

  it('keeps a pinned original through eviction', async () => {
    const adapter = new MemoryAdapter();
    const a = await storeOriginal(adapter, new Blob(['aaaaaaaaaa']));
    const b = await storeOriginal(adapter, new Blob(['bbbbbbbbbb']));
    const cache = new MemoryBlobCache({ budget: 10 });
    const originals = new OriginalsCache(cache);
    originals.pin(a.sha256.toUpperCase());
    await originals.readOriginal(adapter, a);
    await originals.readOriginal(adapter, b);
    expect(await cache.get(a.sha256)).not.toBeNull();
    expect(await cache.get(b.sha256)).not.toBeNull();
    originals.unpin(a.sha256);
    await cache.setBudget(10);
    expect(await cache.get(a.sha256)).toBeNull();
  });

  it('reports download progress from the Drive adapter', async () => {
    const drive = createFakeDrive();
    const adapter = new GoogleDriveAdapter({ tokenSource: new StaticTokenSource(), label: 'x', fetch: drive.fetch, sleep: async () => undefined });
    const root = await adapter.getRoot();
    const content = new Blob([new Uint8Array(100_000).fill(7)]);
    const file = await adapter.createFile({ parentId: root.id, name: 'a.raf', mimeType: 'image/x-fuji-raf' }, content);
    const originals = new OriginalsCache(new MemoryBlobCache());
    const progress: [number, number | null][] = [];
    const blob = await originals.readOriginal(
      adapter,
      { fileId: file.id, sha256: await sha256Hex(content), byteSize: content.size },
      { onProgress: (received, total) => progress.push([received, total]) },
    );
    expect(blob.size).toBe(100_000);
    expect(progress[progress.length - 1]).toEqual([100_000, 100_000]);
  });

  it('defaults its budget to the smaller of 20 GB and 30 % of the quota', async () => {
    expect(await defaultOriginalsBudget(async () => ({ quota: 10_000_000_000 }))).toBe(3_000_000_000);
    expect(await defaultOriginalsBudget(async () => ({ quota: 1e12 }))).toBe(ORIGINALS_MAX_BUDGET);
    expect(await defaultOriginalsBudget(async () => ({}))).toBe(ORIGINALS_MAX_BUDGET);
    expect(await defaultOriginalsBudget(null)).toBe(ORIGINALS_MAX_BUDGET);
  });
});

describe('PreviewCache', () => {
  it('downloads a preview once and accepts locally rendered ones', async () => {
    const adapter = new MemoryAdapter();
    const root = await adapter.getRoot();
    const file = await adapter.createFile({ parentId: root.id, name: 'p.jpg', mimeType: 'image/jpeg' }, new Blob(['jpeg']));
    const previews = new PreviewCache(new MemoryBlobCache());
    await Promise.all([previews.readPreview(adapter, file.id), previews.readPreview(adapter, file.id)]);
    expect(await (await previews.readPreview(adapter, file.id)).text()).toBe('jpeg');
    expect(adapter.callCount('readContent')).toBe(1);
    await previews.put('rendered-id', new Blob(['local']));
    expect(await (await previews.get('rendered-id'))?.text()).toBe('local');
  });
});

describe('openAccountCaches', () => {
  it('keeps each account under its own folder', async () => {
    const root = new FakeDirectoryHandle('opfs');
    const adapter = new MemoryAdapter();
    const asset = await storeOriginal(adapter, new Blob(['raw']));
    const caches = await openAccountCaches('1234', { root, originalsBudget: 1000, previewsBudget: 1000 });
    await caches.originals.readOriginal(adapter, asset);
    expect(await listPaths(root)).toContain(`1234/originals/${asset.sha256}`);
    expect(await listPaths(root)).toContain('1234/previews/');
    await expect(openAccountCaches('../x', { root })).rejects.toThrow(RangeError);
  });
});
