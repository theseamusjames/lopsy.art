import { describe, expect, it, vi } from 'vitest';
import { StorageError } from '../storage/errors';
import { InProcessImportLocks } from './claim-locks';
import { DEFAULT_LEASE_MS, resumeImports, startImport } from './importer';
import type { ImportContext } from './importer';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg, buildTiff } from './test-support/builders';
import { FakeLibrarySession } from './test-support/fake-session';
import { TestMemoryAdapter } from './test-support/memory-adapter';
import type { PreviewRenderer } from './types';

const DAY = new Date(2026, 10, 18, 12);
const LATER = () => new Date(DAY.getTime() + DEFAULT_LEASE_MS + 1_000);

function jpegFile(name: string, seed: number): File {
  const exif = buildTiff({
    entries: [{ tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: '2026:11:14 16:02:11' }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] }],
  });
  return new File([buildJpeg({ width: 600 + seed, height: 400, exif })], name, { lastModified: DAY.getTime() });
}

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob(['p'], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
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
    retryDelaysMs: [0, 0, 0],
    ...extra,
  });
  const originals_ = () => [...adapter.files.values()].map((e) => e.file).filter((f) => !f.trashed && f.properties['lp.role'] === 'original');
  return { adapter, session, queueStore, staging, ctx, originals: originals_ };
}

const network = () => new StorageError('network', 'Connection dropped');

describe('import integrity', () => {
  it('retries a dropped connection and keeps the staged copy until the asset is added', async () => {
    const { adapter, session, staging, ctx } = await setup();
    let failures = 0;
    const stagedDuringRetry: number[] = [];
    adapter.hooks.failCreate = (file) => {
      if (file.properties?.['lp.role'] !== 'original' || failures >= 2) return null;
      failures++;
      void staging.list().then((keys) => stagedDuringRetry.push(keys.length));
      return network();
    };
    const result = await startImport([jpegFile('A.JPG', 1)], ctx()).finished;
    expect(result.items[0]?.state).toBe('done');
    expect(stagedDuringRetry).toEqual([1, 1]);
    expect(session.getView().assets.size).toBe(1);
    expect(await staging.list()).toEqual([]);
  });

  it('waits after the last retry, keeping the staged copy and the queue, and a resume finishes it', async () => {
    const { adapter, session, queueStore, staging, ctx, originals } = await setup();
    adapter.hooks.failCreate = (file) => (file.properties?.['lp.role'] === 'original' ? network() : null);
    const result = await startImport([jpegFile('B.JPG', 2)], ctx()).finished;
    expect(result.items[0]).toMatchObject({ state: 'queued', error: 'Waiting to retry: Connection dropped' });
    expect(await staging.list()).toHaveLength(1);
    const record = [...queueStore.jobs.values()][0];
    expect(record?.items[0]?.state).toBe('queued');
    expect(record?.owner).toBeNull();

    adapter.hooks = {};
    const resumed = await resumeImports({ session, previewRenderer: renderer, queueStore, staging });
    expect((await resumed?.finished)?.items.map((i) => i.state)).toEqual(['done']);
    expect(session.getView().assets.size).toBe(1);
    expect(originals()).toHaveLength(1);
    expect(await staging.list()).toEqual([]);
    expect(queueStore.jobs.size).toBe(0);
  });

  /** A file whose bytes are read only once `gate` resolves. */
  function gatedFile(file: File, gate: Promise<void>): File {
    return new (class extends File {
      override async arrayBuffer(): Promise<ArrayBuffer> {
        await gate;
        return super.arrayBuffer();
      }
    })([file], file.name, { lastModified: file.lastModified });
  }

  /** The import of C and D, where C cannot be added to the library, then a resume once it can. */
  async function pauseThenResume(order: 'D staged before the pause' | 'D read after the pause') {
    const { adapter, session, queueStore, staging, ctx, originals } = await setup();
    const addAsset = session.addAsset.bind(session);
    let readOnly = true;
    session.addAsset = (asset) => {
      if (readOnly) throw new Error('Another tab took over this library');
      return addAsset(asset);
    };
    let releaseD = () => {};
    const dGate = new Promise<void>((resolve) => (releaseD = resolve));
    let d = jpegFile('D.JPG', 4);
    if (order === 'D staged before the pause') {
      // C's original is stored only once D is staged.
      adapter.hooks.createDelay = (file) =>
        file.properties?.['lp.role'] === 'original' ? vi.waitFor(async () => expect(await staging.list()).toHaveLength(2)) : null;
    } else {
      // D's bytes are read only once C has paused the job.
      d = gatedFile(d, dGate);
    }
    const job = startImport([jpegFile('C.JPG', 3), d], ctx({ options: { concurrency: 1 } }));
    const unsubscribe = job.subscribe(() => {
      if (job.getProgress().items[0]?.error?.startsWith('Paused:')) releaseD();
    });
    const result = await job.finished;
    unsubscribe();
    adapter.hooks = {};
    expect(result.items.map((i) => [i.state, i.error])).toEqual([
      ['queued', 'Paused: the library could not be updated (Another tab took over this library)'],
      ['queued', 'Paused: the library could not be updated (Another tab took over this library)'],
    ]);
    // Both are staged, D too when it was read after the pause; only C's original reached storage.
    expect(await staging.list()).toHaveLength(2);
    expect(originals()).toHaveLength(1);

    readOnly = false;
    const resumed = await resumeImports({ session, previewRenderer: renderer, queueStore, staging, now: () => DAY });
    expect((await resumed?.finished)?.items.map((i) => i.state)).toEqual(['done', 'done']);
    expect(session.getView().assets.size).toBe(2);
    expect(originals()).toHaveLength(2);
    expect(await staging.list()).toEqual([]);
  }

  it('pauses, keeping everything staged, when the library cannot be written', async () => {
    await pauseThenResume('D staged before the pause');
  });

  it('stages an item it reads after such a pause, so the resume finishes it', async () => {
    await pauseThenResume('D read after the pause');
  });

  it('leaves a job with a fresh lease alone, and stages equal files separately', async () => {
    const { adapter, session, queueStore, staging, ctx } = await setup();
    adapter.hooks.createDelay = (file) => (file.properties?.['lp.role'] === 'original' ? new Promise<void>(() => {}) : null);
    const twin = jpegFile('E.JPG', 5);
    const running = startImport([twin, new File([twin], 'E copy.JPG')], ctx({ options: { skipDuplicates: false } }));
    await vi.waitFor(() => expect(running.getProgress().items.map((i) => i.state)).toEqual(['uploading', 'uploading']));
    expect(await staging.list()).toHaveLength(2);
    expect([...queueStore.jobs.values()][0]?.owner).toBeTruthy();

    // Another tab without Web Locks, while this one runs: nothing to take over.
    const tab2 = { session, previewRenderer: renderer, queueStore, staging, ownerId: 'tab-2', locks: new InProcessImportLocks() };
    expect(await resumeImports({ ...tab2, now: () => DAY })).toBeNull();
    // Once the heartbeat is older than the lease, it is taken over.
    adapter.hooks = {};
    const takeover = await resumeImports({ ...tab2, now: LATER });
    const result = await takeover?.finished;
    expect(result?.items.map((i) => i.state)).toEqual(['done', 'done']);
    expect(session.getView().assets.size).toBe(2);
  });

  it('lets only one of two overlapping resumes claim the parked items', async () => {
    const { adapter, session, queueStore, staging, ctx, originals } = await setup();
    adapter.hooks.failCreate = (f) => (f.properties?.['lp.role'] === 'original' ? network() : null);
    await startImport([jpegFile('B.JPG', 2)], ctx()).finished;
    adapter.hooks = {};
    const r = { session, previewRenderer: renderer, queueStore, staging };
    const [a, b] = await Promise.all([resumeImports({ ...r, ownerId: 'tab-1' }), resumeImports({ ...r, ownerId: 'tab-2' })]);
    await Promise.all([a?.finished, b?.finished]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(originals()).toHaveLength(1);
    expect(session.getView().assets.size).toBe(1);
    expect(queueStore.jobs.size).toBe(0);
  });

  it('lets only one tab claim when two claim the same job at once', async () => {
    const { adapter, session, queueStore, staging, ctx, originals } = await setup();
    adapter.hooks.failCreate = (f) => (f.properties?.['lp.role'] === 'original' ? network() : null);
    await startImport([jpegFile('B.JPG', 2)], ctx()).finished;
    adapter.hooks = {};
    // Two tabs without Web Locks: both list the job and take their own lock; the queue's swap decides.
    const r = { session, previewRenderer: renderer, queueStore, staging };
    const [a, b] = await Promise.all([
      resumeImports({ ...r, ownerId: 'tab-1', locks: new InProcessImportLocks() }),
      resumeImports({ ...r, ownerId: 'tab-2', locks: new InProcessImportLocks() }),
    ]);
    await Promise.all([a?.finished, b?.finished]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(originals()).toHaveLength(1);
  });

  it('never takes over a job whose tab holds its lock, however old its heartbeat', async () => {
    const { adapter, session, queueStore, staging, ctx } = await setup();
    let releaseUpload: () => void = () => {};
    const held = new Promise<void>((r) => (releaseUpload = r));
    adapter.hooks.createDelay = (file) => (file.properties?.['lp.role'] === 'original' ? held : null);
    // Stands in for Web Locks: one lock space shared by both tabs.
    const webLocks = new InProcessImportLocks({ acrossTabs: true });
    const running = startImport([jpegFile('G.JPG', 7)], ctx({ locks: webLocks }));
    await vi.waitFor(() => expect(running.getProgress().items[0]?.state).toBe('uploading'));
    const tab2 = { session, previewRenderer: renderer, queueStore, staging, ownerId: 'tab-2', locks: webLocks };
    expect(await resumeImports({ ...tab2, now: LATER })).toBeNull();
    releaseUpload();
    expect((await running.finished).items[0]?.state).toBe('done');
    expect(await resumeImports({ ...tab2, now: LATER })).toBeNull();
    expect(session.getView().assets.size).toBe(1);
  });

  it('keeps the lease of a hidden tab whose timers run once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(DAY);
      const { adapter, session, queueStore, staging, ctx } = await setup();
      adapter.hooks.createDelay = (file) => (file.properties?.['lp.role'] === 'original' ? new Promise<void>(() => {}) : null);
      const running = startImport([jpegFile('H.JPG', 8)], ctx({ now: undefined }));
      await vi.waitFor(() => expect(running.getProgress().items[0]?.state).toBe('uploading'));
      const tab2 = { session, previewRenderer: renderer, queueStore, staging, ownerId: 'tab-2', locks: new InProcessImportLocks() };
      // Hidden: a minute passes between heartbeats, and the lease outlasts it.
      for (let minute = 0; minute < 3; minute++) {
        vi.setSystemTime(Date.now() + 60_000);
        expect(await resumeImports(tab2)).toBeNull();
        await vi.advanceTimersByTimeAsync(10_000);
      }
      // The tab is gone: no heartbeat (no timer runs) for longer than the lease, and another tab takes over.
      vi.setSystemTime(Date.now() + DEFAULT_LEASE_MS + 1_000);
      adapter.hooks = {};
      const takeover = await resumeImports(tab2);
      expect((await takeover?.finished)?.items[0]?.state).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not accept a stale resumed upload belonging to another asset', async () => {
    const { adapter, session, ctx, originals } = await setup();
    const root = await adapter.getRoot();
    const stale = await adapter.createFile(
      { parentId: root.id, name: 'old.JPG', mimeType: 'image/jpeg', properties: { 'lp.role': 'original', 'lp.asset': 'someone-else' } },
      new Blob(['old']),
    );
    await adapter.trash(stale.id);
    const staleFile = await adapter.getFile(stale.id);
    adapter.hooks.resumedFile = () => staleFile;
    const result = await startImport([jpegFile('F.JPG', 6)], ctx({ queueStore: undefined, staging: undefined })).finished;
    expect(result.items[0]?.state).toBe('done');
    const asset = session.getView().assets.get(result.items[0]?.assetId ?? '');
    expect(asset?.fileId).not.toBe(stale.id);
    expect((await adapter.getFile(asset?.fileId ?? ''))?.properties['lp.asset']).toBe(asset?.id);
    expect(originals()).toHaveLength(1);
  });
});
