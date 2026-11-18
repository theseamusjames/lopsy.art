import { describe, expect, it } from 'vitest';
import { DecodeError, gunzipText, gzipText } from './gzip';
import { MemoryLocalStore } from './local-store';
import { openLibrary } from './session';
import { listSnapshots } from './snapshot';
import { TestAdapter } from './test-support/test-adapter';

describe('decompression caps', () => {
  it('stops a gzip bomb at the cap without inflating it all', async () => {
    const bomb = await gzipText('\0'.repeat(8 * 1024 * 1024));
    expect(bomb.size).toBeLessThan(64 * 1024);
    await expect(gunzipText(bomb, 1024 * 1024)).rejects.toThrow(DecodeError);
    expect(await gunzipText(await gzipText('héllo'), 100)).toBe('héllo');
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const text = 'é€😀'.repeat(100_000);
    expect(await gunzipText(await gzipText(text), 10 * 1024 * 1024)).toBe(text);
  });
});

describe('snapshot crash marker', () => {
  it('skips a snapshot that crashed this device last time and loads from older data', async () => {
    const adapter = new TestAdapter();
    const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, snapshotEvery: 2 });
    a.setSetting('one', 1);
    a.setSetting('two', 2);
    await a.syncNow();
    a.setSetting('three', 3);
    a.setSetting('four', 4);
    await a.syncNow();
    const snapshots = await listSnapshots(adapter, a.layout.snapshotsId);
    expect(snapshots.length).toBe(2);
    const newest = snapshots[0]!.name;

    // A previous open set the marker for the newest snapshot and never cleared it: it crashed decoding it.
    const store = new MemoryLocalStore();
    await store.setMarker(`loading-snapshot:${a.libraryId}`, newest);
    const reads: string[] = [];
    const original = adapter.readContent.bind(adapter);
    adapter.readContent = async (id: string) => {
      reads.push((await adapter.getFile(id))?.name ?? id);
      return original(id);
    };
    const c = await openLibrary({ adapter, store, autoSync: false });
    expect(reads).not.toContain(newest);
    expect(reads).toContain(snapshots[1]!.name);
    await c.syncNow();
    expect(Object.fromEntries(c.getView().settings)).toEqual({ one: 1, two: 2, three: 3, four: 4 });
    expect(await store.getMarker(`loading-snapshot:${a.libraryId}`)).toBeNull();
    expect(JSON.parse((await store.getMarker(`bad-snapshots:${a.libraryId}`))!)).toEqual([newest]);
  });

  it('clears the marker after a successful load', async () => {
    const adapter = new TestAdapter();
    const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, snapshotEvery: 1 });
    a.setSetting('x', 1);
    await a.syncNow();
    const store = new MemoryLocalStore();
    const c = await openLibrary({ adapter, store, autoSync: false });
    expect(c.getView().settings.get('x')).toBe(1);
    expect(await store.getMarker(`loading-snapshot:${a.libraryId}`)).toBeNull();
    expect(await store.getMarker(`bad-snapshots:${a.libraryId}`)).toBeNull();
  });
});
