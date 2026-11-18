import { describe, expect, it } from 'vitest';
import { FakeDirectoryHandle, listPaths } from '../storage/test-support/fake-fs-handle';
import { MemoryBlobCache, type BlobCache, type BlobCacheOptions } from './blob-cache';
import { CACHE_INDEX_FILE, OpfsBlobCache } from './opfs-blob-cache';

function bytes(size: number, fill = 1): Blob {
  return new Blob([new Uint8Array(size).fill(fill)]);
}

function suite(name: string, make: (options: BlobCacheOptions) => Promise<BlobCache>): void {
  describe(`BlobCache: ${name}`, () => {
    it('stores, reads and deletes', async () => {
      const cache = await make({});
      expect(await cache.get('a')).toBeNull();
      await cache.put('a', new Blob(['hello']));
      expect(await (await cache.get('a'))?.text()).toBe('hello');
      expect(await cache.usage()).toBe(5);
      await cache.put('a', new Blob(['hi']));
      expect(await (await cache.get('a'))?.text()).toBe('hi');
      expect(await cache.usage()).toBe(2);
      await cache.delete('a');
      expect(await cache.get('a')).toBeNull();
      expect(await cache.usage()).toBe(0);
    });

    it('evicts the least recently used past the budget', async () => {
      const cache = await make({ budget: 30 });
      await cache.put('a', bytes(10));
      await cache.put('b', bytes(10));
      await cache.put('c', bytes(10));
      await cache.get('a');
      await cache.put('d', bytes(10));
      expect(await cache.get('b')).toBeNull();
      expect(await cache.get('a')).not.toBeNull();
      expect(await cache.get('c')).not.toBeNull();
      expect(await cache.get('d')).not.toBeNull();
      expect(await cache.usage()).toBe(30);
    });

    it('evicts down to a lowered budget', async () => {
      const cache = await make({});
      for (const key of ['a', 'b', 'c', 'd']) await cache.put(key, bytes(10));
      await cache.setBudget(15);
      expect(await cache.usage()).toBe(10);
      expect(await cache.get('d')).not.toBeNull();
      expect(await cache.get('a')).toBeNull();
    });

    it('never evicts a pinned key, and evicts it once unpinned', async () => {
      const cache = await make({ budget: 20 });
      cache.pin('a');
      cache.pin('a');
      await cache.put('a', bytes(10));
      await cache.put('b', bytes(10));
      await cache.put('c', bytes(10));
      await cache.put('d', bytes(10));
      expect(await cache.get('a')).not.toBeNull();
      expect(await cache.get('b')).toBeNull();
      cache.unpin('a');
      await cache.put('e', bytes(10));
      expect(await cache.get('a')).not.toBeNull();
      cache.unpin('a');
      await cache.get('e');
      await cache.put('f', bytes(10));
      expect(await cache.get('a')).toBeNull();
    });

    it('keeps the entry just written even when it alone exceeds the budget', async () => {
      const cache = await make({ budget: 5 });
      await cache.put('small', bytes(3));
      await cache.put('big', bytes(10));
      expect(await cache.get('big')).not.toBeNull();
      expect(await cache.get('small')).toBeNull();
    });

    it('accepts keys that are not file names', async () => {
      const cache = await make({});
      await cache.put('a/b:c d', new Blob(['x']));
      await cache.put('.hidden', new Blob(['y']));
      expect(await (await cache.get('a/b:c d'))?.text()).toBe('x');
      expect(await (await cache.get('.hidden'))?.text()).toBe('y');
    });
  });
}

suite('MemoryBlobCache', async (options) => new MemoryBlobCache(options));
suite('OpfsBlobCache', (options) => OpfsBlobCache.open(new FakeDirectoryHandle('cache'), options));

describe('OpfsBlobCache', () => {
  const sha = 'ab'.repeat(32);

  it('keeps one file per key and an index', async () => {
    const dir = new FakeDirectoryHandle('originals');
    const cache = await OpfsBlobCache.open(dir);
    await cache.put(sha, new Blob(['raw']));
    await cache.put('not/a name', new Blob(['x']));
    const paths = await listPaths(dir);
    expect(paths).toContain(sha);
    expect(paths).toContain(CACHE_INDEX_FILE);
    expect(paths.filter((path) => path.startsWith('h-'))).toHaveLength(1);
  });

  it('keeps entries and use order across reopening', async () => {
    const dir = new FakeDirectoryHandle('originals');
    const first = await OpfsBlobCache.open(dir);
    await first.put('a', bytes(10));
    await first.put('b', bytes(10));
    await first.get('a');
    const second = await OpfsBlobCache.open(dir, { budget: 10 });
    expect(await second.get('b')).toBeNull();
    expect(await second.get('a')).not.toBeNull();
  });

  it('rebuilds a missing or damaged index from the directory', async () => {
    const dir = new FakeDirectoryHandle('originals');
    const first = await OpfsBlobCache.open(dir);
    await first.put(sha, new Blob(['raw']));
    await first.put('odd key', new Blob(['lost']));
    const writable = await (await dir.getFileHandle(CACHE_INDEX_FILE)).createWritable();
    await writable.write(new Blob(['{not json']));
    await writable.close();

    const rebuilt = await OpfsBlobCache.open(dir);
    expect(await (await rebuilt.get(sha))?.text()).toBe('raw');
    expect(await rebuilt.get('odd key')).toBeNull();
    expect(await rebuilt.usage()).toBe(3);
    expect((await listPaths(dir)).filter((path) => path.startsWith('h-'))).toEqual([]);

    await dir.removeEntry(CACHE_INDEX_FILE);
    expect(await (await (await OpfsBlobCache.open(dir)).get(sha))?.text()).toBe('raw');
  });

  it('drops index entries whose files are gone', async () => {
    const dir = new FakeDirectoryHandle('originals');
    const first = await OpfsBlobCache.open(dir);
    await first.put('a', bytes(4));
    await dir.removeEntry('a');
    expect(await first.get('a')).toBeNull();
    const second = await OpfsBlobCache.open(dir);
    expect(await second.usage()).toBe(0);
  });

  it('serializes concurrent writes', async () => {
    const dir = new FakeDirectoryHandle('originals');
    const cache = await OpfsBlobCache.open(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => cache.put(`k${i}`, bytes(i + 1))));
    const reopened = await OpfsBlobCache.open(dir);
    expect(await reopened.usage()).toBe((20 * 21) / 2);
  });
});
