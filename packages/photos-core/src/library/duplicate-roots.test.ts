import { describe, expect, it } from 'vitest';
import { ensureLibrary } from './layout';
import { MemoryLocalStore } from './local-store';
import { openLibrary } from './session';
import { TestAdapter } from './test-support/test-adapter';

/** Two devices set up at the same moment: each makes its own `Lopsy Photos/` root. */
async function racedSetup() {
  const adapter = new TestAdapter();
  const storeA = new MemoryLocalStore();
  const storeB = new MemoryLocalStore();
  const a = await openLibrary({ adapter, store: storeA, autoSync: false });
  a.setSetting('fromA', 1);
  await a.syncNow();
  // Hide A's root while B sets up, as if both looked before either had created one.
  await adapter.updateProperties(a.layout.rootId, { 'lp.role': null });
  const b = await openLibrary({ adapter, store: storeB, autoSync: false });
  await adapter.updateProperties(a.layout.rootId, { 'lp.role': 'library' });
  b.setSetting('fromB', 2);
  await b.syncNow();
  expect(b.libraryId).not.toBe(a.libraryId);
  return { adapter, a, b, storeA, storeB };
}

describe('duplicate library roots', () => {
  it('lists the other roots’ journals without creating anything there', async () => {
    const { adapter, a, b } = await racedSetup();
    const count = adapter.allFiles().length;
    const ensured = await ensureLibrary(adapter);
    expect(adapter.allFiles().length).toBe(count);
    const ids = [a.libraryId, b.libraryId];
    expect(ids).toContain(ensured.layout.libraryId);
    expect(ensured.otherJournals.map((j) => j.libraryId)).toEqual(ids.filter((id) => id !== ensured.layout.libraryId));
  });

  it('merges both roots: devices keep their root and read the other, new devices see everything', async () => {
    const { adapter, a, b, storeA, storeB } = await racedSetup();
    await a.close();
    await b.close();
    const a2 = await openLibrary({ adapter, store: storeA, autoSync: false });
    const b2 = await openLibrary({ adapter, store: storeB, autoSync: false });
    expect(a2.libraryId).toBe(a.libraryId);
    expect(b2.libraryId).toBe(b.libraryId);
    a2.setSetting('later', 3);
    await a2.syncNow();
    await b2.syncNow();
    const c = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await c.syncNow();
    const expected = { fromA: 1, fromB: 2, later: 3 };
    for (const s of [a2, b2, c]) {
      await s.syncNow();
      expect(Object.fromEntries(s.getView().settings)).toEqual(expected);
    }
  });
});
