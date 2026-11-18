import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECIPE, recipeHash } from '../library/recipe';
import { StorageError } from '../storage/errors';
import { sha256Hex } from './hash';
import { startImport } from './importer';
import type { ImportContext } from './importer';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import type { PreviewRenderer } from './types';

const IMPORT_DAY = new Date(2026, 10, 18, 12);

function exif(date: string, extra = 0): Uint8Array {
  return buildTiff({
    entries: [
      { tag: 0x010f, ascii: 'FUJIFILM' },
      { tag: 0x0110, ascii: 'X-E5' },
      { tag: 0x0112, type: 3, values: [1] },
      { tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: date }, { tag: 0x8827, type: 3, values: [200 + extra] }] }] },
    ],
  });
}

/** A JPEG file whose bytes differ by `seed`, captured at `date`. */
function jpegFile(name: string, date = '2026:11:14 16:02:11', seed = 0): File {
  return new File([buildJpeg({ width: 600 + seed, height: 400, exif: exif(date, seed) })], name, {
    lastModified: IMPORT_DAY.getTime(),
  });
}

/**
 * A TIFF carrying the DNGVersion tag and an embedded JPEG: the container
 * structure the DNG path reads, with no raw image data in it.
 */
function dngFile(name: string, date: string): File {
  const preview = buildJpeg({ width: 1024, height: 683 });
  const bytes = buildTiff({
    entries: [
      { tag: 0x00fe, type: 4, values: [1] },
      { tag: 0x010f, ascii: 'FUJIFILM' },
      { tag: 0x0110, ascii: 'X-E5' },
      { tag: 0x0201, blob: preview },
      { tag: 0x0202, type: 4, values: [preview.length] },
      { tag: 0xc612, type: 1, values: [1, 4, 0, 0] },
      { tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: date }] }] },
    ],
  });
  return new File([bytes], name, { lastModified: IMPORT_DAY.getTime() });
}

const fakeRenderer: PreviewRenderer & { calls: { size: number; orientation: number }[] } = {
  calls: [],
  async render(_source, maxSize, orientation) {
    this.calls.push({ size: maxSize, orientation });
    return { blob: new Blob([`preview-${maxSize}`], { type: 'image/jpeg' }), width: maxSize, height: Math.round(maxSize * 0.66) };
  },
};

async function setup() {
  const adapter = new TestMemoryAdapter();
  const root = await adapter.getRoot();
  const library = await adapter.createFolder(root.id, 'Lopsy Photos');
  const originals = await adapter.createFolder(library.id, 'Originals');
  const data = await adapter.createFolder(library.id, 'Library data');
  const previews = await adapter.createFolder(data.id, 'previews');
  const session = new FakeLibrarySession(adapter, { rootId: library.id, originalsId: originals.id, previewsId: previews.id });
  const ctx = (extra: Partial<ImportContext> = {}): ImportContext => ({
    session,
    previewRenderer: fakeRenderer,
    now: () => IMPORT_DAY,
    ...extra,
  });
  return { adapter, session, originalsId: originals.id, previewsId: previews.id, ctx };
}

async function pathOf(adapter: TestMemoryAdapter, fileId: string): Promise<string> {
  const parts: string[] = [];
  for (let f = await adapter.getFile(fileId); f && f.parentId !== null; f = await adapter.getFile(f.parentId)) parts.unshift(f.name);
  return parts.join('/');
}

describe('startImport', () => {
  it('imports photos into date folders with tags, previews and facts', async () => {
    const { adapter, session, previewsId, ctx } = await setup();
    const files = [jpegFile('DSCF0001.JPG'), jpegFile('DSCF0002.JPG', '2026:11:15 09:00:00', 1)];
    const job = startImport(files, ctx());
    const listener = vi.fn();
    job.subscribe(listener);
    const result = await job.finished;

    expect(result.finished).toBe(true);
    expect(result.items.map((i) => i.state)).toEqual(['done', 'done']);
    expect(listener).toHaveBeenCalled();
    expect(job.getProgress()).toBe(job.getProgress());

    const view = session.getView();
    expect(view.assets.size).toBe(2);
    const first = view.assets.get(result.items[0]?.assetId ?? '');
    if (!first) throw new Error('asset missing');
    expect(first).toMatchObject({
      kind: 'original',
      fileName: 'DSCF0001.JPG',
      format: 'jpeg',
      mimeType: 'image/jpeg',
      capturedAt: '2026-11-14T16:02:11',
      importedAt: IMPORT_DAY.toISOString(),
      importId: job.id,
      width: 600,
      height: 400,
      camera: { make: 'FUJIFILM', model: 'X-E5' },
      exposure: { iso: 200 },
      pairedWith: null,
      byteSize: files[0]?.size,
      sha256: await sha256Hex(files[0] as File),
    });

    const original = await adapter.getFile(first.fileId);
    expect(await pathOf(adapter, first.fileId)).toBe('Lopsy Photos/Originals/2026/2026-11-14/DSCF0001.JPG');
    expect(original?.properties).toEqual({ 'lp.lib': 'lib-test', 'lp.role': 'original', 'lp.asset': first.id, 'lp.sha': first.sha256 });
    expect(await pathOf(adapter, view.assets.get(result.items[1]?.assetId ?? '')?.fileId ?? '')).toBe(
      'Lopsy Photos/Originals/2026/2026-11-15/DSCF0002.JPG',
    );

    const version = view.versions.get(first.primaryVersionId);
    expect(version?.thumb).toMatchObject({ recipeHash: recipeHash(DEFAULT_RECIPE), width: 512 });
    expect(version?.screen).toMatchObject({ width: 2048 });
    const thumbFile = await adapter.getFile(version?.thumb?.fileId ?? '');
    expect(thumbFile).toMatchObject({
      parentId: previewsId,
      name: `${first.id}.${first.primaryVersionId}.512.jpg`,
      properties: { 'lp.lib': 'lib-test', 'lp.role': 'preview', 'lp.asset': first.id },
    });
    expect(adapter.filesIn(previewsId)).toHaveLength(4);
  });

  it('skips duplicates of the library and of the batch, but not of deleted assets', async () => {
    const { session, ctx } = await setup();
    const inLibrary = jpegFile('A.JPG', undefined, 1);
    const deletedOne = jpegFile('B.JPG', undefined, 2);
    const base = {
      kind: 'original' as const,
      fileId: 'x',
      fileName: 'old.jpg',
      byteSize: 1,
      format: 'jpeg' as const,
      mimeType: 'image/jpeg',
      capturedAt: null,
      importedAt: IMPORT_DAY.toISOString(),
      importId: 'old',
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
    const existingId = session.seed({ ...base, sha256: await sha256Hex(inLibrary) });
    session.seed({ ...base, sha256: await sha256Hex(deletedOne), deleted: true });

    const twin = jpegFile('C.JPG', undefined, 3);
    const twinCopy = new File([twin], 'C copy.JPG');
    const result = await startImport([inLibrary, deletedOne, twin, twinCopy], ctx({ options: { concurrency: 1 } })).finished;
    expect(result.items.map((i) => i.state)).toEqual(['duplicate', 'done', 'done', 'duplicate']);
    expect(result.items[0]?.assetId).toBe(existingId);

    const again = await startImport([inLibrary], ctx({ options: { skipDuplicates: false } })).finished;
    expect(again.items[0]?.state).toBe('done');
  });

  it('marks unsupported files and carries on', async () => {
    const { session, ctx } = await setup();
    const files = [
      new File([new Uint8Array([1, 2, 3, 4, 5])], 'notes.txt'),
      new File([new TextEncoder().encode('LOPSY\0v3...')], 'doc.lopsy'),
      new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], 'fake.jpg'),
      jpegFile('ok.jpg'),
    ];
    const result = await startImport(files, ctx()).finished;
    expect(result.items.map((i) => i.state)).toEqual(['unsupported', 'unsupported', 'unsupported', 'done']);
    expect(result.items[0]?.error).toBeTruthy();
    expect(session.getView().assets.size).toBe(1);
  });

  it('leaves an item waiting to retry when its upload fails, without stopping the others', async () => {
    const { adapter, session, ctx } = await setup();
    adapter.hooks.failCreate = (file) =>
      file.name === 'BAD.JPG' ? new StorageError('quota-exceeded', 'The storage is full') : null;
    const result = await startImport([jpegFile('BAD.JPG'), jpegFile('GOOD.JPG', undefined, 1)], ctx()).finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual([
      ['queued', 'Waiting to retry: The storage is full'],
      ['done', null],
    ]);
    expect([...session.getView().assets.values()].map((a) => a.fileName)).toEqual(['GOOD.JPG']);
  });

  it('trashes an upload whose checksum does not match, retries, then waits', async () => {
    const { adapter, session, ctx } = await setup();
    adapter.hooks.reportSha = (file) => (file.properties?.['lp.role'] === 'original' ? 'deadbeef' : null);
    const result = await startImport([jpegFile('X.JPG')], ctx({ retryDelaysMs: [0, 0] })).finished;
    expect(result.items[0]?.state).toBe('queued');
    expect(result.items[0]?.error).toMatch(/^Waiting to retry: checksum/i);
    expect(session.getView().assets.size).toBe(0);
    const uploaded = [...adapter.files.values()].map((e) => e.file).filter((f) => f.name === 'X.JPG');
    expect(uploaded).toHaveLength(3);
    expect(uploaded.every((f) => f.trashed)).toBe(true);
  });

  it('keeps to the concurrency limit and reports upload progress', async () => {
    const { adapter, ctx } = await setup();
    let inFlight = 0;
    let maxInFlight = 0;
    adapter.hooks.createDelay = (file) => {
      if (file.properties?.['lp.role'] !== 'original') return null;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve();
        }, 5),
      );
    };
    const files = Array.from({ length: 7 }, (_, i) => jpegFile(`F${i}.JPG`, undefined, i));
    const job = startImport(files, ctx({ options: { concurrency: 2 } }));
    const sent = new Set<number>();
    job.subscribe(() => {
      for (const item of job.getProgress().items) if (item.state === 'uploading') sent.add(item.sentBytes);
    });
    const result = await job.finished;
    expect(result.items.every((i) => i.state === 'done' && i.sentBytes === i.byteSize)).toBe(true);
    expect(maxInFlight).toBe(2);
    expect([...sent].some((n) => n > 0)).toBe(true);
  });

  it('cancels: queued items stop, in-flight uploads abort, nothing half-added', async () => {
    const { adapter, session, ctx } = await setup();
    adapter.hooks.createDelay = () => new Promise<void>(() => {});
    const files = Array.from({ length: 5 }, (_, i) => jpegFile(`C${i}.JPG`, undefined, i));
    const job = startImport(files, ctx({ options: { concurrency: 2 } }));
    await vi.waitFor(() => {
      expect(job.getProgress().items.filter((i) => i.state === 'uploading')).toHaveLength(2);
    });
    job.cancel();
    const result = await job.finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual(Array.from({ length: 5 }, () => ['failed', 'Cancelled']));
    expect(session.getView().assets.size).toBe(0);
    expect([...adapter.files.values()].filter((e) => !e.file.isFolder && !e.file.trashed && e.file.parentId !== null)).toHaveLength(0);
  });

  it('names a different file with the same name in the same folder with (2)', async () => {
    const { session, ctx } = await setup();
    const result = await startImport([jpegFile('DSCF1.JPG'), jpegFile('DSCF1.JPG', undefined, 9)], ctx()).finished;
    expect(result.items.map((i) => i.state)).toEqual(['done', 'done']);
    const view = session.getView();
    const names = await Promise.all(
      [...view.assets.values()].map(async (a) => (await session.adapter.getFile(a.fileId))?.name),
    );
    expect(names.sort()).toEqual(['DSCF1 (2).JPG', 'DSCF1.JPG']);
    expect([...view.assets.values()].map((a) => a.fileName)).toEqual(['DSCF1.JPG', 'DSCF1.JPG']);
  });

  it('applies the import extras: recipe, keywords and album', async () => {
    const { session, ctx } = await setup();
    const recipe = { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, exposure: 1 } };
    const result = await startImport([jpegFile('K.JPG')], ctx({ recipe, keywords: ['trip'], albumId: 'album-1' })).finished;
    const asset = session.getView().assets.get(result.items[0]?.assetId ?? '');
    expect(asset?.keywords).toEqual(['trip']);
    expect(session.getView().versions.get(asset?.primaryVersionId ?? '')?.recipe.tone.exposure).toBe(1);
    expect(session.albumMembers).toEqual([{ albumId: 'album-1', assetId: asset?.id }]);
  });

  it('starts new versions from a preset chosen by ID', async () => {
    const { session, ctx } = await setup();
    session.addPresetForTest({
      id: 'p-1',
      name: 'Bright',
      groups: ['tone'],
      values: { 'tone.exposure': 0.5 },
      createdAt: '',
      deleted: false,
    });
    const saved = await startImport([jpegFile('P.JPG')], ctx({ options: { presetId: 'p-1' } })).finished;
    const builtIn = await startImport([jpegFile('M.JPG', '2026:01:02 03:04:05')], ctx({ options: { presetId: 'builtin:monochrome' } })).finished;
    const recipeOf = (r: typeof saved) => {
      const asset = session.getView().assets.get(r.items[0]?.assetId ?? '');
      return session.getView().versions.get(asset?.primaryVersionId ?? '')?.recipe;
    };
    expect(recipeOf(saved)?.tone.exposure).toBe(0.5);
    expect(recipeOf(builtIn)?.profile.id).toBe('monochrome');
  });

  describe('RAW+JPEG pairs', () => {
    it("keeps both and pairs the JPEG with the RAW ('both')", async () => {
      const { session, ctx } = await setup();
      // The JPEG comes first in the list; the RAW is still imported first.
      const files = [jpegFile('DSCF7.JPG', '2026:11:14 16:02:12'), dngFile('DSCF7.DNG', '2026:11:14 16:02:11')];
      const result = await startImport(files, ctx({ options: { concurrency: 2 } })).finished;
      expect(result.items.map((i) => i.state)).toEqual(['done', 'done']);
      const view = session.getView();
      const jpeg = view.assets.get(result.items[0]?.assetId ?? '');
      const raw = view.assets.get(result.items[1]?.assetId ?? '');
      expect(raw?.format).toBe('dng');
      expect(raw?.pairedWith).toBeNull();
      expect(jpeg?.pairedWith).toBe(raw?.id);
    });

    it("skips the JPEG ('raw-only')", async () => {
      const { session, ctx } = await setup();
      const files = [dngFile('DSCF7.DNG', '2026:11:14 16:02:11'), jpegFile('dscf7.jpg', '2026:11:14 16:02:11')];
      const result = await startImport(files, ctx({ options: { rawPlusJpeg: 'raw-only' } })).finished;
      expect(result.items.map((i) => i.state)).toEqual(['done', 'skipped']);
      expect(session.getView().assets.size).toBe(1);
    });

    it('does not pair when the capture times are more than 2 s apart', async () => {
      const { session, ctx } = await setup();
      const files = [dngFile('DSCF8.DNG', '2026:11:14 16:02:11'), jpegFile('DSCF8.JPG', '2026:11:14 16:05:00')];
      const result = await startImport(files, ctx({ options: { rawPlusJpeg: 'raw-only' } })).finished;
      expect(result.items.map((i) => i.state)).toEqual(['done', 'done']);
      expect([...session.getView().assets.values()].every((a) => a.pairedWith === null)).toBe(true);
    });
  });

  it('finishes at once with no files', async () => {
    const { ctx } = await setup();
    const result = await startImport([], ctx()).finished;
    expect(result).toEqual({ items: [], finished: true });
  });
});
