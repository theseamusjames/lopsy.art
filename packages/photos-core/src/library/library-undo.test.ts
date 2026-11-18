import { describe, expect, it } from 'vitest';
import { MemoryLocalStore } from './local-store';
import { openLibrary, type PhotosLibrarySession } from './session';
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
    importedAt: '2026-11-18T10:00:00.000Z',
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

async function library(): Promise<PhotosLibrarySession> {
  return openLibrary({ adapter: new TestAdapter(), store: new MemoryLocalStore(), autoSync: false });
}

describe('library undo', () => {
  it('undoes and redoes marks, keywords and albums, a multi-photo command as one step', async () => {
    const s = await library();
    const a = s.addAsset(photo(1));
    const b = s.addAsset(photo(2));
    const album = s.createAlbum('Trip');
    expect(s.libraryHistory()).toEqual({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
    s.setMarks([a.assetId, b.assetId], { rating: 4 });
    s.setMarks([a.assetId], { label: 'red' });
    s.setMarks([a.assetId, b.assetId], { setAside: true });
    s.setMarks([a.assetId], { title: 'Harbour', caption: 'Dusk' });
    s.setKeyword([a.assetId, b.assetId], 'sea', true);
    s.setAlbumMember(album, a.assetId, true);
    s.setAlbumMember(album, a.assetId, true, a.versionId);
    const asset = (id: string) => s.getView().assets.get(id)!;
    expect(s.libraryHistory().undoLabel).toBe('Add to album');

    const labels: (string | null)[] = [];
    for (let i = 0; i < 7; i++) labels.push(s.undoLibrary());
    expect(labels).toEqual(['Add to album', 'Add to album', 'Add keyword', 'Edit info', 'Set aside', 'Label', 'Rating']);
    expect(s.undoLibrary()).toBeNull();
    for (const id of [a.assetId, b.assetId]) {
      expect(asset(id)).toMatchObject({ rating: 0, label: null, setAside: false, title: '', caption: '', keywords: [] });
    }
    expect(s.getView().albums.get(album)?.members).toEqual([]);

    for (let i = 0; i < 7; i++) s.redoLibrary();
    expect(s.redoLibrary()).toBeNull();
    expect(asset(b.assetId)).toMatchObject({ rating: 4, setAside: true, keywords: ['sea'] });
    expect(asset(a.assetId)).toMatchObject({ label: 'red', title: 'Harbour', caption: 'Dusk' });
    expect(s.getView().albums.get(album)?.members).toHaveLength(2);
  });

  it('undoes delete and restore, versions and the shown version', async () => {
    const s = await library();
    const a = s.addAsset(photo(1));
    s.deleteAssets([a.assetId]);
    expect(s.undoLibrary()).toBe('Delete');
    expect(s.getView().assets.get(a.assetId)?.deleted).toBe(false);
    s.deleteAssets([a.assetId]);
    s.restoreAssets([a.assetId]);
    expect(s.undoLibrary()).toBe('Restore');
    expect(s.getView().assets.get(a.assetId)?.deleted).toBe(true);
    s.undoLibrary();

    const v2 = s.createVersion(a.assetId, 'Mono');
    s.renameVersion(v2, 'Black and white');
    // Make it shown, then delete the old one: one step, as the app's Delete version does.
    s.libraryStep('Delete version', () => {
      s.setPrimaryVersion(a.assetId, v2);
      s.deleteVersion(a.versionId);
    });
    expect(s.libraryHistory().undoLabel).toBe('Delete version');
    expect(s.undoLibrary()).toBe('Delete version');
    expect(s.getView().assets.get(a.assetId)?.primaryVersionId).toBe(a.versionId);
    expect(s.getView().versions.get(a.versionId)?.deleted).toBe(false);
    expect(s.undoLibrary()).toBe('Rename version');
    expect(s.getView().versions.get(v2)?.name).toBe('Mono');
    expect(s.undoLibrary()).toBe('New version');
    expect(s.getView().versions.get(v2)?.deleted).toBe(true);
    expect(s.redoLibrary()).toBe('New version');
    expect(s.getView().versions.get(v2)?.deleted).toBe(false);
  });

  it('a new command clears redo; a command that changes nothing adds no step; imports stay out', async () => {
    const s = await library();
    const a = s.addAsset(photo(1));
    s.setMarks([a.assetId], { rating: 2 });
    s.undoLibrary();
    expect(s.libraryHistory().canRedo).toBe(true);
    s.setMarks([a.assetId], { rating: 3 });
    expect(s.libraryHistory()).toMatchObject({ canRedo: false, undoLabel: 'Rating' });
    s.setMarks([a.assetId], { rating: 3 });
    s.withoutLibraryHistory(() => s.setKeyword([a.assetId], 'sidecar', true));
    expect(s.undoLibrary()).toBe('Rating');
    expect(s.undoLibrary()).toBeNull();
    expect(s.getView().assets.get(a.assetId)?.keywords).toEqual(['sidecar']);
  });

  it('never points a photo at a version another device deleted since', async () => {
    const adapter = new TestAdapter();
    let wall = 1_000_000;
    const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => (wall += 10) });
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => (wall += 10) });
    const photo1 = a.withoutLibraryHistory(() => a.addAsset(photo(1)));
    const v2 = a.withoutLibraryHistory(() => a.createVersion(photo1.assetId, 'Mono'));
    a.setMarks([photo1.assetId], { rating: 3 });
    a.setPrimaryVersion(photo1.assetId, v2);
    await a.syncNow();
    await b.syncNow();
    b.deleteVersion(photo1.versionId);
    await b.syncNow();
    await a.syncNow();
    // 'Show version' would bring back the deleted V1: it is skipped, and the step before is undone.
    expect(a.undoLibrary()).toBe('Rating');
    expect(a.getView().assets.get(photo1.assetId)).toMatchObject({ primaryVersionId: v2, rating: 0 });
    expect(a.libraryHistory().canUndo).toBe(false);
  });

  it('leaves what another device changed since, and undoes the rest', async () => {
    const adapter = new TestAdapter();
    let wall = 1_000_000;
    const s = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => (wall += 10) });
    const other = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => (wall += 10) });
    const a = s.addAsset(photo(1));
    const b = s.addAsset(photo(2));
    await s.syncNow();
    await other.syncNow();
    s.setMarks([a.assetId, b.assetId], { rating: 4 });
    s.setMarks([a.assetId], { label: 'blue' });
    await s.syncNow();
    await other.syncNow();
    other.setMarks([a.assetId], { rating: 1 });
    other.setMarks([a.assetId], { label: 'green' });
    await other.syncNow();
    await s.syncNow();
    // The label step is all overwritten: dropped, and Undo goes on to the rating step,
    // which reverts only the photo the other device left alone.
    expect(s.undoLibrary()).toBe('Rating');
    expect(s.getView().assets.get(a.assetId)).toMatchObject({ rating: 1, label: 'green' });
    expect(s.getView().assets.get(b.assetId)?.rating).toBe(0);
    expect(s.redoLibrary()).toBe('Rating');
    expect(s.getView().assets.get(a.assetId)?.rating).toBe(1);
    expect(s.getView().assets.get(b.assetId)?.rating).toBe(4);
    await s.syncNow();
    await other.syncNow();
    expect(other.getView().assets.get(b.assetId)?.rating).toBe(4);
  });
});

describe('editedAt', () => {
  it('is stamped when a recipe changes, by edit, paste, undo and redo, and not by a no-op or a new version', async () => {
    let wall = Date.UTC(2026, 10, 18, 9);
    const s = await openLibrary({ adapter: new TestAdapter(), store: new MemoryLocalStore(), autoSync: false, now: () => wall });
    const a = s.addAsset(photo(1));
    const at = () => s.getView().versions.get(a.versionId)?.editedAt;
    expect(at()).toBeUndefined();
    wall += 1000;
    s.editRecipe(a.versionId, { 'tone.exposure': 1 }, 'Exposure');
    expect(at()).toBe(new Date(wall).toISOString());
    const edited = at();
    wall += 1000;
    s.setRecipe(a.versionId, s.getView().versions.get(a.versionId)!.recipe, 'Paste settings');
    expect(at()).toBe(edited);
    wall += 1000;
    s.applyRecipeValues([a.versionId], { 'color.vibrance': 20 }, 'Paste edits');
    expect(at()).toBe(new Date(wall).toISOString());
    wall += 1000;
    s.undo(a.versionId);
    expect(at()).toBe(new Date(wall).toISOString());
    wall += 1000;
    s.redo(a.versionId);
    expect(at()).toBe(new Date(wall).toISOString());
    const v2 = s.createVersion(a.assetId, 'Copy', s.getView().versions.get(a.versionId)!.recipe);
    expect(s.getView().versions.get(v2)?.editedAt).toBeUndefined();
  });
});
