/**
 * A small least-recently-used map. `onEvict` runs for every entry that
 * leaves, so a cache of object URLs can revoke them.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly capacity: number;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;

  constructor(capacity: number, onEvict?: (key: K, value: V) => void) {
    if (capacity < 1) throw new Error('LruCache capacity must be at least 1');
    this.capacity = capacity;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Reads and marks as most recently used. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    const old = this.entries.get(key);
    if (old !== undefined) {
      this.entries.delete(key);
      if (old !== value) this.onEvict?.(key, old);
    }
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const evicted = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (evicted !== undefined) this.onEvict?.(oldest.value, evicted);
    }
  }

  delete(key: K): void {
    const value = this.entries.get(key);
    if (value === undefined) return;
    this.entries.delete(key);
    this.onEvict?.(key, value);
  }

  clear(): void {
    for (const [key, value] of this.entries) this.onEvict?.(key, value);
    this.entries.clear();
  }
}
