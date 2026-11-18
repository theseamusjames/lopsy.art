import { describe, expect, it } from 'vitest';
import { MemoryLocalStore } from './local-store';
import { repairLibrary } from './repair';
import { openLibrary } from './session';
import { TestAdapter } from './test-support/test-adapter';
import type { NewAsset } from './types';

async function setup() {
  const adapter = new TestAdapter();
  const session = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
  const upload = async (n: number) => {
    const sha = `${n}`.repeat(64).slice(0, 64);
    const file = await adapter.createFile(
      {
        parentId: session.layout.originalsId,
        name: `IMG_${n}.JPG`,
        mimeType: 'image/jpeg',
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.sha': sha },
      },
      new Blob([`photo ${n}`]),
    );
    return { file, sha };
  };
  const add = (fileId: string, sha256: string): string => {
    const asset: NewAsset = {
      kind: 'original',
      fileId,
      sha256,
      fileName: 'x.jpg',
      byteSize: 7,
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
    return session.addAsset(asset).assetId;
  };
  return { adapter, session, upload, add };
}

describe('repairLibrary', () => {
  it('finds orphans and marks missing, trashed and changed originals', async () => {
    const { adapter, session, upload, add } = await setup();
    const good = await upload(1);
    const gone = await upload(2);
    const binned = await upload(3);
    const altered = await upload(4);
    const orphan = await upload(5);
    const deletedAsset = await upload(6);
    const ids = {
      good: add(good.file.id, good.sha),
      gone: add(gone.file.id, gone.sha),
      binned: add(binned.file.id, binned.sha),
      altered: add(altered.file.id, altered.sha),
      deleted: add(deletedAsset.file.id, deletedAsset.sha),
    };
    session.deleteAssets([ids.deleted]);
    await adapter.trash(deletedAsset.file.id);
    await adapter.deletePermanently(gone.file.id);
    await adapter.trash(binned.file.id);
    await adapter.updateProperties(altered.file.id, { 'lp.sha': 'f'.repeat(64) });
    // Another library's original is not ours to adopt.
    await adapter.createFile(
      { parentId: session.layout.originalsId, name: 'other.jpg', mimeType: 'image/jpeg', properties: { 'lp.lib': 'other', 'lp.role': 'original' } },
      new Blob(['x']),
    );

    const report = await repairLibrary(session);
    expect(report.orphans).toEqual([orphan.file.id]);
    expect(report.missing).toEqual([ids.gone]);
    expect(report.trashed).toEqual([ids.binned]);
    expect(report.changed).toEqual([ids.altered]);
    expect(report.assetsChecked).toBe(4);
    const view = session.getView();
    expect(view.assets.get(ids.good)?.originalStatus).toBe('ok');
    expect(view.assets.get(ids.gone)?.originalStatus).toBe('missing');
    expect(view.assets.get(ids.binned)?.originalStatus).toBe('trashed');
    expect(view.assets.get(ids.altered)?.originalStatus).toBe('changed');

    // A second run with nothing new writes nothing.
    const pending = session.getSyncStatus().pendingOps;
    await repairLibrary(session);
    expect(session.getSyncStatus().pendingOps).toBe(pending);

    await adapter.untrash(binned.file.id);
    const again = await repairLibrary(session);
    expect(again.restored).toEqual([ids.binned]);
    expect(session.getView().assets.get(ids.binned)?.originalStatus).toBe('ok');
  });

  it('syncs the marks to other devices', async () => {
    const { adapter, session, upload, add } = await setup();
    const gone = await upload(1);
    const id = add(gone.file.id, gone.sha);
    await adapter.deletePermanently(gone.file.id);
    await repairLibrary(session);
    await session.syncNow();
    const other = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    await other.syncNow();
    expect(other.getView().assets.get(id)?.originalStatus).toBe('missing');
  });
});
