import { describe, expect, it } from 'vitest';
import { LruCache } from './lru';

describe('LruCache', () => {
  it('evicts the least recently used entry and reports it', () => {
    const evicted: string[] = [];
    const lru = new LruCache<string, number>(2, (k) => evicted.push(k));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
    expect(lru.size).toBe(2);
  });

  it('reports a replaced value', () => {
    const evicted: number[] = [];
    const lru = new LruCache<string, number>(3, (_k, v) => evicted.push(v));
    lru.set('a', 1);
    lru.set('a', 2);
    expect(evicted).toEqual([1]);
    expect(lru.get('a')).toBe(2);
  });

  it('reports every entry on clear and delete', () => {
    const evicted: string[] = [];
    const lru = new LruCache<string, number>(5, (k) => evicted.push(k));
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.delete('b');
    lru.clear();
    expect(evicted).toEqual(['b', 'a', 'c']);
    expect(lru.size).toBe(0);
  });

  it('rejects a zero capacity', () => {
    expect(() => new LruCache(0)).toThrow();
  });
});
