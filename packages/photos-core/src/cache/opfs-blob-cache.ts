/**
 * A BlobCache in a File System Access directory (an OPFS folder in the
 * browser): one file per key plus a small JSON index of sizes and use
 * times, written under a mutex. A missing or damaged index is rebuilt from
 * the directory listing; on open the index and the listing are reconciled,
 * so a crash between writing a file and the index loses nothing but the
 * use times.
 */

import { sha256Hex } from '../storage/content-hash';
import { Mutex } from '../storage/mutex';
import type { DirectoryHandle } from '../storage/local-folder-adapter';
import { LruBook, type BlobCache, type BlobCacheOptions } from './blob-cache';

export const CACHE_INDEX_FILE = '.cache-index.json';
/** Keys that are already safe file names (sha256 hex, Drive IDs) are used as-is. */
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const HASHED_PREFIX = 'h-';

interface IndexRecord {
  readonly key: string;
  readonly file: string;
  readonly size: number;
  readonly lastUsed: number;
}

export class OpfsBlobCache implements BlobCache {
  private readonly mutex = new Mutex();
  /** Key to file name. */
  private readonly files = new Map<string, string>();

  private constructor(
    private readonly dir: DirectoryHandle,
    private readonly book: LruBook,
  ) {}

  static async open(dir: DirectoryHandle, options: BlobCacheOptions = {}): Promise<OpfsBlobCache> {
    const now = options.now ?? Date.now;
    const cache = new OpfsBlobCache(dir, new LruBook(options.budget ?? Number.POSITIVE_INFINITY, now));
    await cache.mutex.run(async () => {
      for (const record of await readIndex(dir)) {
        cache.files.set(record.key, record.file);
        cache.book.set({ key: record.key, size: record.size, lastUsed: record.lastUsed });
      }
      await cache.reconcile();
      await cache.evictLocked();
      await cache.saveIndex();
    });
    return cache;
  }

  get(key: string): Promise<Blob | null> {
    return this.mutex.run(async () => {
      const entry = this.book.get(key);
      const name = this.files.get(key);
      if (!entry || name === undefined) return null;
      let file: File;
      try {
        file = await (await this.dir.getFileHandle(name)).getFile();
      } catch {
        this.forget(key);
        await this.saveIndex();
        return null;
      }
      entry.lastUsed = this.book.stamp();
      await this.saveIndex();
      return file;
    });
  }

  has(key: string): Promise<boolean> {
    return this.mutex.run(async () => this.book.get(key) !== undefined && this.files.has(key));
  }

  put(key: string, blob: Blob): Promise<void> {
    return this.mutex.run(async () => {
      const name = await fileNameFor(key);
      const writable = await (await this.dir.getFileHandle(name, { create: true })).createWritable();
      try {
        await writable.write(blob);
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      await writable.close();
      this.files.set(key, name);
      this.book.set({ key, size: blob.size, lastUsed: this.book.stamp() });
      await this.evictLocked(key);
      await this.saveIndex();
    });
  }

  delete(key: string): Promise<void> {
    return this.mutex.run(async () => {
      await this.removeFile(key);
      await this.saveIndex();
    });
  }

  usage(): Promise<number> {
    return this.mutex.run(async () => this.book.usage());
  }

  setBudget(bytes: number): Promise<void> {
    return this.mutex.run(async () => {
      this.book.budget = bytes;
      await this.evictLocked();
      await this.saveIndex();
    });
  }

  pin(key: string): void {
    this.book.pin(key);
  }

  unpin(key: string): void {
    this.book.unpin(key);
    void this.mutex
      .run(async () => {
        await this.evictLocked();
        await this.saveIndex();
      })
      .catch(() => undefined);
  }

  private forget(key: string): void {
    this.files.delete(key);
    this.book.remove(key);
  }

  private async removeFile(key: string): Promise<void> {
    const name = this.files.get(key);
    this.forget(key);
    if (name === undefined) return;
    try {
      await this.dir.removeEntry(name);
    } catch {
      // Already gone; the index no longer lists it either way.
    }
  }

  private async evictLocked(keep?: string): Promise<void> {
    for (const key of this.book.victims(keep)) await this.removeFile(key);
  }

  private async saveIndex(): Promise<void> {
    const records: IndexRecord[] = this.book.all().map((entry) => ({
      key: entry.key,
      file: this.files.get(entry.key) ?? '',
      size: entry.size,
      lastUsed: entry.lastUsed,
    }));
    const writable = await (await this.dir.getFileHandle(CACHE_INDEX_FILE, { create: true })).createWritable();
    await writable.write(new Blob([JSON.stringify({ version: 1, entries: records })], { type: 'application/json' }));
    await writable.close();
  }

  /** Matches the index to the files present: drops entries without files, adopts or deletes stray files. */
  private async reconcile(): Promise<void> {
    const listing = await listFiles(this.dir);
    if (listing === null) return;
    const present = new Set(listing);
    for (const [key, name] of [...this.files]) if (!present.has(name)) this.forget(key);
    const known = new Set(this.files.values());
    for (const name of listing) {
      if (name === CACHE_INDEX_FILE || known.has(name)) continue;
      // A hashed name cannot be turned back into its key; the bytes can be fetched again.
      if (name.startsWith(HASHED_PREFIX) || !SAFE_NAME.test(name)) {
        await this.dir.removeEntry(name).catch(() => undefined);
        continue;
      }
      const file = await (await this.dir.getFileHandle(name)).getFile();
      this.files.set(name, name);
      this.book.set({ key: name, size: file.size, lastUsed: file.lastModified });
    }
  }
}

async function fileNameFor(key: string): Promise<string> {
  if (SAFE_NAME.test(key) && !key.startsWith(HASHED_PREFIX) && key !== CACHE_INDEX_FILE) return key;
  return `${HASHED_PREFIX}${await sha256Hex(new Blob([key]))}`;
}

async function readIndex(dir: DirectoryHandle): Promise<IndexRecord[]> {
  let text: string;
  try {
    text = await (await (await dir.getFileHandle(CACHE_INDEX_FILE)).getFile()).text();
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const entries: unknown = Reflect.get(parsed, 'entries');
  if (!Array.isArray(entries)) return [];
  return entries.filter(isIndexRecord);
}

function isIndexRecord(value: unknown): value is IndexRecord {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'key') === 'string' &&
    typeof Reflect.get(value, 'file') === 'string' &&
    typeof Reflect.get(value, 'size') === 'number' &&
    typeof Reflect.get(value, 'lastUsed') === 'number'
  );
}

/**
 * The names of the files in `dir`, or null when the handle cannot list
 * (TypeScript's DOM types omit the async iterators, so they are found at runtime).
 */
async function listFiles(dir: DirectoryHandle): Promise<string[] | null> {
  const entries: unknown = Reflect.get(dir, 'entries');
  if (typeof entries !== 'function') return null;
  const iterator: unknown = Reflect.apply(entries, dir, []);
  if (!isAsyncIterable(iterator)) return null;
  const names: string[] = [];
  for await (const item of iterator) {
    if (!Array.isArray(item)) continue;
    const [name, handle]: unknown[] = item;
    if (typeof name === 'string' && typeof handle === 'object' && handle !== null && Reflect.get(handle, 'kind') === 'file') {
      names.push(name);
    }
  }
  return names;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, Symbol.asyncIterator) === 'function';
}
