import { describe, expect, it, vi } from 'vitest';
import { InProcessImportLocks } from './claim-locks';
import { DEFAULT_LEASE_MS, resumeImports, startImport } from './importer';
import { dismissInterruptedImports, missingFilesText, readInterruptedImports } from './interrupted';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import type { ImportJob, PreviewRenderer } from './types';

const DAY = new Date(2026, 10, 18, 12);
const later = () => new Date(DAY.getTime() + DEFAULT_LEASE_MS + 1_000);

/** A file that counts how often it is read, to show what is skipped without reading it. */
class CountingFile extends File {
  reads = 0;
  override arrayBuffer(): Promise<ArrayBuffer> {
    this.reads++;
    return super.arrayBuffer();
  }
}

function photo(name: string, seed: number, padding = 0): CountingFile {
  const exif = buildTiff({
    entries: [{ tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: '2026:11:14 16:02:11' }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] }],
  });
  const parts: BlobPart[] = [buildJpeg({ width: 600 + seed, height: 400, exif })];
  if (padding > 0) parts.push(new Uint8Array(padding).fill(seed));
  return new CountingFile(parts, name, { lastModified: DAY.getTime() - seed * 1000 });
}

/** The same file chosen again: the same bytes, name and modified time, a new File object. */
function again(file: File): CountingFile {
  return new CountingFile([file], file.name, { lastModified: file.lastModified });
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
  const originalsOf = () => [...adapter.files.values()].map((e) => e.file).filter((f) => !f.trashed && f.properties['lp.role'] === 'original');
  return { adapter, session, queueStore, originalsOf };
}

/** Lets the first `free` original uploads through and holds the rest for good, as a tab that goes away. */
function holdUploadsAfter(adapter: TestMemoryAdapter, free: number) {
  let started = 0;
  adapter.hooks.createDelay = (file) => {
    if (file.properties?.['lp.role'] !== 'original') return null;
    started++;
    return started <= free ? null : new Promise<void>(() => {});
  };
}

/** Waits until `done` files are in and every other file has been prepared (staged or not) and recorded in the queue. */
async function settledUpTo(job: ImportJob, queueStore: MemoryImportQueueStore, done: number) {
  await vi.waitFor(() => {
    expect(job.getProgress().items.filter((i) => i.state === 'done')).toHaveLength(done);
    const record = [...queueStore.jobs.values()][0];
    expect(record?.items.every((i) => i.folderSegments !== null)).toBe(true);
  });
}

describe('an import a reload interrupted', () => {
  it('sums up what was not imported, and choosing the same files again imports exactly those', async () => {
    const { adapter, session, queueStore, originalsOf } = await setup();
    // Staging holds two of the six: as in a browser whose quota is far smaller than the files.
    const big = 4000;
    const files = Array.from({ length: 6 }, (_, i) => photo(`DSCF${1000 + i}.JPG`, i, big));
    const staging = new MemoryStagingStore(2 * (files[0]?.size ?? 0) + 10);
    holdUploadsAfter(adapter, 2);
    const old = startImport(files, { session, previewRenderer: renderer, now: () => DAY, queueStore, staging, options: { concurrency: 1 } });
    await settledUpTo(old, queueStore, 2);

    // The reload: the old page's uploads never finish; the new page resumes what was staged.
    adapter.hooks = {};
    const resumed = await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: later, locks: new InProcessImportLocks() });
    const after = await resumed?.finished;
    // Nothing failed one by one: the resumed job carries on only with what it has.
    expect(after?.items.every((i) => i.state === 'done')).toBe(true);
    const resumedCount = after?.items.length ?? 0;
    expect(session.getView().assets.size).toBe(2 + resumedCount);

    const summary = await readInterruptedImports(queueStore, session.libraryId, session.getView());
    expect(summary).not.toBeNull();
    expect(summary?.total).toBe(6);
    expect(summary?.imported).toBe(2 + resumedCount);
    expect(summary?.missing.map((f) => f.fileName)).toHaveLength(6 - 2 - resumedCount);
    const missingNames = summary?.missing.map((f) => f.fileName) ?? [];
    // Some were staged and carried on after the reload; some were not, and are missing.
    expect(resumedCount).toBeGreaterThan(0);
    expect(missingNames.length).toBeGreaterThan(0);
    expect(missingFilesText(summary?.missing ?? [])).toBe(`${missingNames.join('\n')}\n`);
    // Not a job to resume.
    expect(await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: later, locks: new InProcessImportLocks() })).toBeNull();

    // One upload the old page had sent reached storage after all, though the page never heard back.
    const record = [...queueStore.jobs.values()].find((j) => j.interrupted);
    const landed = record?.items.find((i) => i.needsFile && i.sha256 !== null);
    const landedFile = files.find((f) => f.name === landed?.fileName);
    if (!landed?.sha256 || !landedFile) throw new Error('no missing item with a checksum');
    const folderId = originalsOf()[0]?.parentId ?? '';
    await adapter.createFile(
      {
        parentId: folderId,
        name: landed.fileName,
        mimeType: 'image/jpeg',
        properties: { 'lp.lib': session.libraryId, 'lp.role': 'original', 'lp.asset': landed.plannedAssetId, 'lp.sha': landed.sha256 },
      },
      landedFile,
    );

    // The person chooses all six again.
    const chosen = files.map(again);
    const repick = await startImport(chosen, { session, previewRenderer: renderer, now: later, queueStore, staging }).finished;
    const byName = new Map(repick.items.map((i) => [i.fileName, i.state]));
    for (const file of files) expect(byName.get(file.name)).toBe(missingNames.includes(file.name) ? 'done' : 'duplicate');
    // What was already in the library was not read again, let alone hashed or uploaded.
    for (const file of chosen) if (!missingNames.includes(file.name)) expect(file.reads).toBe(0);
    expect(session.getView().assets.size).toBe(6);
    // The one that had landed is taken as it is: no second copy, no "(2)" in its name.
    expect(originalsOf()).toHaveLength(6);
    expect(new Set(originalsOf().map((f) => f.name))).toEqual(new Set(files.map((f) => f.name)));
    expect(session.getView().assets.get(landed.plannedAssetId)?.fileName).toBe(landed.fileName);
    // Every file is accounted for: the summary is gone.
    expect(await readInterruptedImports(queueStore, session.libraryId, session.getView())).toBeNull();
    expect([...queueStore.jobs.values()].filter((j) => j.interrupted)).toHaveLength(0);
  });

  it('keeps the summary while files are missing, counts a partial re-pick, and is dismissed on request', async () => {
    const { session, queueStore } = await setup();
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
    // Its staged copy is gone, the other never got there: neither is failed, both are missing.
    expect(await resumeImports({ session, previewRenderer: renderer, queueStore, staging: new MemoryStagingStore() })).toBeNull();
    const summary = await readInterruptedImports(queueStore, session.libraryId, session.getView());
    expect(summary?.missing.map((f) => f.fileName)).toEqual(['gone.jpg', 'early.jpg']);
    expect(summary?.total).toBe(3);
    await dismissInterruptedImports(queueStore, session.libraryId);
    expect(await readInterruptedImports(queueStore, session.libraryId, session.getView())).toBeNull();
    expect(queueStore.jobs.size).toBe(0);
  });

  it('a re-import of a partly imported set without any record duplicates nothing and fails nothing', async () => {
    const { session, queueStore, originalsOf } = await setup();
    const files = Array.from({ length: 5 }, (_, i) => photo(`IMG_${i}.JPG`, i));
    await startImport(files.slice(0, 3), { session, previewRenderer: renderer, now: () => DAY, queueStore }).finished;
    const chosen = files.map(again);
    const result = await startImport(chosen, { session, previewRenderer: renderer, now: () => DAY, queueStore }).finished;
    expect(result.items.map((i) => i.state)).toEqual(['duplicate', 'duplicate', 'duplicate', 'done', 'done']);
    expect(session.getView().assets.size).toBe(5);
    expect(originalsOf()).toHaveLength(5);
    // Without a record, the duplicate check has to read and hash each file.
    expect(chosen.slice(0, 3).every((f) => f.reads >= 1)).toBe(true);
  });
});
