import { describe, expect, it } from 'vitest';
import { compareHlc, encodeHlc, HybridClock, parseHlc } from './hlc';

describe('hlc encoding', () => {
  it('round trips and sorts as plain strings', () => {
    const a = encodeHlc({ wall: 5, counter: 99, device: 'zzz' });
    const b = encodeHlc({ wall: 10, counter: 0, device: 'aaa' });
    const c = encodeHlc({ wall: 10, counter: 1, device: 'aaa' });
    const d = encodeHlc({ wall: 10, counter: 1, device: 'bbb' });
    expect([d, c, b, a].sort()).toEqual([a, b, c, d]);
    expect(parseHlc(c)).toEqual({ wall: 10, counter: 1, device: 'aaa' });
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, b)).toBe(0);
  });

  it('rejects malformed stamps', () => {
    for (const bad of ['', 'abc', '000000000000001-00000-', '00000000000000x-00000-dev', '000000000000001_00000-dev', '000000000000001-00000-bad:dev', 42, null]) {
      expect(parseHlc(bad)).toBeNull();
    }
  });
});

describe('HybridClock', () => {
  it('is strictly increasing when the wall clock stalls or goes backwards', () => {
    let wall = 1000;
    const clock = new HybridClock('dev', () => wall);
    const stamps = [clock.now(), clock.now()];
    wall = 500;
    stamps.push(clock.now(), clock.now());
    wall = 2000;
    stamps.push(clock.now());
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]! > stamps[i - 1]!).toBe(true);
    expect(parseHlc(stamps[4])?.wall).toBe(2000);
  });

  it('moves past remote stamps from a clock running ahead', () => {
    const slow = new HybridClock('slow', () => 1_000);
    const fast = new HybridClock('fast', () => 9_000_000);
    const remote = fast.now();
    slow.receive(remote);
    const local = slow.now();
    expect(local > remote).toBe(true);
    expect(parseHlc(local)?.wall).toBe(9_000_000);
  });

  it('orders causally related events across skewed devices', () => {
    // Device B's clock is an hour behind A's. B edits after seeing A's edit; B must win.
    const a = new HybridClock('a', () => 3_600_000 + 10);
    const b = new HybridClock('b', () => 10);
    const fromA = a.now();
    b.receive(fromA);
    const fromB = b.now();
    expect(compareHlc(fromB, fromA)).toBe(1);
  });

  it('ignores garbage stamps', () => {
    const clock = new HybridClock('dev', () => 5);
    clock.receive('not a stamp');
    expect(parseHlc(clock.now())?.wall).toBe(5);
  });

  it('carries into the wall time when the counter overflows', () => {
    const clock = new HybridClock('dev', () => 7);
    clock.receive(encodeHlc({ wall: 7, counter: 99_999, device: 'other' }));
    const next = parseHlc(clock.now());
    expect(next).toEqual({ wall: 8, counter: 0, device: 'dev' });
  });

  it('refuses unsafe device IDs', () => {
    expect(() => new HybridClock('a:b')).toThrow();
  });
});
