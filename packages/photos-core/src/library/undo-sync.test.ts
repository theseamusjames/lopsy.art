import { describe, expect, it } from 'vitest';
import { MemoryLocalStore } from './local-store';
import { DEFAULT_RECIPE, recipeHash } from './recipe';
import { NotADocumentError, openLibrary } from './session';
import { TestAdapter } from './test-support/test-adapter';
import type { LibrarySession, NewAsset } from './types';

const PHOTO: NewAsset = {
  kind: 'original',
  fileId: 'file-1',
  sha256: 'a'.repeat(64),
  fileName: 'IMG_1.JPG',
  byteSize: 1,
  format: 'jpeg',
  mimeType: 'image/jpeg',
  capturedAt: null,
  importedAt: '2026-11-18T00:00:00.000Z',
  importId: 'imp',
  width: null,
  height: null,
  orientation: 1,
  camera: null,
  lens: null,
  exposure: null,
  gps: null,
  pairedWith: null,
  source: null,
  renderFileId: null,
};

async function twoDevices() {
  const adapter = new TestAdapter();
  let ta = 1_000_000;
  let tb = 1_000_000;
  const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => ta });
  const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => tb });
  const { versionId } = a.addAsset(PHOTO);
  await sync(a, b);
  const tick = (ms: number) => {
    ta += ms;
    tb += ms;
  };
  return { a, b, versionId, tick };
}

async function sync(...sessions: LibrarySession[]) {
  for (const s of sessions) await s.syncNow();
  for (const s of sessions) await s.syncNow();
}

const tone = (s: LibrarySession, versionId: string) => s.getView().versions.get(versionId)!.recipe.tone;

describe('undo across devices', () => {
  it('keeps a newer change from another device when undoing', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    a.editRecipe(versionId, { 'tone.exposure': 1, 'tone.contrast': 20 }, 'Edit');
    await sync(a, b);
    tick(1000);
    b.editRecipe(versionId, { 'tone.exposure': 2 }, 'Exposure');
    await sync(b, a);

    expect(a.undo(versionId)).toBe(true);
    // Contrast was A's alone and goes back; exposure was changed later by B and stays.
    expect(tone(a, versionId)).toMatchObject({ exposure: 2, contrast: 0 });
    await sync(a, b);
    expect(tone(b, versionId)).toMatchObject({ exposure: 2, contrast: 0 });
  });

  it('cannot undo a step whose every field was changed since elsewhere', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    a.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    await sync(a, b);
    tick(1000);
    b.editRecipe(versionId, { 'tone.exposure': 2 }, 'Exposure');
    await sync(b, a);
    expect(a.history(versionId)[0]).toMatchObject({ own: true, active: true, undoable: false, nextUndo: false });
    expect(a.undo(versionId)).toBe(false);
    expect(tone(a, versionId).exposure).toBe(2);
  });

  it('undoes untouched steps as before, several in a row', async () => {
    const { a, b, versionId } = await twoDevices();
    a.editRecipe(versionId, { 'tone.exposure': 1 }, 'One');
    a.editRecipe(versionId, { 'tone.exposure': 2 }, 'Two');
    await sync(a, b);
    expect(a.undo(versionId)).toBe(true);
    expect(a.undo(versionId)).toBe(true);
    expect(tone(a, versionId).exposure).toBe(0);
    expect(a.redo(versionId)).toBe(true);
    expect(a.redo(versionId)).toBe(true);
    expect(tone(a, versionId).exposure).toBe(2);
  });

  it('only acts on this device’s steps', async () => {
    const { a, b, versionId } = await twoDevices();
    a.editRecipe(versionId, { 'tone.exposure': 1 }, 'A');
    await sync(a, b);
    b.editRecipe(versionId, { 'tone.contrast': 5 }, 'B');
    await sync(b, a);
    expect(b.undo(versionId)).toBe(true);
    expect(tone(b, versionId)).toMatchObject({ exposure: 1, contrast: 0 });
    expect(b.undo(versionId)).toBe(false);
    const fromA = a.history(versionId);
    expect(fromA.map((h) => [h.label, h.own])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    await sync(b, a);
    const fromB = b.history(versionId);
    expect(fromB.map((h) => [h.label, h.own, h.active, h.undoable, h.nextRedo])).toEqual([
      ['A', false, true, false, false],
      ['B', true, false, false, true],
    ]);
  });

  it('redo keeps a newer change from another device', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    a.editRecipe(versionId, { 'tone.exposure': 1, 'tone.contrast': 20 }, 'Edit');
    expect(a.undo(versionId)).toBe(true);
    await sync(a, b);
    tick(1000);
    b.editRecipe(versionId, { 'tone.contrast': -30 }, 'Contrast');
    await sync(b, a);
    expect(a.redo(versionId)).toBe(true);
    expect(tone(a, versionId)).toMatchObject({ exposure: 1, contrast: -30 });
  });
});

describe('stale local writes', () => {
  it('writes an explicit command in full, so it beats an older unseen change', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    const assetId = [...a.getView().assets.keys()][0]!;
    b.setMarks([assetId], { rating: 4 });
    tick(1000);
    await sync(b);
    // A has not seen B's rating; the user's later "rating 0" here is the newest intent.
    const before = a.getSyncStatus().pendingOps;
    a.setMarks([assetId], { rating: 0, title: '' });
    a.editRecipe(versionId, { 'tone.exposure': 0 }, 'Nothing');
    expect(a.getSyncStatus().pendingOps).toBe(before + 2);
    // A recipe command that changes nothing here leaves no history step.
    expect(a.history(versionId)).toEqual([]);
    await sync(a, b);
    expect(a.getView().assets.get(assetId)?.rating).toBe(0);
    expect(b.getView().assets.get(assetId)?.rating).toBe(0);
  });

  it('Reset all beats an older offline edit to a field it leaves at the default', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    // B, offline, raises exposure; later A (which never saw it) resets everything.
    b.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    tick(1000);
    a.setRecipe(versionId, DEFAULT_RECIPE, 'Reset all');
    await sync(a, b);
    expect(tone(a, versionId).exposure).toBe(0);
    expect(tone(b, versionId).exposure).toBe(0);
  });

  it('drops a preview rendered from an older edit', async () => {
    const { a, versionId } = await twoDevices();
    const oldHash = recipeHash(a.getView().versions.get(versionId)!.recipe);
    a.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    a.setPreview(versionId, 'thumb', { fileId: 'old', recipeHash: oldHash, width: 512, height: 512 });
    expect(a.getView().versions.get(versionId)?.thumb).toBeNull();
    const hash = recipeHash(a.getView().versions.get(versionId)!.recipe);
    a.setPreview(versionId, 'thumb', { fileId: 'new', recipeHash: hash, width: 512, height: 512 });
    expect(a.getView().versions.get(versionId)?.thumb?.fileId).toBe('new');
  });
});

describe('setAssetFacts', () => {
  it('updates a document after an in-place re-save, and refuses originals', async () => {
    const { a, b } = await twoDevices();
    const original = [...a.getView().assets.keys()][0]!;
    const { assetId } = a.addAsset({ ...PHOTO, kind: 'document', format: 'lopsy', fileId: 'doc-1', renderFileId: 'r-1' });
    a.setAssetFacts(assetId, { sha256: 'b'.repeat(64), byteSize: 99, width: 640, height: 480, renderFileId: 'r-2' });
    await sync(a, b);
    expect(b.getView().assets.get(assetId)).toMatchObject({
      sha256: 'b'.repeat(64),
      byteSize: 99,
      width: 640,
      height: 480,
      renderFileId: 'r-2',
    });
    expect(() => a.setAssetFacts(original, { sha256: 'c'.repeat(64) })).toThrow(NotADocumentError);
  });
});
