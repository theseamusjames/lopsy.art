/**
 * An immutable map that is cheap to derive from: a shared base map plus a
 * small overlay of changes. Deriving copies only the overlay, and the
 * overlay is folded into a new base once it grows past a fraction of the
 * base, so a change costs O(overlay) and the occasional fold is amortised.
 * This is how a 50,000-photo view changes one photo without copying every
 * entry (spec 11).
 */

const DELETED: unique symbol = Symbol('deleted');
type Slot<V> = V | typeof DELETED;

const MIN_FOLD = 64;

export class OverlayMap<K, V> implements ReadonlyMap<K, V> {
  private readonly base: ReadonlyMap<K, V>;
  private readonly overlay: ReadonlyMap<K, Slot<V>>;
  readonly size: number;

  private constructor(base: ReadonlyMap<K, V>, overlay: ReadonlyMap<K, Slot<V>>, size: number) {
    this.base = base;
    this.overlay = overlay;
    this.size = size;
  }

  static empty<K, V>(): OverlayMap<K, V> {
    return new OverlayMap<K, V>(new Map(), new Map(), 0);
  }

  get(key: K): V | undefined {
    const slot = this.overlay.get(key);
    if (slot === DELETED) return undefined;
    if (slot !== undefined || this.overlay.has(key)) return slot as V;
    return this.base.get(key);
  }

  has(key: K): boolean {
    const slot = this.overlay.get(key);
    if (slot === DELETED) return false;
    return this.overlay.has(key) || this.base.has(key);
  }

  /** A new map with `set` written and `remove` deleted; this one is unchanged. */
  with(set: ReadonlyMap<K, V>, remove: Iterable<K> = []): OverlayMap<K, V> {
    const removals = [...remove];
    if (set.size === 0 && removals.length === 0) return this;
    const overlay = new Map(this.overlay);
    let size = this.size;
    const present = (key: K) => {
      const slot = overlay.get(key);
      if (slot === DELETED) return false;
      return overlay.has(key) || this.base.has(key);
    };
    for (const key of removals) {
      if (set.has(key) || !present(key)) continue;
      overlay.set(key, DELETED);
      size -= 1;
    }
    for (const [key, value] of set) {
      if (!present(key)) size += 1;
      overlay.set(key, value);
    }
    // Each change copies the overlay and a fold copies the base, so an overlay near sqrt(base) balances the two.
    if (overlay.size > Math.max(MIN_FOLD, Math.sqrt(this.base.size))) {
      const folded = new Map(this.base);
      for (const [key, slot] of overlay) {
        if (slot === DELETED) folded.delete(key);
        else folded.set(key, slot);
      }
      return new OverlayMap(folded, new Map(), folded.size);
    }
    return new OverlayMap(this.base, overlay, size);
  }

  *entries(): MapIterator<[K, V]> {
    for (const [key, value] of this.base) {
      if (!this.overlay.has(key)) yield [key, value];
    }
    for (const [key, slot] of this.overlay) {
      if (slot !== DELETED) yield [key, slot];
    }
  }

  *keys(): MapIterator<K> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): MapIterator<V> {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
  }
}
