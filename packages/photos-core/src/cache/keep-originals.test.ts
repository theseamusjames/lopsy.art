import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../storage/content-hash';
import { MemoryAdapter } from '../storage/memory-adapter';
import { MemoryBlobCache } from './blob-cache';
import { budgetFor, OriginalsDownload, parseKeepOriginals } from './keep-originals';
import { OriginalsCache, type OriginalRef } from './originals-cache';

async function library(count: number, size = 100): Promise<{ adapter: MemoryAdapter; refs: OriginalRef[] }> {
  const adapter = new MemoryAdapter({ latencyMs: 2 });
  const root = await adapter.getRoot();
  const refs: OriginalRef[] = [];
  for (let i = 0; i < count; i++) {
    const content = new Blob([new Uint8Array(size).fill(i + 1)]);
    const file = await adapter.createFile({ parentId: root.id, name: `${i}.raf`, mimeType: 'image/x-fuji-raf' }, content);
    refs.push({ fileId: file.id, sha256: await sha256Hex(content), byteSize: size });
  }
  return { adapter, refs };
}

describe('Keep originals', () => {
  it('reads the saved choice, defaulting to Recent', () => {
    expect(parseKeepOriginals('all')).toBe('all');
    expect(parseKeepOriginals('none')).toBe('none');
    expect(parseKeepOriginals(null)).toBe('recent');
    expect(parseKeepOriginals('everything')).toBe('recent');
  });

  it('gives each choice its budget', async () => {
    const estimate = async () => ({ usage: 0, quota: 100_000_000_000 });
    expect(await budgetFor('none', estimate)).toBe(0);
    expect(await budgetFor('recent', estimate)).toBe(20_000_000_000);
    expect(await budgetFor('recent', async () => ({ quota: 10_000_000_000 }))).toBe(3_000_000_000);
    expect(await budgetFor('all', estimate)).toBe(Number.POSITIVE_INFINITY);
  });

  it('All downloads every original not yet on the device', async () => {
    const { adapter, refs } = await library(4);
    const originals = new OriginalsCache(new MemoryBlobCache());
    await originals.readOriginal(adapter, refs[0] as OriginalRef);
    const download = new OriginalsDownload({ originals, adapter, list: () => refs, estimate: null });
    await download.resume();
    expect(download.getProgress()).toMatchObject({ state: 'done', total: 4, done: 4, failed: 0, downloadedBytes: 300 });
    expect(adapter.callCount('readContent')).toBe(4);
    for (const ref of refs) expect(await originals.cache.has(ref.sha256)).toBe(true);
  });

  it('pauses and resumes where it left off', async () => {
    const { adapter, refs } = await library(6);
    const originals = new OriginalsCache(new MemoryBlobCache());
    const download = new OriginalsDownload({ originals, adapter, list: () => refs, estimate: null });
    const unsubscribe = download.subscribe(() => {
      if (download.getProgress().done === 2) download.pause();
    });
    await download.resume();
    unsubscribe();
    expect(download.getProgress()).toMatchObject({ state: 'paused', done: 2 });
    await download.resume();
    expect(download.getProgress()).toMatchObject({ state: 'done', total: 6, done: 6 });
  });

  it('stops before the storage quota', async () => {
    const { adapter, refs } = await library(5, 100);
    const cache = new MemoryBlobCache();
    const originals = new OriginalsCache(cache);
    const download = new OriginalsDownload({
      originals,
      adapter,
      list: () => refs,
      estimate: async () => ({ usage: await cache.usage(), quota: 300 }),
    });
    await download.resume();
    expect(download.getProgress()).toMatchObject({ state: 'full', done: 2 });
  });

  it('counts failures and carries on', async () => {
    const { adapter, refs } = await library(3);
    const originals = new OriginalsCache(new MemoryBlobCache());
    const broken = [...refs, { fileId: 'gone', sha256: 'ab'.repeat(32), byteSize: 1 }];
    const download = new OriginalsDownload({ originals, adapter, list: () => broken, estimate: null });
    await download.resume();
    expect(download.getProgress()).toMatchObject({ state: 'done', total: 4, done: 3, failed: 1 });
  });
});
