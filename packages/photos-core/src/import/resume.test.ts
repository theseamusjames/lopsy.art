import { describe, expect, it, vi } from 'vitest';
import { StorageError } from '../storage/errors';
import { sha256Hex } from './hash';
import { InProcessImportLocks } from './claim-locks';
import { DEFAULT_LEASE_MS, resumeImports, startImport, uploadResumeKey } from './importer';
import type { ImportContext } from './importer';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import type { ImportJob, PreviewRenderer } from './types';

const DAY = new Date(2026, 10, 18, 12);

function jpegFile(name: string, seed: number): File {
  const exif = buildTiff({
    entries: [{ tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: '2026:11:14 16:02:11' }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] }],
  });
  return new File([buildJpeg({ width: 600 + seed, height: 400, exif })], name, { lastModified: DAY.getTime() });
}

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob([`p${maxSize}`], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

async function setup() {
  const adapter = new TestMemoryAdapter();
  const root = await adapter.getRoot();
  const originals = await adapter.createFolder(root.id, 'Originals');
  const previews = await adapter.createFolder(root.id, 'previews');
  const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
  const queueStore = new MemoryImportQueueStore();
  const staging = new MemoryStagingStore();
  const ctx = (extra: Partial<ImportContext> = {}): ImportContext => ({
    session,
    previewRenderer: renderer,
    now: () => DAY,
    queueStore,
    staging,
    ...extra,
  });
  const originalsOf = () => [...adapter.files.values()].map((e) => e.file).filter((f) => !f.trashed && f.properties['lp.role'] === 'original');
  return { adapter, session, queueStore, staging, ctx, originalsOf };
}

/** Lets the first `free` original uploads through and holds the rest until aborted (or forever). */
function holdUploadsAfter(adapter: TestMemoryAdapter, free: number) {
  let started = 0;
  adapter.hooks.createDelay = (file) => {
    if (file.properties?.['lp.role'] !== 'original') return null;
    started++;
    return started <= free ? null : new Promise<void>(() => {});
  };
}

async function waitUntilAllStagedAndDone(job: ImportJob, done: number) {
  await vi.waitFor(() => {
    const states = job.getProgress().items.map((i) => i.state);
    expect(states.filter((s) => s === 'done')).toHaveLength(done);
    expect(states.filter((s) => s === 'queued' || s === 'reading')).toHaveLength(0);
  });
}

describe('resumable imports', () => {
  it('a paused job is resumed by a new job and every file is imported exactly once', async () => {
    const { adapter, session, queueStore, staging, ctx, originalsOf } = await setup();
    const files = Array.from({ length: 6 }, (_, i) => jpegFile(`R${i}.JPG`, i));
    holdUploadsAfter(adapter, 2);
    const first = startImport(files, ctx({ options: { concurrency: 2 } }));
    await waitUntilAllStagedAndDone(first, 2);
    first.pause();
    const paused = await first.finished;
    expect(paused.items.filter((i) => i.state === 'done')).toHaveLength(2);
    expect(paused.items.filter((i) => i.state === 'queued' && i.error === 'Paused')).toHaveLength(4);
    expect(await staging.list()).toHaveLength(4);
    expect(queueStore.jobs.size).toBe(1);

    adapter.hooks = {};
    const second = await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: () => DAY });
    if (!second) throw new Error('nothing resumed');
    const resumed = await second.finished;
    expect(resumed.items.map((i) => i.state)).toEqual(['done', 'done', 'done', 'done']);

    const assets = [...session.getView().assets.values()];
    expect(assets).toHaveLength(6);
    const shas = await Promise.all(files.map((f) => sha256Hex(f)));
    expect(new Set(assets.map((a) => a.sha256))).toEqual(new Set(shas));
    expect(originalsOf()).toHaveLength(6);
    expect(new Set(originalsOf().map((f) => f.name)).size).toBe(6);
    for (const a of assets) expect(session.getView().versions.get(a.primaryVersionId)?.thumb).not.toBeNull();
    expect(await staging.list()).toEqual([]);
    expect(queueStore.jobs.size).toBe(0);
    expect(await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: () => DAY })).toBeNull();
  });

  it('continues after a reload mid-upload, reusing an original that reached storage', async () => {
    const { adapter, session, queueStore, staging, ctx, originalsOf } = await setup();
    const files = Array.from({ length: 4 }, (_, i) => jpegFile(`L${i}.JPG`, i));
    holdUploadsAfter(adapter, 1);
    // The "old tab": its held uploads never finish, as if the page had gone away.
    const old = startImport(files, ctx({ options: { concurrency: 3 } }));
    await waitUntilAllStagedAndDone(old, 1);
    await vi.waitFor(() => {
      const record = [...queueStore.jobs.values()][0];
      expect(record?.items.filter((i) => i.state === 'uploading' && i.destinationName !== null)).toHaveLength(3);
    });

    // One held upload had in fact reached storage before the reload.
    const record = [...queueStore.jobs.values()][0];
    const reached = record?.items.find((i) => i.state === 'uploading');
    if (!reached || !reached.sha256) throw new Error('no uploading item');
    adapter.hooks = {};
    const content = await staging.get(reached.stagingKey ?? '');
    if (!content) throw new Error('not staged');
    const folderId = originalsOf()[0]?.parentId ?? '';
    await adapter.createFile(
      {
        parentId: folderId,
        name: reached.destinationName ?? '',
        mimeType: 'image/jpeg',
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.asset': reached.plannedAssetId, 'lp.sha': reached.sha256 },
      },
      content,
    );

    // The old tab's lease is still fresh by the clock; a reload takes over once it has lapsed.
    // The reloaded page has its own locks: the old page's are gone with it.
    const reloaded = new InProcessImportLocks();
    expect(await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: () => DAY, locks: reloaded })).toBeNull();
    const later = () => new Date(DAY.getTime() + DEFAULT_LEASE_MS + 1_000);
    const job = await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: later, locks: reloaded });
    const result = await job?.finished;
    expect(result?.items.map((i) => i.state)).toEqual(['done', 'done', 'done']);
    expect(session.getView().assets.size).toBe(4);
    expect(originalsOf()).toHaveLength(4);
    expect(session.getView().assets.get(reached.plannedAssetId)).toBeDefined();
    expect(adapter.resumeKeys.filter((k) => k !== undefined).every((k) => k?.startsWith(`${session.libraryId}:`))).toBe(true);
    // Only the old tab's attempt: the resumed job reused the stored original instead of uploading it again.
    expect(adapter.resumeKeys.filter((k) => k === uploadResumeKey(session.libraryId, reached.plannedAssetId))).toHaveLength(1);
    expect(await staging.list()).toEqual([]);
  });

  it('fails resumed items whose staged copy is gone or that never reached staging', async () => {
    const { session, queueStore, staging } = await setup();
    await queueStore.saveJob({
      id: 'old',
      libraryId: session.libraryId,
      createdAt: DAY.toISOString(),
      options: { skipDuplicates: true, rawPlusJpeg: 'both', concurrency: 2 },
      recipe: null,
      keywords: null,
      albumId: null,
      items: [
        { index: 0, fileName: 'gone.jpg', byteSize: 10, lastModified: 0, plannedAssetId: 'a0', sha256: 'f'.repeat(64), state: 'staged', assetId: null, error: null, staged: true, pairedWith: null, folderSegments: null, destinationName: null },
        { index: 1, fileName: 'early.jpg', byteSize: 10, lastModified: 0, plannedAssetId: 'a1', sha256: null, state: 'reading', assetId: null, error: null, staged: false, pairedWith: null, folderSegments: null, destinationName: null },
        { index: 2, fileName: 'fine.jpg', byteSize: 10, lastModified: 0, plannedAssetId: 'a2', sha256: null, state: 'done', assetId: 'a2', error: null, staged: false, pairedWith: null, folderSegments: null, destinationName: null },
      ],
    });
    const job = await resumeImports({ session, previewRenderer: renderer, queueStore, staging });
    const result = await job?.finished;
    expect(result?.items.map((i) => [i.fileName, i.state, i.error])).toEqual([
      ['gone.jpg', 'failed', 'Its staged copy on this device is gone; import the file again'],
      ['early.jpg', 'failed', 'Interrupted before it was staged on this device; import the file again'],
    ]);
    expect(queueStore.jobs.size).toBe(0);
  });

  it('stages each file, passes the resume key and cleans staging up on every outcome', async () => {
    const { adapter, session, queueStore, staging, ctx } = await setup();
    const put = vi.spyOn(staging, 'put');
    const dup = jpegFile('dup.JPG', 1);
    adapter.hooks.failCreate = (file) => (file.name === 'BAD.JPG' ? new StorageError('invalid', 'Refused') : null);
    const job = startImport([jpegFile('ok.JPG', 0), dup, new File([dup], 'dup copy.JPG'), new File(['nope'], 'x.txt'), jpegFile('BAD.JPG', 2)], ctx());
    const seen = new Set<string>();
    job.subscribe(() => job.getProgress().items.forEach((i) => seen.add(i.state)));
    const result = await job.finished;
    const states = result.items.map((i) => i.state);
    expect([states[0], states[3], states[4]]).toEqual(['done', 'unsupported', 'queued']);
    // The two identical files hash concurrently: whichever claims the hash first is kept.
    expect([states[1], states[2]].sort()).toEqual(['done', 'duplicate']);
    expect(result.items[4]?.error).toBe('Waiting to retry: Refused');
    expect(seen.has('staged')).toBe(true);
    expect(put).toHaveBeenCalledTimes(3);
    // Only the copy still waiting to upload stays staged, and its job stays queued.
    expect(await staging.list()).toHaveLength(1);
    expect(queueStore.jobs.size).toBe(1);
    expect(adapter.resumeKeys).toContain(uploadResumeKey(session.libraryId, result.items[1]?.assetId ?? ''));
  });

  it('runs unstaged, with a note, when staging has no room', async () => {
    const { ctx, staging } = await setup();
    const tiny = new MemoryStagingStore(10);
    const job = startImport([jpegFile('big.JPG', 0)], ctx({ staging: tiny }));
    const notes = new Set<string | null>();
    job.subscribe(() => notes.add(job.getProgress().items[0]?.error ?? null));
    const result = await job.finished;
    expect(result.items[0]?.state).toBe('done');
    expect([...notes].some((n) => n !== null && /not staged/i.test(n))).toBe(true);
    expect(await tiny.list()).toEqual([]);
    expect(await staging.list()).toEqual([]);
  });

  it('cancel deletes staged copies and the queue', async () => {
    const { adapter, staging, queueStore, ctx } = await setup();
    holdUploadsAfter(adapter, 0);
    const job = startImport([jpegFile('a.JPG', 0), jpegFile('b.JPG', 1)], ctx());
    await waitUntilAllStagedAndDone(job, 0);
    job.cancel();
    const result = await job.finished;
    expect(result.items.map((i) => i.error)).toEqual(['Cancelled', 'Cancelled']);
    expect(await staging.list()).toEqual([]);
    expect(queueStore.jobs.size).toBe(0);
  });

  it('imports the next copy of a duplicate when the first copy fails', async () => {
    const { adapter, session } = await setup();
    let failures = 0;
    adapter.hooks.failCreate = (file) =>
      file.properties?.['lp.role'] === 'original' && failures++ === 0 ? new StorageError('invalid', 'Refused') : null;
    const twin = jpegFile('T.JPG', 5);
    const files = [twin, new File([twin], 'T copy.JPG'), new File([twin], 'T copy 2.JPG')];
    const result = await startImport(files, {
      session,
      previewRenderer: renderer,
      options: { concurrency: 1 },
    }).finished;
    expect(result.items.map((i) => i.state)).toEqual(['queued', 'done', 'duplicate']);
    expect(result.items[2]?.assetId).toBe(result.items[1]?.assetId);
    expect(session.getView().assets.size).toBe(1);
  });
});
