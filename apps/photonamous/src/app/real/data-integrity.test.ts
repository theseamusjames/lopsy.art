import { describe, expect, it } from 'vitest';
import type { LibrarySession, PreviewRef } from '@lopsy/photos-core/library/types';
import { MemoryAdapter } from '@lopsy/photos-core/storage/memory-adapter';
import { MemoryLocalStore, type LocalStore, type LocalStorePatch } from '@lopsy/photos-core/library/local-store';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { NoopLibraryLock } from '@lopsy/photos-core/library/lock';
import { recipeHash, DEFAULT_RECIPE, PIPELINE_VERSION } from '@lopsy/photos-core/library/recipe';
import { guardSession } from '../guard-session';
import { trashAssets, trashLeftoverOriginals, TrashRefusedError, untrashAssets } from './trash-assets';
import { storeEditPreviews } from './edit-previews';

async function libraryWithPhoto() {
  const adapter = new MemoryAdapter();
  const session = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, lock: new NoopLibraryLock() });
  const original = await adapter.createFile(
    { parentId: session.layout.originalsId, name: 'a.jpg', mimeType: 'image/jpeg' },
    new Blob([new Uint8Array([1, 2, 3])]),
  );
  const preview = await adapter.createFile(
    { parentId: session.layout.previewsId, name: 'a.thumb.jpg', mimeType: 'image/jpeg' },
    new Blob([new Uint8Array([4])]),
  );
  const { assetId, versionId } = session.addAsset({
    kind: 'original',
    fileId: original.id,
    sha256: 'x',
    fileName: 'a.jpg',
    byteSize: 3,
    format: 'jpeg',
    mimeType: 'image/jpeg',
    capturedAt: null,
    importedAt: '2026-01-01T00:00:00Z',
    importId: 'i',
    width: 3,
    height: 2,
    orientation: 1,
    camera: null,
    lens: null,
    exposure: null,
    gps: null,
    pairedWith: null,
    source: null,
    renderFileId: null,
  });
  const ref: PreviewRef = { fileId: preview.id, recipeHash: recipeHash(DEFAULT_RECIPE), pipeline: 1, width: 3, height: 2 };
  session.setPreview(versionId, 'thumb', ref);
  session.setPreview(versionId, 'screen', ref);
  return { adapter, session, assetId, versionId, originalId: original.id, previewId: preview.id };
}

/** The session as a read-only library (or one another tab took over) shows it. */
function withFlag(session: LibrarySession, flag: 'readOnly' | 'lostToAnotherTab'): LibrarySession {
  return new Proxy(session, {
    get(target, property) {
      if (property === flag) return true;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe('trashAssets', () => {
  it('records the deletion, then trashes the original and previews', async () => {
    const { adapter, session, assetId, originalId, previewId } = await libraryWithPhoto();
    await trashAssets(guardSession(session, () => {}), [assetId]);
    expect(session.getView().assets.get(assetId)?.deleted).toBe(true);
    expect((await adapter.getFile(originalId))?.trashed).toBe(true);
    expect((await adapter.getFile(previewId))?.trashed).toBe(true);
  });

  for (const flag of ['readOnly', 'lostToAnotherTab'] as const) {
    it(`touches nothing when the library is ${flag}`, async () => {
      const { adapter, session, assetId, originalId } = await libraryWithPhoto();
      const toasts: string[] = [];
      const guarded = guardSession(withFlag(session, flag), (m) => toasts.push(m));
      await expect(trashAssets(guarded, [assetId])).rejects.toBeInstanceOf(TrashRefusedError);
      expect((await adapter.getFile(originalId))?.trashed).toBe(false);
      expect(session.getView().assets.get(assetId)?.deleted).toBe(false);
    });
  }

  it('trashes nothing until the deletion is saved on this device', async () => {
    const inner = new MemoryLocalStore();
    let hold = false;
    const held: (() => void)[] = [];
    const store: LocalStore = {
      load: (id) => inner.load(id),
      lastLayout: () => inner.lastLayout(),
      getMarker: (key) => inner.getMarker(key),
      setMarker: (key, value) => inner.setMarker(key, value),
      write: async (id, patch: LocalStorePatch) => {
        if (hold) await new Promise<void>((r) => held.push(r));
        return inner.write(id, patch);
      },
    };
    const adapter = new MemoryAdapter();
    const session = await openLibrary({ adapter, store, autoSync: false, lock: new NoopLibraryLock() });
    const original = await adapter.createFile(
      { parentId: session.layout.originalsId, name: 'b.jpg', mimeType: 'image/jpeg' },
      new Blob([new Uint8Array([1])]),
    );
    const { assetId } = session.addAsset({
      kind: 'original', fileId: original.id, sha256: 'y', fileName: 'b.jpg', byteSize: 1, format: 'jpeg',
      mimeType: 'image/jpeg', capturedAt: null, importedAt: '2026-01-01T00:00:00Z', importId: 'i', width: 1,
      height: 1, orientation: 1, camera: null, lens: null, exposure: null, gps: null, pairedWith: null,
      source: null, renderFileId: null,
    });
    await session.whenDurable();
    hold = true;
    const trashing = trashAssets(session, [assetId]);
    await new Promise((r) => setTimeout(r, 20));
    // The tab could die here: the original must still be out of the trash.
    expect((await adapter.getFile(original.id))?.trashed).toBe(false);
    hold = false;
    for (const release of held) release();
    await trashing;
    expect((await adapter.getFile(original.id))?.trashed).toBe(true);
    const saved = await inner.load(session.libraryId);
    expect(saved?.outbox.some((op) => op.op.t === 'set' && op.op.fields.deleted === true)).toBe(true);
  });

  it('keeps the deletion when a file cannot be trashed, and says so', async () => {
    const { adapter, session, assetId } = await libraryWithPhoto();
    adapter.trash = () => Promise.reject(new Error('network down'));
    await expect(trashAssets(session, [assetId])).rejects.toThrow(/left the library/);
    expect(session.getView().assets.get(assetId)?.deleted).toBe(true);
  });
});

describe('storeEditPreviews', () => {
  const measure = async () => ({ width: 3, height: 2 });
  const previews = { thumb: new Blob([new Uint8Array([9])]), screen: new Blob([new Uint8Array([8])]), recipeHash: 'edited-hash' };

  it('deletes the old previews once the version points at the new ones', async () => {
    const { adapter, session, versionId, previewId } = await libraryWithPhoto();
    session.editRecipe(versionId, { 'tone.exposure': 0.5 }, 'Exposure');
    const recipe = session.getView().versions.get(versionId)?.recipe ?? DEFAULT_RECIPE;
    await storeEditPreviews(session, versionId, { ...previews, recipeHash: recipeHash(recipe) }, null, measure);
    const version = session.getView().versions.get(versionId);
    expect(version?.thumb?.recipeHash).toBe(recipeHash(recipe));
    expect(version?.thumb?.fileId).not.toBe(previewId);
    expect(await adapter.getFile(previewId)).toBeNull();
  });

  it('records the pipeline that rendered them, and replaces previews of the same edit from another pipeline', async () => {
    const { session, versionId, previewId } = await libraryWithPhoto();
    const hash = recipeHash(DEFAULT_RECIPE);
    for (const size of ['thumb', 'screen'] as const) {
      session.setPreview(versionId, size, { fileId: previewId, recipeHash: hash, pipeline: PIPELINE_VERSION + 1, width: 3, height: 2 });
    }
    await storeEditPreviews(session, versionId, { ...previews, recipeHash: hash }, null, measure);
    const version = session.getView().versions.get(versionId);
    expect(version?.thumb).toMatchObject({ recipeHash: hash, pipeline: PIPELINE_VERSION });
    expect(version?.thumb?.fileId).not.toBe(previewId);
  });

  it('keeps the old previews, and drops the new files, when the version did not take them', async () => {
    const { adapter, session, versionId, previewId } = await libraryWithPhoto();
    const created: string[] = [];
    const createFile = adapter.createFile.bind(adapter);
    adapter.createFile = async (...args) => {
      const f = await createFile(...args);
      created.push(f.id);
      return f;
    };
    // A session that refuses the record (as a guarded, read-only one does).
    const refusing = new Proxy(session, {
      get(target, property) {
        if (property === 'setPreview') return () => undefined;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    await storeEditPreviews(refusing, versionId, previews, null, measure);
    expect(session.getView().versions.get(versionId)?.thumb?.fileId).toBe(previewId);
    expect(await adapter.getFile(previewId)).not.toBeNull();
    expect(created).toHaveLength(2);
    for (const id of created) expect(await adapter.getFile(id)).toBeNull();
  });
});

describe('leftover originals', () => {
  it('trashes originals of deleted photos and never a live one', async () => {
    const { adapter, session, assetId, originalId } = await libraryWithPhoto();
    // A live photo's original is refused even when asked for.
    expect(await trashLeftoverOriginals(session, [originalId])).toBe(0);
    expect((await adapter.getFile(originalId))?.trashed).toBe(false);
    // The photo leaves the library but its original stays out of the trash (a failed delete).
    session.deleteAssets([assetId]);
    expect(await trashLeftoverOriginals(session, [originalId, originalId])).toBe(1);
    expect((await adapter.getFile(originalId))?.trashed).toBe(true);
  });
});

describe('delete and library undo', () => {
  it('keeps delete out of library history, so undo never brings back a record without its files', async () => {
    const { adapter, session, assetId, originalId, previewId } = await libraryWithPhoto();
    session.setMarks([assetId], { rating: 3 });
    await trashAssets(session, [assetId]);
    expect(session.getView().assets.get(assetId)?.deleted).toBe(true);
    expect((await adapter.getFile(originalId))?.trashed).toBe(true);
    // Library undo skips the delete: it undoes the rating, and the photo stays deleted with its files in the trash.
    expect(session.libraryHistory().undoLabel).not.toBe('Delete');
    session.undoLibrary();
    expect(session.getView().assets.get(assetId)?.deleted).toBe(true);

    // The delete's own Undo moves the record and the files together.
    await untrashAssets(session, [assetId]);
    expect(session.getView().assets.get(assetId)?.deleted).toBe(false);
    expect((await adapter.getFile(originalId))?.trashed).toBe(false);
    expect((await adapter.getFile(previewId))?.trashed).toBe(false);
    // And undoing in the library afterwards does not delete the record behind the files' back.
    session.undoLibrary();
    expect(session.getView().assets.get(assetId)?.deleted).toBe(false);
  });
});
