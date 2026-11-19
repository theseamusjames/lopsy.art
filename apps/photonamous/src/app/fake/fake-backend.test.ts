import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { FakeBackend } from './fake-backend';
import { FakeSession } from './fake-session';

const sessions: FakeSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
});

function session(): FakeSession {
  const s = new FakeSession('memory', 'Test');
  sessions.push(s);
  return s;
}

describe('FakeSession', () => {
  it('changes the view identity only on change and counts pending ops', () => {
    const s = session();
    const before = s.getView();
    expect(s.getView()).toBe(before);
    const { assetId } = s.addAsset({
      kind: 'original',
      fileId: 'f',
      sha256: 'x',
      fileName: 'a.jpg',
      byteSize: 1,
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
    s.setMarks([assetId], { rating: 4 });
    s.setKeyword([assetId], 'sea', true);
    expect(s.getView()).not.toBe(before);
    const asset = s.getView().assets.get(assetId);
    expect(asset?.rating).toBe(4);
    expect(asset?.keywords).toEqual(['sea']);
    expect(s.getSyncStatus().pendingOps).toBe(3);
  });

  it('undoes and redoes recipe steps', () => {
    const s = session();
    const { assetId } = s.addAsset({
      kind: 'original', fileId: 'f', sha256: 'x', fileName: 'a.jpg', byteSize: 1, format: 'jpeg', mimeType: 'image/jpeg',
      capturedAt: null, importedAt: '2026-01-01T00:00:00Z', importId: 'i', width: null, height: null, orientation: 1,
      camera: null, lens: null, exposure: null, gps: null, pairedWith: null, source: null, renderFileId: null,
    });
    const versionId = s.getView().assets.get(assetId)?.primaryVersionId ?? '';
    s.editRecipe(versionId, { 'tone.exposure': 1 }, 'Exposure');
    expect(s.getView().versions.get(versionId)?.recipe.tone.exposure).toBe(1);
    expect(s.undo(versionId)).toBe(true);
    expect(s.getView().versions.get(versionId)?.recipe).toEqual(DEFAULT_RECIPE);
    expect(s.redo(versionId)).toBe(true);
    expect(s.history(versionId)).toHaveLength(1);
  });
});

describe('FakeBackend import', () => {
  it('walks files through to done, pairs RAW+JPEG and skips non-photos', async () => {
    const backend = new FakeBackend(0);
    const s = session();
    const files = [
      new File([new Uint8Array(10)], 'DSCF1.RAF'),
      new File([new Uint8Array(10)], 'DSCF1.JPG'),
      new File([new Uint8Array(10)], 'notes.txt'),
    ];
    const job = backend.startImport(files, s, { concurrency: 3 });
    const result = await job.finished;
    expect(result.items.map((i) => i.state).sort()).toEqual(['done', 'done', 'unsupported']);
    const assets = [...s.getView().assets.values()];
    expect(assets).toHaveLength(2);
    expect(assets.every((a) => a.pairedWith !== null)).toBe(true);
    // A second import of the same files finds them already there.
    const again = await backend.startImport(files.slice(0, 2), s).finished;
    expect(again.items.map((i) => i.state)).toEqual(['duplicate', 'duplicate']);
  }, 10_000);
});
