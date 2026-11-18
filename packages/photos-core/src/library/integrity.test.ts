/**
 * Regression tests from the data-integrity review: crashes and failed
 * device writes must never reuse a seq, lose ops or let a snapshot claim
 * ops its state does not hold.
 */
import { describe, expect, it } from 'vitest';
import { MemoryLocalStore, type LocalStore, type LocalStorePatch, type StoredLibrary } from './local-store';
import { openLibrary } from './session';
import { TestAdapter } from './test-support/test-adapter';
import type { LibraryLayout, NewAsset } from './types';

function photo(n: number): NewAsset {
  return {
    kind: 'original',
    fileId: `file-${n}`,
    sha256: `sha-${n}`,
    fileName: `F${n}.JPG`,
    byteSize: 1,
    format: 'jpeg',
    mimeType: 'image/jpeg',
    capturedAt: null,
    importedAt: '2026-11-15T10:00:00.000Z',
    importId: 'i',
    width: 1,
    height: 1,
    orientation: 1,
    camera: null,
    lens: null,
    exposure: null,
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
  };
}

/** A local store whose writes can be held (a busy IndexedDB) and then lost (the tab dies). */
class SlowStore implements LocalStore {
  readonly inner = new MemoryLocalStore();
  hold = false;
  crashed = false;
  readonly held: (() => void)[] = [];
  load(id: string): Promise<StoredLibrary | null> {
    return this.inner.load(id);
  }
  lastLayout(): Promise<LibraryLayout | null> {
    return this.inner.lastLayout();
  }
  getMarker(key: string): Promise<string | null> {
    return this.inner.getMarker(key);
  }
  setMarker(key: string, value: string | null): Promise<void> {
    return this.inner.setMarker(key, value);
  }
  async write(id: string, patch: LocalStorePatch): Promise<void> {
    if (this.hold) await new Promise<void>((r) => this.held.push(r));
    // A dead tab's write never completes, and nothing after it runs.
    if (this.crashed) return new Promise<void>(() => undefined);
    return this.inner.write(id, patch);
  }
}

/** Fails the next write that carries state, as a full disk would. */
class FlakyStore extends MemoryLocalStore {
  failState = false;
  override async write(id: string, patch: LocalStorePatch): Promise<void> {
    if (this.failState && patch.state) {
      this.failState = false;
      throw new DOMException('full', 'QuotaExceededError');
    }
    return super.write(id, patch);
  }
}

async function copyOf(store: LocalStore, libraryId: string): Promise<MemoryLocalStore> {
  const saved = (await store.load(libraryId))!;
  const copy = new MemoryLocalStore();
  await copy.write(libraryId, {
    deviceId: saved.deviceId,
    nextSeq: saved.nextSeq,
    appendOutbox: saved.outbox,
    ...(saved.state ? { state: saved.state } : {}),
    ...(saved.sync ? { sync: saved.sync } : {}),
    ...(saved.layout ? { layout: saved.layout } : {}),
  });
  return copy;
}

describe('data integrity', () => {
  it('R1: never uploads an op before its outbox write commits, so a crash cannot reuse its seq', async () => {
    const adapter = new TestAdapter();
    const slow = new SlowStore();
    const a1 = await openLibrary({ adapter, store: slow, autoSync: false });
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    const x = a1.addAsset(photo(1));
    await a1.syncNow();
    slow.hold = true;
    a1.setMarks([x.assetId], { rating: 5 });
    void a1.syncNow();
    await new Promise((r) => setTimeout(r, 20));
    // The tab dies with the outbox write still in flight.
    slow.crashed = true;
    for (const release of slow.held) release();
    await new Promise((r) => setTimeout(r, 20));

    const a2 = await openLibrary({ adapter, store: await copyOf(slow, a1.libraryId), autoSync: false });
    a2.setMarks([x.assetId], { label: 'red' });
    await a2.syncNow();
    await b.syncNow();
    const segments = adapter.allFiles().filter((f) => f.name.endsWith('.jsonl.gz')).map((f) => f.name);
    expect(new Set(segments).size).toBe(segments.length);
    expect(b.getView().assets.get(x.assetId)?.label).toBe('red');
    expect(b.getView().assets.get(x.assetId)?.rating).toBe(a2.getView().assets.get(x.assetId)?.rating);
  });

  it('R2: rebuilding unreadable saved state re-reads this device’s own journal', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const a1 = await openLibrary({ adapter, store, autoSync: false, snapshotEvery: 1_000_000 });
    const x = a1.addAsset(photo(1));
    a1.setMarks([x.assetId], { rating: 4 });
    await a1.syncNow();
    await a1.close();
    await store.write(a1.libraryId, { state: { format: 99 } as never });

    const a2 = await openLibrary({ adapter, store, autoSync: false, snapshotEvery: 1 });
    a2.setSetting('k', 1);
    await a2.syncNow();
    expect(a2.getView().assets.get(x.assetId)?.rating).toBe(4);
    const c = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await c.syncNow();
    expect(c.getView().assets.get(x.assetId)?.rating).toBe(4);
  });

  it('R3: a failed state write is retried and never leaves the saved vector ahead of the saved state', async () => {
    const adapter = new TestAdapter();
    const store = new FlakyStore();
    const a = await openLibrary({ adapter, store, autoSync: false, snapshotEvery: 1_000_000 });
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await a.syncNow();
    const x = b.addAsset(photo(1));
    await b.syncNow();
    store.failState = true;
    await a.syncNow();
    expect(a.getView().assets.has(x.assetId)).toBe(true);
    await a.syncNow();
    await a.close();

    const a2 = await openLibrary({ adapter, store, autoSync: false, snapshotEvery: 1 });
    await a2.syncNow();
    expect(a2.getView().assets.has(x.assetId)).toBe(true);
    a2.setSetting('k', 1);
    await a2.syncNow();
    const c = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await c.syncNow();
    expect(c.getView().assets.has(x.assetId)).toBe(true);
  });

  it('R3b: a state write lost in a crash after it failed is still covered on reload', async () => {
    const adapter = new TestAdapter();
    const store = new FlakyStore();
    const a = await openLibrary({ adapter, store, autoSync: false });
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await a.syncNow();
    const x = b.addAsset(photo(1));
    await b.syncNow();
    store.failState = true;
    await a.syncNow();
    // Crash now: no retry happens.
    const a2 = await openLibrary({ adapter, store: await copyOf(store, a.libraryId), autoSync: false });
    await a2.syncNow();
    expect(a2.getView().assets.has(x.assetId)).toBe(true);
  });

  it('a taken-over tab stops uploading and writing to the device mid-flush', async () => {
    const adapter = new TestAdapter();
    const slow = new SlowStore();
    const { FakeLibraryLock } = await import('./test-support/fake-lock');
    const lock = new FakeLibraryLock();
    const a1 = await openLibrary({ adapter, store: slow, lock, autoSync: false });
    a1.setSetting('a', 1);
    slow.hold = true;
    const pending = a1.syncNow();
    await new Promise((r) => setTimeout(r, 10));
    slow.hold = false;
    const a2 = await openLibrary({ adapter, store: slow, lock, autoSync: false, takeOver: true });
    const writes = adapter.calls.filter((c) => c === 'createFile').length;
    for (const release of slow.held) release();
    await pending;
    expect(adapter.calls.filter((c) => c === 'createFile').length).toBe(writes);
    a2.setSetting('b', 2);
    await a2.syncNow();
    const segments = adapter.allFiles().filter((f) => f.name.endsWith('.jsonl.gz')).map((f) => f.name);
    expect(new Set(segments).size).toBe(segments.length);
  });
});
