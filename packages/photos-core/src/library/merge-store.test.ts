import { describe, expect, it } from 'vitest';
import { HybridClock } from './hlc';
import { MergeStore } from './merge-store';
import { canonicalView } from './test-support/canonical';
import { pickOne, seededRandom, shuffled } from './test-support/random';
import type { Json, Op, OpEnvelope } from './types';
import { ViewCache } from './view';

class Device {
  readonly store = new MergeStore();
  readonly cache = new ViewCache(this.store);
  readonly clock: HybridClock;
  readonly made: OpEnvelope[] = [];
  private seq = 0;

  constructor(
    readonly id: string,
    physical: () => number,
  ) {
    this.clock = new HybridClock(id, physical);
  }

  make(op: Op, step?: { id: string; label: string }): OpEnvelope {
    this.seq += 1;
    const env: OpEnvelope = {
      id: `${this.id}:${this.seq}`,
      device: this.id,
      seq: this.seq,
      hlc: this.clock.now(),
      v: 1,
      ...(step ? { step } : {}),
      op,
    };
    this.made.push(env);
    this.receive([env]);
    return env;
  }

  receive(envs: readonly OpEnvelope[]): void {
    for (const e of envs) this.clock.receive(e.hlc);
    this.cache.update(this.store.applyOps(envs));
  }
}

const ASSETS = ['a1', 'a2', 'a3'];
const VERSIONS = ['v1', 'v2'];
const KEYWORDS = ['cat', 'dog', 'sea', 'sky'];

function randomOp(random: () => number): Op {
  const roll = random();
  if (roll < 0.25) {
    const fields: Record<string, Json> = {};
    const count = 1 + Math.floor(random() * 3);
    for (let i = 0; i < count; i++) {
      const field = pickOne(random, ['rating', 'title', 'label', 'setAside']);
      fields[field] =
        field === 'rating'
          ? Math.floor(random() * 6)
          : field === 'title'
            ? pickOne(random, ['', 'Sunset', 'Harbour'])
            : field === 'label'
              ? pickOne(random, [null, 'red', 'blue'])
              : random() < 0.5;
    }
    return { t: 'set', kind: 'asset', id: pickOne(random, ASSETS), fields };
  }
  if (roll < 0.4) {
    return { t: 'set', kind: 'asset', id: pickOne(random, ASSETS), fields: { deleted: random() < 0.5 } };
  }
  if (roll < 0.6) {
    return {
      t: 'member',
      kind: 'asset',
      id: pickOne(random, ASSETS),
      set: 'keywords',
      member: pickOne(random, KEYWORDS),
      present: random() < 0.6,
    };
  }
  if (roll < 0.85) {
    const path = pickOne(random, ['recipe.tone.exposure', 'recipe.tone.contrast', 'recipe.color.vibrance']);
    return {
      t: 'set',
      kind: 'version',
      id: pickOne(random, VERSIONS),
      fields: { [path]: Math.round((random() * 4 - 2) * 100) / 100 },
    };
  }
  if (roll < 0.95) {
    return {
      t: 'member',
      kind: 'album',
      id: 'al1',
      set: 'assets',
      member: pickOne(random, ASSETS),
      present: random() < 0.5,
    };
  }
  return { t: 'set', kind: 'setting', id: pickOne(random, ['theme', 'grid']), fields: { value: pickOne(random, [1, 'x', null, true]) } };
}

function runScenario(seed: number): { views: unknown[]; serialized: unknown[] } {
  const random = seededRandom(seed);
  let wall = 1_000_000;
  // Skewed clocks: one ahead, one behind, one that jumps backwards now and then.
  const devices = [
    new Device('dev-a', () => wall + 60_000),
    new Device('dev-b', () => wall - 45_000),
    new Device('dev-c', () => (random() < 0.2 ? wall - 100_000 : wall)),
  ];
  const [first] = devices;
  for (const id of ASSETS) first!.make({ t: 'set', kind: 'asset', id, fields: { fileId: `file-${id}`, rating: 0 } });
  for (const [i, id] of VERSIONS.entries()) {
    first!.make({ t: 'set', kind: 'version', id, fields: { assetId: ASSETS[i]!, name: 'Original' } });
  }
  first!.make({ t: 'set', kind: 'album', id: 'al1', fields: { name: 'Trip' } });

  for (let step = 0; step < 400; step++) {
    wall += Math.floor(random() * 50);
    const device = pickOne(random, devices);
    if (random() < 0.2) {
      // Partial, out-of-order gossip so later edits are causally after earlier ones elsewhere.
      const other = pickOne(random, devices);
      const some = other.made.filter(() => random() < 0.5);
      device.receive(shuffled(random, some));
    } else {
      device.make(randomOp(random));
    }
  }

  const all = devices.flatMap((d) => d.made);
  for (const device of devices) {
    const delivery = shuffled(random, [...all, ...all.filter(() => random() < 0.3)]);
    // Deliver in random batch sizes, as segments would arrive.
    while (delivery.length > 0) device.receive(delivery.splice(0, 1 + Math.floor(random() * 40)));
  }
  return {
    views: devices.map((d) => canonicalView(d.cache.view)),
    serialized: devices.map((d) => {
      const out: unknown[] = [];
      for (const kind of ['asset', 'version', 'album', 'setting'] as const) {
        for (const id of [...d.store.ids(kind)].sort()) {
          const r = d.store.get(kind, id)!;
          out.push([
            kind,
            id,
            [...r.fields].sort(([a], [b]) => (a < b ? -1 : 1)),
            [...r.sets].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, m]) => [n, [...m].sort(([a], [b]) => (a < b ? -1 : 1))]),
          ]);
        }
      }
      return out;
    }),
  };
}

describe('MergeStore', () => {
  it('converges for any delivery order, with duplicates (seeded property test)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { views, serialized } = runScenario(seed);
      expect(views[1], `seed ${seed}`).toEqual(views[0]);
      expect(views[2], `seed ${seed}`).toEqual(views[0]);
      expect(serialized[1], `seed ${seed}`).toEqual(serialized[0]);
      expect(serialized[2], `seed ${seed}`).toEqual(serialized[0]);
    }
  });

  it('is idempotent', () => {
    const d = new Device('dev', () => 10);
    const env = d.make({ t: 'set', kind: 'asset', id: 'x', fields: { fileId: 'f', rating: 3 } });
    expect(d.store.applyOps([env])).toEqual([]);
  });

  it('breaks equal-HLC ties by op id', () => {
    const fields = (rating: number): Op => ({ t: 'set', kind: 'asset', id: 'x', fields: { fileId: 'f', rating } });
    const hlc = '000000000000010-00000-dev';
    const a: OpEnvelope = { id: 'dev:1', device: 'dev', seq: 1, hlc, v: 1, op: fields(1) };
    const b: OpEnvelope = { id: 'dev:2', device: 'dev', seq: 2, hlc, v: 1, op: fields(2) };
    const s1 = new MergeStore();
    s1.applyOps([a, b]);
    const s2 = new MergeStore();
    s2.applyOps([b, a]);
    expect(s1.get('asset', 'x')?.fields.get('rating')?.value).toBe(2);
    expect(s2.get('asset', 'x')?.fields.get('rating')?.value).toBe(2);
  });

  it('round trips through serialize', () => {
    const d = new Device('dev', () => 10);
    d.make({ t: 'set', kind: 'asset', id: 'x', fields: { fileId: 'f', title: 'T' } });
    d.make({ t: 'member', kind: 'asset', id: 'x', set: 'keywords', member: 'k', present: true });
    d.make({ t: 'set', kind: 'version', id: 'v', fields: { assetId: 'x', 'recipe.tone.exposure': 1 } }, { id: 's', label: 'L' });
    const copy = MergeStore.deserialize(JSON.parse(JSON.stringify(d.store.serialize())));
    expect(canonicalView(new ViewCache(copy).view)).toEqual(canonicalView(d.cache.view));
    expect(copy.recipeWrites('v')).toEqual(d.store.recipeWrites('v'));
    expect(copy.maxHlc).toBe(d.store.maxHlc);
  });

  it('rejects malformed serialized data', () => {
    expect(() => MergeStore.deserialize(null)).toThrow();
    expect(() => MergeStore.deserialize({ format: 3 })).toThrow();
    expect(() =>
      MergeStore.deserialize({ format: 2, maxHlc: null, stamps: [], entities: [{ kind: 'nope', id: 'x', writes: [], sets: [] }], history: [] }),
    ).toThrow();
    expect(() =>
      MergeStore.deserialize({
        format: 2,
        maxHlc: null,
        stamps: ['bad-hlc op'],
        entities: [{ kind: 'asset', id: 'x', writes: [[0, { rating: 1 }]], sets: [] }],
        history: [],
      }),
    ).toThrow();
  });
});

describe('ViewCache', () => {
  it('keeps identity for unchanged entities and replaces the view only on change', () => {
    const d = new Device('dev', () => 10);
    d.make({ t: 'set', kind: 'asset', id: 'x', fields: { fileId: 'f1' } });
    d.make({ t: 'set', kind: 'asset', id: 'y', fields: { fileId: 'f2' } });
    const before = d.cache.view;
    const y = before.assets.get('y');
    d.make({ t: 'set', kind: 'asset', id: 'x', fields: { rating: 4 } });
    const after = d.cache.view;
    expect(after).not.toBe(before);
    expect(after.assets.get('y')).toBe(y);
    expect(after.assets.get('x')?.rating).toBe(4);
    expect(after.versions).toBe(before.versions);
    const env = d.made[d.made.length - 1]!;
    d.receive([env]);
    expect(d.cache.view).toBe(after);
  });

  it('hides entities whose creating fields have not arrived', () => {
    const d = new Device('dev', () => 10);
    d.make({ t: 'set', kind: 'asset', id: 'x', fields: { rating: 5 } });
    expect(d.cache.view.assets.size).toBe(0);
    d.make({ t: 'set', kind: 'asset', id: 'x', fields: { fileId: 'f' } });
    expect(d.cache.view.assets.get('x')?.rating).toBe(5);
  });

  it('builds the recipe from recipe fields with clamping', () => {
    const d = new Device('dev', () => 10);
    d.make({ t: 'set', kind: 'version', id: 'v', fields: { assetId: 'x', 'recipe.tone.exposure': 99, 'recipe.color.vibrance': 20 } });
    const v = d.cache.view.versions.get('v');
    expect(v?.recipe.tone.exposure).toBe(5);
    expect(v?.recipe.color.vibrance).toBe(20);
  });
});
