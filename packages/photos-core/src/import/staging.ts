/**
 * Staging (spec 6.7): each import is copied onto the device before it is
 * uploaded, so a reload, crash or sleeping laptop does not lose it. Keys
 * are the files' SHA-256, so they are safe file names.
 */

export interface StagingStore {
  put(key: string, blob: Blob): Promise<void>;
  /** The staged copy; null when there is none. */
  get(key: string): Promise<Blob | null>;
  /** Removes a staged copy; no error when there is none. */
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  /** Whether `bytes` more would fit. Imports go unstaged when they would not. */
  hasRoomFor(bytes: number): Promise<boolean>;
}

export class MemoryStagingStore implements StagingStore {
  readonly blobs = new Map<string, Blob>();

  constructor(private readonly capacityBytes = Number.POSITIVE_INFINITY) {}

  private usedBytes(): number {
    let used = 0;
    for (const blob of this.blobs.values()) used += blob.size;
    return used;
  }

  async put(key: string, blob: Blob): Promise<void> {
    if (this.usedBytes() - (this.blobs.get(key)?.size ?? 0) + blob.size > this.capacityBytes) {
      throw new Error('Staging is full');
    }
    this.blobs.set(key, blob);
  }

  async get(key: string): Promise<Blob | null> {
    return this.blobs.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async list(): Promise<string[]> {
    return [...this.blobs.keys()];
  }

  async hasRoomFor(bytes: number): Promise<boolean> {
    return this.usedBytes() + bytes <= this.capacityBytes;
  }
}

/** Kept free beyond the file itself, so staging never fills the origin's quota. */
const QUOTA_HEADROOM_BYTES = 256 * 1024 * 1024;

const SAFE_KEY = /^[A-Za-z0-9._-]{1,200}$/;

function checkKey(key: string): string {
  if (!SAFE_KEY.test(key) || key === '.' || key === '..') throw new Error(`Bad staging key: ${key}`);
  return key;
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError');
}

/** Browser-only: a directory in the origin private file system. */
export class OpfsStagingStore implements StagingStore {
  private constructor(private readonly dir: FileSystemDirectoryHandle) {}

  /**
   * Opens `photonamous-staging/<libraryId>/`; null when OPFS or writable
   * files are unavailable (Safari outside a worker has no createWritable),
   * in which case imports run unstaged.
   */
  static async open(libraryId: string): Promise<OpfsStagingStore | null> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
      const root = await navigator.storage.getDirectory();
      const base = await root.getDirectoryHandle('photonamous-staging', { create: true });
      const dir = await base.getDirectoryHandle(checkKey(libraryId.replace(/[^A-Za-z0-9._-]/g, '_')), { create: true });
      const probe = await dir.getFileHandle('.probe', { create: true });
      if (typeof (probe as { createWritable?: unknown }).createWritable !== 'function') return null;
      await dir.removeEntry('.probe');
      return new OpfsStagingStore(dir);
    } catch {
      return null;
    }
  }

  async put(key: string, blob: Blob): Promise<void> {
    const handle = await this.dir.getFileHandle(checkKey(key), { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      await this.delete(key);
      throw error;
    }
  }

  async get(key: string): Promise<Blob | null> {
    try {
      const handle = await this.dir.getFileHandle(checkKey(key));
      return await handle.getFile();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.dir.removeEntry(checkKey(key));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async list(): Promise<string[]> {
    const keys: string[] = [];
    // The DOM typings in use lack the directory handle's async iterators.
    const iterable = this.dir as unknown as { keys(): AsyncIterable<string> };
    for await (const key of iterable.keys()) if (key !== '.probe') keys.push(key);
    return keys;
  }

  async hasRoomFor(bytes: number): Promise<boolean> {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota === undefined || usage === undefined) return true;
      return quota - usage >= bytes + QUOTA_HEADROOM_BYTES;
    } catch {
      return false;
    }
  }
}
