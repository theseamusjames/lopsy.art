import { describe, expect, it } from 'vitest';
import type { LibrarySession, PreviewRef } from '@lopsy/photos-core/library/types';
import { MemoryAdapter } from '@lopsy/photos-core/storage/memory-adapter';
import { MemoryLocalStore } from '@lopsy/photos-core/library/local-store';
import { openLibrary } from '@lopsy/photos-core/library/session';
import { NoopLibraryLock } from '@lopsy/photos-core/library/lock';
import { recipeHash, DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { guardSession } from '../guard-session';
import { trashAssets, TrashRefusedError } from './trash-assets';
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
  const ref: PreviewRef = { fileId: preview.id, recipeHash: recipeHash(DEFAULT_RECIPE), width: 3, height: 2 };
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
    await storeEditPreviews(session, versionId, previews, null, measure);
    const version = session.getView().versions.get(versionId);
    expect(version?.thumb?.recipeHash).toBe('edited-hash');
    expect(version?.thumb?.fileId).not.toBe(previewId);
    expect(await adapter.getFile(previewId)).toBeNull();
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
