import { describe, expect, it } from 'vitest';
import { MemoryLocalStore } from './local-store';
import { DEFAULT_RECIPE, recipeHash } from './recipe';
import { openLibrary } from './session';
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
  it('does not write values that are already there', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    const assetId = [...a.getView().assets.keys()][0]!;
    b.setMarks([assetId], { rating: 4 });
    tick(1000);
    await sync(b);
    // A has not seen B's rating; re-applying a mark A already shows must not override it.
    const before = a.getSyncStatus().pendingOps;
    a.setMarks([assetId], { rating: 0, title: '' });
    a.setKeyword([assetId], 'x', false);
    a.editRecipe(versionId, { 'tone.exposure': 0 }, 'Nothing');
    a.setRecipe(versionId, DEFAULT_RECIPE, 'Reset all');
    expect(a.getSyncStatus().pendingOps).toBe(before);
    expect(a.history(versionId)).toEqual([]);
    await sync(a, b);
    expect(a.getView().assets.get(assetId)?.rating).toBe(4);
  });

  it('Reset all writes only the fields that differ', async () => {
    const { a, b, versionId, tick } = await twoDevices();
    a.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    await sync(a, b);
    tick(1000);
    b.editRecipe(versionId, { 'tone.contrast': 40 }, 'Contrast');
    tick(1000);
    // A has not seen B's contrast yet: its reset only touches exposure, so B's edit survives.
    a.setRecipe(versionId, DEFAULT_RECIPE, 'Reset all');
    await sync(a, b);
    expect(tone(a, versionId)).toMatchObject({ exposure: 0, contrast: 40 });
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
