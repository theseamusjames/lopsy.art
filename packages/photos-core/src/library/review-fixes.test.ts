/** Regression tests from the second data-integrity review. */
import { describe, expect, it } from 'vitest';
import { ensureLibrary } from './layout';
import { MemoryLocalStore, type LocalStorePatch } from './local-store';
import { repairLibrary } from './repair';
import { openLibrary } from './session';
import { listSnapshots } from './snapshot';
import { TestAdapter } from './test-support/test-adapter';
import type { NewAsset } from './types';

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

/** Every write carrying state fails, as on a nearly full disk. */
class NearlyFullStore extends MemoryLocalStore {
  override async write(id: string, patch: LocalStorePatch): Promise<void> {
    if (patch.state) throw new DOMException('full', 'QuotaExceededError');
    return super.write(id, patch);
  }
}

/** Every write fails. */
class BrokenStore extends MemoryLocalStore {
  broken = false;
  override async write(id: string, patch: LocalStorePatch): Promise<void> {
    if (this.broken) throw new DOMException('broken', 'UnknownError');
    return super.write(id, patch);
  }
}

async function copyInto(target: MemoryLocalStore, source: MemoryLocalStore, libraryId: string): Promise<void> {
  const s = (await source.load(libraryId))!;
  await MemoryLocalStore.prototype.write.call(target, libraryId, {
    deviceId: s.deviceId,
    nextSeq: s.nextSeq,
    appendOutbox: s.outbox,
    ...(s.state ? { state: s.state } : {}),
    ...(s.sync ? { sync: s.sync } : {}),
    ...(s.layout ? { layout: s.layout } : {}),
  });
}

describe('second integrity review', () => {
  it('A: a state write that keeps failing does not stop later ops from being uploaded', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const a = await openLibrary({ adapter, store, autoSync: false });
    const x = a.addAsset(photo(1));
    await a.syncNow();
    await a.close();
    const full = new NearlyFullStore();
    await copyInto(full, store, a.libraryId);
    const a2 = await openLibrary({ adapter, store: full, autoSync: false });
    a2.setMarks([x.assetId], { rating: 3 });
    await a2.syncNow();
    a2.setMarks([x.assetId], { rating: 5 });
    await a2.syncNow();
    a2.setMarks([x.assetId], { label: 'red' });
    await a2.syncNow();
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await b.syncNow();
    expect(b.getView().assets.get(x.assetId)?.rating).toBe(5);
    expect(b.getView().assets.get(x.assetId)?.label).toBe('red');
    // And the ops survive a reload from that device's store.
    const a3 = await openLibrary({ adapter, store: full, autoSync: false });
    expect(a3.getView().assets.get(x.assetId)?.label).toBe('red');
  });

  it('B: a command that changes nothing does not make the previous step un-undoable', async () => {
    const a = await openLibrary({ adapter: new TestAdapter(), store: new MemoryLocalStore(), autoSync: false });
    const { versionId } = a.addAsset(photo(1));
    a.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    a.setRecipe(versionId, a.getView().versions.get(versionId)!.recipe, 'Paste settings');
    a.applyRecipeValues([versionId], { 'tone.exposure': 1 }, 'Paste edits');
    expect(a.undo(versionId)).toBe(true);
    expect(a.getView().versions.get(versionId)?.recipe.tone.exposure).toBe(0);
    expect(a.redo(versionId)).toBe(true);
    expect(a.getView().versions.get(versionId)?.recipe.tone.exposure).toBe(1);
  });

  it('C: whenDurable resolves once commands are saved and rejects when saving fails', async () => {
    const store = new BrokenStore();
    const a = await openLibrary({ adapter: new TestAdapter(), store, autoSync: false });
    const x = a.addAsset(photo(1));
    await a.whenDurable();
    expect((await store.load(a.libraryId))?.outbox.length).toBeGreaterThan(0);
    store.broken = true;
    a.deleteAssets([x.assetId]);
    await expect(a.whenDurable()).rejects.toThrow(/save/);
    store.broken = false;
    await a.whenDurable();
    const saved = await store.load(a.libraryId);
    expect(saved?.outbox.some((op) => op.op.t === 'set' && op.op.fields.deleted === true)).toBe(true);
  });

  it('C: repair lists originals of deleted photos left outside the trash', async () => {
    const adapter = new TestAdapter();
    const s = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    const file = await adapter.createFile(
      { parentId: s.layout.originalsId, name: 'A.JPG', mimeType: 'image/jpeg', properties: { 'lp.lib': s.libraryId, 'lp.role': 'original' } },
      new Blob(['a']),
    );
    const { assetId } = s.addAsset({ ...photo(1), fileId: file.id });
    s.deleteAssets([assetId]);
    const report = await repairLibrary(s);
    expect(report.leftovers).toEqual([file.id]);
    expect(report.orphans).toEqual([]);
  });

  it('D: no snapshot holds ops whose outbox write has not committed', async () => {
    const adapter = new TestAdapter();
    const store = new BrokenStore();
    const a = await openLibrary({ adapter, store, autoSync: false, snapshotEvery: 1 });
    store.broken = true;
    a.setSetting('x', 1);
    await a.syncNow();
    expect(await listSnapshots(adapter, a.layout.snapshotsId)).toEqual([]);
    expect(adapter.allFiles().filter((f) => f.name.endsWith('.jsonl.gz'))).toEqual([]);
    store.broken = false;
    await a.syncNow();
    expect((await listSnapshots(adapter, a.layout.snapshotsId)).length).toBe(1);
  });

  it('E: a root missing from a property search is still preferred by its stored ID', async () => {
    const adapter = new TestAdapter();
    const first = await ensureLibrary(adapter);
    const original = adapter.findByProperty.bind(adapter);
    adapter.findByProperty = async () => [];
    const again = await ensureLibrary(adapter, { preferLibraryId: first.layout.libraryId, preferRootId: first.layout.rootId });
    adapter.findByProperty = original;
    expect(again.created).toBe(false);
    expect(again.layout.rootId).toBe(first.layout.rootId);
  });
});
