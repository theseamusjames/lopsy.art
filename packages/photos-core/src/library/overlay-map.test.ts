import { describe, expect, it } from 'vitest';
import { OverlayMap } from './overlay-map';
import { seededRandom } from './test-support/random';

describe('OverlayMap', () => {
  it('behaves like a Map through sets, deletes and folds (seeded)', () => {
    const random = seededRandom(7);
    let map = OverlayMap.empty<string, number>();
    const model = new Map<string, number>();
    const snapshots: [OverlayMap<string, number>, Map<string, number>][] = [];
    for (let step = 0; step < 3000; step++) {
      const set = new Map<string, number>();
      const remove: string[] = [];
      for (let i = 0; i < 1 + Math.floor(random() * 5); i++) {
        const key = `k${Math.floor(random() * 400)}`;
        if (random() < 0.3) remove.push(key);
        else set.set(key, step);
      }
      map = map.with(set, remove);
      for (const key of remove) if (!set.has(key)) model.delete(key);
      for (const [k, v] of set) model.set(k, v);
      if (step % 500 === 0) snapshots.push([map, new Map(model)]);
      expect(map.size).toBe(model.size);
    }
    expect(new Map(map)).toEqual(model);
    for (const [k, v] of model) expect(map.get(k)).toBe(v);
    expect(map.has('missing')).toBe(false);
    // Older versions are unchanged by later ones.
    for (const [old, expected] of snapshots) expect(new Map(old.entries())).toEqual(expected);
  });

  it('returns itself when nothing changes', () => {
    const map = OverlayMap.empty<string, number>().with(new Map([['a', 1]]));
    expect(map.with(new Map())).toBe(map);
    expect([...map.keys()]).toEqual(['a']);
    expect([...map.values()]).toEqual([1]);
  });
});
