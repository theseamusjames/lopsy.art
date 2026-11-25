import { describe, expect, it } from 'vitest';
import { DecodeError, gzipText } from './gzip';
import { encodeHlc } from './hlc';
import { MergeStore } from './merge-store';
import {
  decodeSnapshot,
  encodeSnapshot,
  listSnapshots,
  loadNewestSnapshot,
  parseSnapshotName,
  snapshotName,
  writeSnapshot,
  type SnapshotData,
} from './snapshot';
import { TestAdapter } from './test-support/test-adapter';

function storeWithData(): MergeStore {
  const store = new MergeStore();
  store.applyOps([
    { id: 'dev-a:1', device: 'dev-a', seq: 1, hlc: encodeHlc({ wall: 5, counter: 0, device: 'dev-a' }), v: 1, op: { t: 'set', kind: 'asset', id: 'x', fields: { fileId: 'f', rating: 3 } } },
    { id: 'dev-a:2', device: 'dev-a', seq: 2, hlc: encodeHlc({ wall: 6, counter: 0, device: 'dev-a' }), v: 1, op: { t: 'member', kind: 'asset', id: 'x', set: 'keywords', member: 'k', present: true } },
  ]);
  return store;
}

function data(device: string, wall: number, store = storeWithData()): SnapshotData {
  return { format: 1, libraryId: 'lib', device, hlc: encodeHlc({ wall, counter: 0, device }), vector: { 'dev-a': 2 }, store: store.serialize() };
}

describe('snapshot names', () => {
  it('round trip, even with dashes in the device ID', () => {
    const hlc = encodeHlc({ wall: 123, counter: 4, device: 'a-b-c' });
    expect(parseSnapshotName(snapshotName(hlc, 'a-b-c'))).toEqual({ hlc, device: 'a-b-c' });
    expect(parseSnapshotName('nope.json.gz')).toBeNull();
    expect(parseSnapshotName(`${hlc}-other.json.gz`)).toBeNull();
  });
});

describe('snapshot encoding', () => {
  it('round trips', async () => {
    const loaded = await decodeSnapshot(await encodeSnapshot(data('dev-a', 10)));
    expect(loaded.vector).toEqual({ 'dev-a': 2 });
    expect(loaded.store.serialize()).toEqual(storeWithData().serialize());
  });

  it('rejects malformed snapshots', async () => {
    const good = data('dev-a', 10);
    const cases: unknown[] = [
      'not an object',
      { ...good, format: 9 },
      { ...good, libraryId: '' },
      { ...good, device: 'bad:id' },
      { ...good, hlc: encodeHlc({ wall: 1, counter: 0, device: 'someone-else' }) },
      { ...good, vector: { 'dev-a': -1 } },
      { ...good, store: { format: 1, maxHlc: null, entities: 'x', history: [] } },
    ];
    for (const c of cases) {
      await expect(decodeSnapshot(await gzipText(JSON.stringify(c)))).rejects.toBeInstanceOf(DecodeError);
    }
    await expect(decodeSnapshot(await gzipText('{oops'))).rejects.toBeInstanceOf(DecodeError);
    await expect(decodeSnapshot(new Blob(['raw']))).rejects.toBeInstanceOf(DecodeError);
  });
});

describe('snapshots in storage', () => {
  it('loads the newest readable snapshot, skipping damaged ones', async () => {
    const adapter = new TestAdapter();
    const folder = await adapter.createFolder((await adapter.getRoot()).id, 'snapshots');
    await writeSnapshot(adapter, folder.id, data('dev-a', 10));
    await adapter.createFile(
      { parentId: folder.id, name: snapshotName(encodeHlc({ wall: 99, counter: 0, device: 'dev-b' }), 'dev-b'), mimeType: 'application/gzip' },
      new Blob(['garbage']),
    );
    const newest = await loadNewestSnapshot(adapter, folder.id, 'lib');
    expect(newest.snapshot?.hlc).toBe(encodeHlc({ wall: 10, counter: 0, device: 'dev-a' }));
    expect(newest.errors).toHaveLength(1);
    expect((await loadNewestSnapshot(adapter, folder.id, 'other-lib')).snapshot).toBeNull();
  });

  it('keeps the newest three and deletes only its own older ones', async () => {
    const adapter = new TestAdapter();
    const folder = await adapter.createFolder((await adapter.getRoot()).id, 'snapshots');
    await writeSnapshot(adapter, folder.id, data('dev-b', 1));
    for (let wall = 2; wall <= 6; wall++) await writeSnapshot(adapter, folder.id, data('dev-a', wall));
    const names = (await listSnapshots(adapter, folder.id)).map((f) => parseSnapshotName(f.name));
    expect(names.map((n) => n?.device)).toEqual(['dev-a', 'dev-a', 'dev-a', 'dev-b']);
    expect(names[0]?.hlc).toBe(encodeHlc({ wall: 6, counter: 0, device: 'dev-a' }));
  });
});
