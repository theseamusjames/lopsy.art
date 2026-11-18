import { describe, expect, it } from 'vitest';
import { listSnapshots } from './snapshot';
import { MemoryLocalStore } from './local-store';
import { gzipText } from './gzip';
import { LibraryReadOnlyError, openLibrary, type OpenLibraryOptions } from './session';
import { NEWER_APP_MESSAGE, type SyncTimers } from './sync';
import { canonicalView } from './test-support/canonical';
import { TestAdapter } from './test-support/test-adapter';
import type { LibrarySession, NewAsset } from './types';

function photo(n: number): NewAsset {
  return {
    kind: 'original',
    fileId: `file-${n}`,
    sha256: `sha-${n}`,
    fileName: `DSCF${1000 + n}.RAF`,
    byteSize: 30_000_000,
    format: 'raf',
    mimeType: 'image/x-fujifilm-raf',
    capturedAt: '2026-11-14T16:02:11',
    importedAt: '2026-11-15T10:00:00.000Z',
    importId: 'imp-1',
    width: 6240,
    height: 4160,
    orientation: 1,
    camera: { make: 'FUJIFILM', model: 'X-T5' },
    lens: 'XF33mmF1.4',
    exposure: { iso: 200, shutter: '1/250', aperture: 2.8, focalLength: 33 },
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
  };
}

class Clock {
  constructor(public t: number) {}
  readonly now = () => this.t;
}

async function open(adapter: TestAdapter, store = new MemoryLocalStore(), extra: Partial<OpenLibraryOptions> = {}) {
  return openLibrary({ adapter, store, autoSync: false, ...extra });
}

async function syncAll(...sessions: LibrarySession[]) {
  for (const s of sessions) await s.syncNow();
  for (const s of sessions) await s.syncNow();
}

describe('openLibrary', () => {
  it('adds an asset with its primary version in one step', async () => {
    const session = await open(new TestAdapter());
    const { assetId, versionId } = session.addAsset({ ...photo(1), marks: { rating: 3 }, keywords: ['cat', ' cat ', ''] });
    const view = session.getView();
    const asset = view.assets.get(assetId);
    expect(asset).toMatchObject({ fileName: 'DSCF1001.RAF', rating: 3, keywords: ['cat'], primaryVersionId: versionId, deleted: false });
    expect(asset?.camera).toEqual({ make: 'FUJIFILM', model: 'X-T5' });
    expect(asset?.exposure).toEqual({ iso: 200, shutter: '1/250', aperture: 2.8, focalLength: 33 });
    const version = view.versions.get(versionId);
    expect(version?.name).toBe('Original');
    expect(version?.assetId).toBe(assetId);
    expect(version?.recipe.tone.exposure).toBe(0);
    expect(session.addAsset({ ...photo(1), id: assetId })).toEqual({ assetId, versionId });
    expect(session.getSyncStatus().pendingOps).toBe(3);
  });

  it('notifies subscribers and keeps view identity when nothing changed', async () => {
    const session = await open(new TestAdapter());
    let calls = 0;
    const unsubscribe = session.subscribe(() => (calls += 1));
    const before = session.getView();
    expect(session.getView()).toBe(before);
    const { assetId } = session.addAsset(photo(1));
    expect(calls).toBe(1);
    const afterAdd = session.getView();
    expect(afterAdd).not.toBe(before);
    session.setSetting('grid.size', 3);
    expect(session.getView().assets).toBe(afterAdd.assets);
    expect(session.getView().assets.get(assetId)).toBe(afterAdd.assets.get(assetId));
    unsubscribe();
    session.setSetting('grid.size', 4);
    expect(calls).toBe(2);
  });

  it('supports marks, keywords, delete/restore, versions, albums and settings', async () => {
    const session = await open(new TestAdapter());
    const { assetId } = session.addAsset(photo(1));
    session.setMarks([assetId], { rating: 5, label: 'red', title: 'Harbour' });
    session.setKeyword([assetId], 'sea', true);
    session.setKeyword([assetId], 'boat', true);
    session.setKeyword([assetId], 'boat', false);
    session.deleteAssets([assetId]);
    expect(session.getView().assets.get(assetId)?.deleted).toBe(true);
    session.restoreAssets([assetId]);
    const v2 = session.createVersion(assetId, 'B&W', undefined);
    session.renameVersion(v2, 'Mono');
    session.setPreview(v2, 'thumb', { fileId: 'p1', recipeHash: 'abc', width: 512, height: 341 });
    const album = session.createAlbum('Trip');
    session.setAlbumMember(album, assetId, true);
    session.renameAlbum(album, 'Trip 2026');
    session.setSetting('export.quality', 90);
    const view = session.getView();
    expect(view.assets.get(assetId)).toMatchObject({ rating: 5, label: 'red', title: 'Harbour', keywords: ['sea'], deleted: false });
    expect(view.versions.get(v2)).toMatchObject({ name: 'Mono', thumb: { fileId: 'p1', recipeHash: 'abc', width: 512, height: 341 } });
    expect(view.albums.get(album)).toEqual({ id: album, name: 'Trip 2026', assetIds: [assetId], deleted: false });
    expect(view.settings.get('export.quality')).toBe(90);
    session.deleteVersion(v2);
    session.deleteAlbum(album);
    expect(session.getView().versions.get(v2)?.deleted).toBe(true);
    expect(session.getView().albums.get(album)?.deleted).toBe(true);
  });

  it('refuses changes other devices would reject', async () => {
    const session = await open(new TestAdapter());
    const { assetId } = session.addAsset(photo(1));
    expect(() => session.setMarks([assetId], { caption: 'x'.repeat(20_000) })).toThrow();
    expect(session.getView().assets.get(assetId)?.caption).toBe('');
  });
});

describe('sync between devices', () => {
  it('converges two devices on one storage, both ways', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter, new MemoryLocalStore(), { deviceName: 'Laptop', appVersion: '1.2.3' });
    const b = await open(adapter);
    expect(b.libraryId).toBe(a.libraryId);
    expect(b.deviceId).not.toBe(a.deviceId);

    const { assetId } = a.addAsset(photo(1));
    await a.syncNow();
    expect(a.getSyncStatus()).toMatchObject({ state: 'idle', pendingOps: 0, error: null });
    await b.syncNow();
    expect(b.getView().assets.get(assetId)?.fileName).toBe('DSCF1001.RAF');

    b.setMarks([assetId], { rating: 4 });
    b.setKeyword([assetId], 'night', true);
    await syncAll(b, a);
    expect(a.getView().assets.get(assetId)?.rating).toBe(4);
    expect(canonicalView(a.getView())).toEqual(canonicalView(b.getView()));

    const devices = await adapter.listChildren(a.layout.devicesId);
    const laptop = devices.find((f) => f.name === `${a.deviceId}.json`);
    expect(JSON.parse(await (await adapter.readContent(laptop!.id)).text())).toMatchObject({
      deviceId: a.deviceId,
      name: 'Laptop',
      appVersion: '1.2.3',
    });
    const journal = await adapter.listChildren(a.layout.journalId);
    expect(journal.map((f) => f.name).sort()).toEqual([a.deviceId, b.deviceId].sort());
    for (const folder of journal) {
      for (const seg of await adapter.listChildren(folder.id)) {
        expect(seg.properties).toMatchObject({ 'lp.lib': a.libraryId, 'lp.role': 'segment' });
        expect(seg.name).toMatch(/^\d{12}-\d{12}\.jsonl\.gz$/);
      }
    }
  });

  it('keeps offline edits to different recipe fields, and the later edit of the same field', async () => {
    const adapter = new TestAdapter();
    const ta = new Clock(1_000_000);
    const tb = new Clock(1_000_000);
    const a = await open(adapter, new MemoryLocalStore(), { now: ta.now });
    const b = await open(adapter, new MemoryLocalStore(), { now: tb.now });
    const { versionId } = a.addAsset(photo(1));
    await syncAll(a, b);

    // Both offline: different sliders.
    ta.t += 1000;
    a.editRecipe(versionId, { 'tone.exposure': 0.7 }, 'Exposure');
    tb.t += 2000;
    b.editRecipe(versionId, { 'tone.contrast': 25 }, 'Contrast');
    // And the same slider; b's edit is later.
    ta.t += 1000;
    a.editRecipe(versionId, { 'color.vibrance': 10 }, 'Vibrance');
    tb.t += 5000;
    b.editRecipe(versionId, { 'color.vibrance': 40 }, 'Vibrance');
    await syncAll(a, b);

    for (const s of [a, b]) {
      const recipe = s.getView().versions.get(versionId)?.recipe;
      expect(recipe?.tone.exposure).toBe(0.7);
      expect(recipe?.tone.contrast).toBe(25);
      expect(recipe?.color.vibrance).toBe(40);
    }
    expect(canonicalView(a.getView())).toEqual(canonicalView(b.getView()));
  });

  it('bootstraps a fresh device from a snapshot plus later segments', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter, new MemoryLocalStore(), { snapshotEvery: 5 });
    const ids = [1, 2, 3].map((n) => a.addAsset(photo(n)));
    a.setMarks([ids[0]!.assetId], { rating: 2 });
    await a.syncNow();
    const snapshots = await listSnapshots(adapter, a.layout.snapshotsId);
    expect(snapshots).toHaveLength(1);

    a.setMarks([ids[1]!.assetId], { rating: 5 });
    a.editRecipe(ids[2]!.versionId, { 'tone.exposure': -1 }, 'Exposure');
    await a.syncNow();

    const reads = adapter.calls.filter((c) => c === 'readContent').length;
    const c = await open(adapter);
    // Opening read the snapshot alone; the segment it already covers is never read.
    expect(adapter.calls.filter((call) => call === 'readContent').length - reads).toBe(2);
    expect(c.getView().assets.get(ids[0]!.assetId)?.rating).toBe(2);
    expect(c.getView().assets.get(ids[1]!.assetId)?.rating).toBe(0);
    const before = adapter.calls.filter((call) => call === 'readContent').length;
    await c.syncNow();
    expect(adapter.calls.filter((call) => call === 'readContent').length - before).toBe(1);
    expect(canonicalView(c.getView())).toEqual(canonicalView(a.getView()));
    expect(c.getView().versions.get(ids[2]!.versionId)?.recipe.tone.exposure).toBe(-1);
  });

  it('keeps unsynced ops through a failed flush and a crash', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const a = await open(adapter, store);
    const { assetId } = a.addAsset(photo(1));
    adapter.failNext('network', { method: 'createFile' });
    await a.syncNow();
    expect(a.getSyncStatus()).toMatchObject({ state: 'offline', pendingOps: 2 });
    expect(a.getSyncStatus().error).toMatch(/network/);
    // A crash: the tab goes away without close(), once local writes have landed.
    await new Promise((r) => setTimeout(r, 0));

    const reopened = await open(adapter, store);
    expect(reopened.deviceId).toBe(a.deviceId);
    expect(reopened.getView().assets.get(assetId)).toBeDefined();
    expect(reopened.getSyncStatus().pendingOps).toBe(2);
    reopened.setMarks([assetId], { rating: 1 });
    await reopened.syncNow();
    expect(reopened.getSyncStatus()).toMatchObject({ state: 'idle', pendingOps: 0 });

    const b = await open(adapter);
    await b.syncNow();
    expect(b.getView().assets.get(assetId)?.rating).toBe(1);
    const seqs = (await adapter.listChildren((await adapter.listChildren(a.layout.journalId))[0]!.id)).map((f) => f.name);
    expect(seqs).toEqual(['000000000001-000000000003.jsonl.gz']);
  });

  it('restores synced state on reload without reading the journal again', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const a = await open(adapter);
    const b = await open(adapter, store);
    const { assetId } = a.addAsset(photo(1));
    await a.syncNow();
    await b.syncNow();
    b.setMarks([assetId], { rating: 3 });
    await b.close();
    const reads = adapter.calls.filter((c) => c === 'readContent').length;
    const again = await open(adapter, store);
    await again.syncNow();
    expect(adapter.calls.filter((c) => c === 'readContent').length).toBe(reads + 1);
    expect(again.getView().assets.get(assetId)?.rating).toBe(3);
    expect(again.getSyncStatus().pendingOps).toBe(0);
  });

  it('pauses on auth errors and reports other errors', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    a.addAsset(photo(1));
    let changes = 0;
    a.subscribeSync(() => (changes += 1));
    adapter.failNext('auth');
    await a.syncNow();
    expect(a.getSyncStatus().state).toBe('paused');
    expect(a.getSyncStatus().pendingOps).toBe(2);
    adapter.failNext('quota-exceeded', { method: 'createFile' });
    await a.syncNow();
    expect(a.getSyncStatus().state).toBe('error');
    await a.syncNow();
    expect(a.getSyncStatus()).toMatchObject({ state: 'idle', pendingOps: 0, error: null });
    expect(a.getSyncStatus().lastSyncedAt).not.toBeNull();
    expect(changes).toBeGreaterThan(0);
  });

  it('writes a readable settings.json when settings change', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    const b = await open(adapter);
    a.setSetting('export.quality', 90);
    await a.syncNow();
    b.setSetting('grid.size', 'large');
    await syncAll(b, a);
    const files = (await adapter.listChildren(a.layout.dataId)).filter((f) => f.name === 'settings.json');
    expect(files).toHaveLength(1);
    expect(files[0]!.properties).toEqual({ 'lp.lib': a.libraryId, 'lp.role': 'settings' });
    expect(JSON.parse(await (await adapter.readContent(files[0]!.id)).text())).toEqual({
      'export.quality': 90,
      'grid.size': 'large',
    });
  });

  it('skips damaged segments from other devices and keeps going', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    const b = await open(adapter);
    const { assetId } = a.addAsset(photo(1));
    await a.syncNow();
    const folder = (await adapter.listChildren(a.layout.journalId))[0]!;
    await adapter.createFile({ parentId: folder.id, name: '000000000004-000000000009.jsonl.gz', mimeType: 'application/gzip' }, new Blob(['junk']));
    await b.syncNow();
    expect(b.getView().assets.get(assetId)).toBeDefined();
    expect(b.getSyncStatus().state).toBe('idle');
  });
});

describe('change feed', () => {
  it('lists only the folders the feed mentions after the first pull', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    const b = await open(adapter);
    const c = await open(adapter);
    a.addAsset(photo(1));
    c.setSetting('x', 1);
    await a.syncNow();
    await c.syncNow();
    await b.syncNow();
    a.addAsset(photo(2));
    await a.syncNow();
    const before = adapter.calls.length;
    await b.syncNow();
    const calls = adapter.calls.slice(before);
    expect(calls.filter((x) => x === 'listChanges').length).toBeGreaterThan(0);
    // a's folder only: not the journal folder, not c's folder.
    expect(calls.filter((x) => x === 'listChildren')).toHaveLength(1);
    expect(canonicalView(b.getView())).toEqual(canonicalView(a.getView()));
    expect(b.getView().settings.get('x')).toBe(1);
  });

  it('falls back to listing folders when the feed refuses its cursor', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    const b = await open(adapter);
    await b.syncNow();
    const { assetId } = a.addAsset(photo(1));
    await a.syncNow();
    adapter.failNext('invalid', { method: 'listChanges' });
    await b.syncNow();
    expect(b.getSyncStatus().state).toBe('idle');
    expect(b.getView().assets.get(assetId)).toBeDefined();
  });

  it('lists every folder every fullPullEvery pulls', async () => {
    const adapter = new TestAdapter();
    const b = await open(adapter, new MemoryLocalStore(), { fullPullEvery: 2 });
    await b.syncNow();
    const listings = async () => {
      const before = adapter.calls.length;
      await b.syncNow();
      return adapter.calls.slice(before).filter((x) => x === 'getChangeCursor').length;
    };
    expect([await listings(), await listings(), await listings()]).toEqual([0, 0, 1]);
  });
});

describe('versions of the schema', () => {
  it('keeps ops from a newer app for later instead of dropping them', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    const storeB = new MemoryLocalStore();
    const b = await open(adapter, storeB);
    const { assetId } = a.addAsset(photo(1));
    await a.syncNow();
    const folder = (await adapter.listChildren(a.layout.journalId)).find((f) => f.name === a.deviceId)!;
    const newer = { id: `${a.deviceId}:3`, device: a.deviceId, seq: 3, hlc: `999999999999999-00000-${a.deviceId}`, v: 2, op: { t: 'future' } };
    const valid = { id: `${a.deviceId}:4`, device: a.deviceId, seq: 4, hlc: `999999999999999-00001-${a.deviceId}`, v: 1, op: { t: 'set', kind: 'asset', id: assetId, fields: { rating: 2 } } };
    await adapter.createFile(
      { parentId: folder.id, name: '000000000003-000000000004.jsonl.gz', mimeType: 'application/gzip' },
      await gzipText(JSON.stringify(newer) + '\n' + JSON.stringify(valid) + '\n'),
    );
    await b.syncNow();
    expect(b.getView().assets.get(assetId)?.rating).toBe(2);
    expect(b.getSyncStatus()).toMatchObject({ state: 'error', error: NEWER_APP_MESSAGE });
    await b.close();
    const reads = adapter.calls.filter((c) => c === 'readContent').length;
    const reopened = await open(adapter, storeB);
    await reopened.syncNow();
    // Not marked as read, so the next session (an updated app) reads it again.
    expect(adapter.calls.filter((c) => c === 'readContent').length).toBe(reads + 2);
  });

  it('opens a library with a newer schema read-only', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    a.addAsset(photo(1));
    await a.syncNow();
    const manifest = (await adapter.listChildren(a.layout.dataId)).find((f) => f.name === 'library.json')!;
    const json = JSON.parse(await (await adapter.readContent(manifest.id)).text());
    await adapter.updateContent(manifest.id, new Blob([JSON.stringify({ ...json, schemaVersion: 2 })]));
    const b = await open(adapter);
    await b.syncNow();
    expect(b.getView().assets.size).toBe(1);
    expect(b.getSyncStatus().state).toBe('error');
    expect(() => b.setSetting('x', 1)).toThrow(LibraryReadOnlyError);
  });
});

describe('device persistence', () => {
  it('keeps flushed ops in the saved outbox until a saved state holds them', async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const a = await open(adapter, store);
    a.addAsset(photo(1));
    await a.syncNow();
    const saved = await store.load(a.libraryId);
    expect(saved?.outbox).toEqual([]);
    expect(saved?.sync?.flushedSeq).toBe(2);
    expect(saved?.state?.entities.length).toBe(2);
    expect(saved?.nextSeq).toBe(3);
  });
});

describe('undo and redo', () => {
  it('undoes and redoes recipe steps', async () => {
    const t = new Clock(1_000);
    const s = await open(new TestAdapter(), new MemoryLocalStore(), { now: t.now });
    const { versionId } = s.addAsset(photo(1));
    const exposure = () => s.getView().versions.get(versionId)?.recipe.tone.exposure;
    expect(s.undo(versionId)).toBe(false);
    s.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    s.editRecipe(versionId, { 'tone.exposure': 2, 'tone.contrast': 10 }, 'Exposure and contrast');
    expect(s.history(versionId).map((h) => [h.label, h.active])).toEqual([
      ['Exposure', true],
      ['Exposure and contrast', true],
    ]);
    expect(s.undo(versionId)).toBe(true);
    expect(exposure()).toBe(1);
    expect(s.getView().versions.get(versionId)?.recipe.tone.contrast).toBe(0);
    expect(s.undo(versionId)).toBe(true);
    expect(exposure()).toBe(0);
    expect(s.undo(versionId)).toBe(false);
    expect(s.history(versionId).map((h) => h.active)).toEqual([false, false]);
    expect(s.redo(versionId)).toBe(true);
    expect(exposure()).toBe(1);
    expect(s.redo(versionId)).toBe(true);
    expect(exposure()).toBe(2);
    expect(s.redo(versionId)).toBe(false);

    s.undo(versionId);
    s.editRecipe(versionId, { 'color.saturation': -50 }, 'Saturation');
    // A new edit after an undo ends the redo chain.
    expect(s.redo(versionId)).toBe(false);
    expect(s.history(versionId).map((h) => [h.label, h.active])).toEqual([
      ['Exposure', true],
      ['Exposure and contrast', false],
      ['Saturation', true],
    ]);
  });

  it('undoes a whole-recipe replacement and syncs undo to other devices', async () => {
    const adapter = new TestAdapter();
    const a = await open(adapter);
    const b = await open(adapter);
    const { versionId } = a.addAsset(photo(1));
    a.editRecipe(versionId, { 'tone.exposure': 1.5 }, 'Exposure');
    const recipe = a.getView().versions.get(versionId)!.recipe;
    a.setRecipe(versionId, { ...recipe, tone: { ...recipe.tone, exposure: -2, shadows: 30 }, framing: { ...recipe.framing, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } } }, 'Paste');
    expect(a.getView().versions.get(versionId)?.recipe.framing.crop).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    await syncAll(a, b);
    expect(b.undo(versionId)).toBe(true);
    await syncAll(b, a);
    for (const s of [a, b]) {
      const r = s.getView().versions.get(versionId)?.recipe;
      expect(r?.tone.exposure).toBe(1.5);
      expect(r?.tone.shadows).toBe(0);
      expect(r?.framing.crop).toBeNull();
      expect(s.history(versionId).map((h) => h.active)).toEqual([true, false]);
    }
  });
});

describe('timers', () => {
  class FakeTimers implements SyncTimers {
    now = 0;
    private next = 1;
    private readonly pending = new Map<number, { at: number; fn: () => void }>();
    setTimeout(fn: () => void, ms: number): unknown {
      const id = this.next++;
      this.pending.set(id, { at: this.now + ms, fn });
      return id;
    }
    clearTimeout(handle: unknown): void {
      this.pending.delete(handle as number);
    }
    advance(ms: number): void {
      const until = this.now + ms;
      for (;;) {
        const due = [...this.pending].filter(([, t]) => t.at <= until).sort((x, y) => x[1].at - y[1].at)[0];
        if (!due) break;
        this.pending.delete(due[0]);
        this.now = due[1].at;
        due[1].fn();
      }
      this.now = until;
    }
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1));
  }

  it('flushes 2 s after the last change and at most 30 s after the first', async () => {
    const adapter = new TestAdapter();
    const timers = new FakeTimers();
    const s = await openLibrary({ adapter, store: new MemoryLocalStore(), timers, now: () => timers.now, autoSync: true });
    // The first pull runs at once on open.
    timers.advance(0);
    await settle();
    const created = () => adapter.calls.filter((c) => c === 'createFile').length;
    const base = created();
    s.addAsset(photo(1));
    timers.advance(1_500);
    await settle();
    expect(created()).toBe(base);
    timers.advance(600);
    await settle();
    expect(s.getSyncStatus().pendingOps).toBe(0);

    // Steady edits every second still flush by the 30 s cap.
    const { assetId } = s.addAsset(photo(2));
    const afterSecond = created();
    for (let i = 0; i < 29; i++) {
      timers.advance(1_000);
      s.setMarks([assetId], { rating: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 });
    }
    expect(s.getSyncStatus().pendingOps).toBeGreaterThan(0);
    timers.advance(1_000);
    await settle();
    expect(created()).toBeGreaterThan(afterSecond);
    await s.close();
  });
});
