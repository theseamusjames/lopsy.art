/**
 * A size-bounded cache of Blobs on the device (spec 6.7): originals and
 * screen previews that can always be fetched again from storage. Past its
 * budget it evicts the least recently used entries, except pinned ones
 * (the original open in the editor).
 */

export interface BlobCache {
  /** The cached blob, or null. Counts as a use for eviction. */
  get(key: string): Promise<Blob | null>;
  /** Stores (or replaces) the blob, then evicts past the budget. */
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
  /** Bytes held. */
  usage(): Promise<number>;
  /** Changes the budget and evicts down to it. */
  setBudget(bytes: number): Promise<void>;
  /** Keeps the key from eviction until as many unpin calls. A key need not exist yet. */
  pin(key: string): void;
  unpin(key: string): void;
}

export interface CacheEntry {
  readonly key: string;
  readonly size: number;
  lastUsed: number;
}

/**
 * Bookkeeping shared by the implementations: pins, use times and which
 * keys to evict. Plain data; the implementations hold the bytes.
 */
export class LruBook {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pins = new Map<string, number>();
  private lastStamp = 0;

  constructor(
    public budget: number,
    private readonly now: () => number,
  ) {}

  /** Strictly increasing, so two uses in one millisecond still order. */
  stamp(): number {
    this.lastStamp = Math.max(this.lastStamp + 1, this.now());
    return this.lastStamp;
  }

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  all(): CacheEntry[] {
    return [...this.entries.values()];
  }

  set(entry: CacheEntry): void {
    this.entries.set(entry.key, entry);
    this.lastStamp = Math.max(this.lastStamp, entry.lastUsed);
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  usage(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.size;
    return total;
  }

  pin(key: string): void {
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
  }

  unpin(key: string): void {
    const count = (this.pins.get(key) ?? 0) - 1;
    if (count > 0) this.pins.set(key, count);
    else this.pins.delete(key);
  }

  isPinned(key: string): boolean {
    return this.pins.has(key);
  }

  /** Keys to drop, oldest use first, until usage fits the budget. Pinned keys and `keep` stay. */
  victims(keep?: string): string[] {
    let excess = this.usage() - this.budget;
    if (excess <= 0) return [];
    const candidates = this.all()
      .filter((entry) => entry.key !== keep && !this.isPinned(entry.key))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const victims: string[] = [];
    for (const entry of candidates) {
      if (excess <= 0) break;
      victims.push(entry.key);
      excess -= entry.size;
    }
    return victims;
  }
}

export interface BlobCacheOptions {
  /** Bytes; unlimited when absent. */
  readonly budget?: number;
  readonly now?: () => number;
}

export class MemoryBlobCache implements BlobCache {
  private readonly blobs = new Map<string, Blob>();
  private readonly book: LruBook;

  constructor(options: BlobCacheOptions = {}) {
    this.book = new LruBook(options.budget ?? Number.POSITIVE_INFINITY, options.now ?? Date.now);
  }

  async get(key: string): Promise<Blob | null> {
    const entry = this.book.get(key);
    const blob = this.blobs.get(key);
    if (!entry || !blob) return null;
    entry.lastUsed = this.book.stamp();
    return blob;
  }

  async put(key: string, blob: Blob): Promise<void> {
    this.blobs.set(key, blob);
    this.book.set({ key, size: blob.size, lastUsed: this.book.stamp() });
    this.evict(key);
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
    this.book.remove(key);
  }

  async usage(): Promise<number> {
    return this.book.usage();
  }

  async setBudget(bytes: number): Promise<void> {
    this.book.budget = bytes;
    this.evict();
  }

  pin(key: string): void {
    this.book.pin(key);
  }

  unpin(key: string): void {
    this.book.unpin(key);
    this.evict();
  }

  private evict(keep?: string): void {
    for (const key of this.book.victims(keep)) {
      this.blobs.delete(key);
      this.book.remove(key);
    }
  }
}
