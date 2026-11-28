/**
 * Stop, in each state a large import can be in, on the fake Drive through
 * the real adapter and token source. Stop ends the job at once (it does
 * not wait for the work in flight), marks what was not imported 'stopped'
 * (not failed), leaves in Drive only whole imported photos, frees staging
 * and the queue, and a reload never resumes it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { InProcessImportLocks } from './claim-locks';
import { resumeImports, startImport } from './importer';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg } from './test-support/builders';
import { driveImportHarness, removeGis, type DriveImportHarness } from './test-support/drive-import';
import type { ImportJob, PreviewRenderer } from './types';

const MINUTE = 60_000;
const KIB = 1024;
const never = new Promise<void>(() => {});
const renderer: PreviewRenderer = { render: async (_s, m) => ({ blob: new Blob([`p${m}`], { type: 'image/jpeg' }), width: m, height: m }) };

afterEach(removeGis);

function files(count: number, padding = 0): File[] {
  return Array.from({ length: count }, (_, i) => new File([buildJpeg({ width: 300 + i, height: 200 }), new Uint8Array(padding).fill(i)], `F${i}.JPG`));
}

const isOriginal = (request: Request) => request.url.includes('/upload/') && request.method === 'POST';

interface Run {
  readonly h: DriveImportHarness;
  readonly job: ImportJob;
  readonly queueStore: MemoryImportQueueStore;
  readonly staging: MemoryStagingStore;
}

async function start(options: { padding?: number; harness?: { chunkSize?: number; resumableThreshold?: number }; retry?: readonly number[]; before?: (h: DriveImportHarness, staging: MemoryStagingStore) => void } = {}): Promise<Run> {
  const h = await driveImportHarness(options.harness ?? {});
  const queueStore = new MemoryImportQueueStore();
  const staging = new MemoryStagingStore();
  options.before?.(h, staging);
  const job = startImport(files(8, options.padding ?? 0), {
    session: h.session,
    previewRenderer: renderer,
    now: () => new Date(h.now()),
    queueStore,
    staging,
    retryDelaysMs: options.retry ?? [1, 1, 1, 1, 1],
    authorization: h.tokens,
    options: { concurrency: 3 },
  });
  return { h, job, queueStore, staging };
}

/** Presses Stop: the strip changes at once, and the job has ended within a moment, whatever was in flight. */
async function stop(job: ImportJob): Promise<void> {
  const started = Date.now();
  job.cancel();
  const now = job.getProgress();
  expect(now.stopped).toBe(true);
  expect(now.items.some((i) => i.state === 'uploading' || i.state === 'staged' || i.state === 'queued' || i.state === 'reading')).toBe(false);
  const result = await job.finished;
  expect(Date.now() - started).toBeLessThan(200);
  expect(result.finished).toBe(true);
  expect(result.items.every((i) => i.state === 'done' || i.state === 'stopped')).toBe(true);
  expect(result.items.some((i) => i.state === 'failed' || i.error !== null && i.state === 'stopped')).toBe(false);
}

/** In Drive only whole imported photos; staging and the queue clean; a reload resumes nothing. */
async function expectCleanAfter({ h, queueStore, staging }: Run): Promise<void> {
  h.hold = () => null;
  await vi.waitFor(async () => {
    const originals = (await h.adapter.findByProperty('lp.role', 'original')).filter((f) => !f.trashed);
    const library = [...h.session.getView().assets.values()];
    expect(originals.map((f) => f.properties['lp.asset']).sort()).toEqual(library.map((a) => a.id).sort());
    expect(await staging.list()).toEqual([]);
    expect(queueStore.jobs.size).toBe(0);
  });
  const reloaded = await resumeImports({ session: h.session, previewRenderer: renderer, queueStore, staging, now: () => new Date(h.now() + 10 * MINUTE), locks: new InProcessImportLocks() });
  expect(reloaded).toBeNull();
}

describe('Stop', () => {
  it('while preparing (reading, hashing, staging ahead)', async () => {
    const run = await start({
      before: (_h, staging) => {
        const put = staging.put.bind(staging);
        staging.put = async (key, blob) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return put(key, blob);
        };
      },
    });
    await vi.waitFor(() => expect(run.job.getProgress().items.some((i) => i.state === 'reading')).toBe(true));
    await stop(run.job);
    expect(run.h.session.getView().assets.size).toBe(0);
    await expectCleanAfter(run);
  });

  it('while uploading: the uploads in flight are aborted', async () => {
    const run = await start({ before: (h) => (h.hold = (r) => (isOriginal(r) ? never : null)) });
    await vi.waitFor(() => expect(run.job.getProgress().items.filter((i) => i.state === 'uploading')).toHaveLength(3));
    await stop(run.job);
    expect(run.h.session.getView().assets.size).toBe(0);
    await expectCleanAfter(run);
  });

  it('while an upload Drive had taken as Stop was pressed: its original is trashed, not added', async () => {
    const run = await start({
      before: (h) => {
        h.hold = (r) => {
          if (!isOriginal(r)) return null;
          // Drive stores it; the answer never reaches the page.
          void h.drive.fetch(r.clone());
          return never;
        };
      },
    });
    await vi.waitFor(() => expect(run.job.getProgress().items.filter((i) => i.state === 'uploading')).toHaveLength(3));
    await stop(run.job);
    expect(run.h.session.getView().assets.size).toBe(0);
    await expectCleanAfter(run);
  });

  it('mid-way through a resumable upload: no file is left, and what was whole stays imported', async () => {
    const run = await start({
      padding: 700 * KIB,
      harness: { chunkSize: 256 * KIB, resumableThreshold: 256 * KIB },
      // Every upload is held at its second chunk.
      before: (h) => (h.hold = (r) => (r.method === 'PUT' && (r.headers.get('Content-Range') ?? '').startsWith(`bytes ${256 * KIB}-`) ? never : null)),
    });
    await vi.waitFor(() => expect(run.job.getProgress().items.some((i) => i.state === 'uploading' && i.sentBytes > 0)).toBe(true));
    await stop(run.job);
    await expectCleanAfter(run);
  });

  it('while writing previews: the photo is in the library and stays imported', async () => {
    const run = await start({
      before: (h) => (h.hold = (r) => (r.url.includes('/upload/') ? r.clone().text().then((t) => (t.includes('"lp.role":"preview"') ? never : undefined)) : null)),
    });
    await vi.waitFor(() => expect(run.h.session.getView().assets.size).toBeGreaterThan(0));
    await stop(run.job);
    const imported = run.job.getProgress().items.filter((i) => i.state === 'done').length;
    expect(imported).toBe(run.h.session.getView().assets.size);
    await expectCleanAfter(run);
  });

  it('while waiting to retry after an error ("Retrying in 60 s")', async () => {
    const run = await start({
      retry: [60_000],
      before: (h) => {
        for (let i = 0; i < 5; i++) h.drive.failNext({ type: 'status', status: 503, match: (r) => r.url.includes('/upload/') });
      },
    });
    await vi.waitFor(() => expect(run.job.getProgress().items.some((i) => (i.error ?? '').startsWith('Retrying in 60'))).toBe(true));
    await stop(run.job);
    await expectCleanAfter(run);
  });

  it('while waiting for sign-in: it ends at once, and what is left in Drive is cleared once there is a token', async () => {
    const run = await start({ before: (h) => h.advance(61 * MINUTE) });
    await vi.waitFor(() => expect(run.job.getProgress().needsSignIn).toBe(true));
    await stop(run.job);
    expect(run.job.getProgress().needsSignIn).toBe(false);
    // Drive cannot be reached without a token: the record stays, marked stopped, and a reload does not resume it.
    await vi.waitFor(async () => expect(await run.staging.list()).toEqual([]));
    const reloaded = await resumeImports({ session: run.h.session, previewRenderer: renderer, queueStore: run.queueStore, staging: run.staging, now: () => new Date(run.h.now()), locks: new InProcessImportLocks() });
    expect(reloaded).toBeNull();
    // A token: what was left is trashed and the record goes.
    await run.h.tokens.requestInteractive();
    await expectCleanAfter(run);
  });

  it('after Pause: the paused job is stopped, its staged copies freed, and it is not resumed', async () => {
    const run = await start({ before: (h) => (h.hold = (r) => (isOriginal(r) ? never : null)) });
    await vi.waitFor(() => expect(run.job.getProgress().items.filter((i) => i.state === 'uploading')).toHaveLength(3));
    run.job.pause();
    const paused = await run.job.finished;
    expect(paused.items.every((i) => i.state === 'queued' && i.error === 'Paused')).toBe(true);
    expect(paused.stopped).toBeUndefined();
    run.job.cancel();
    const stopped = run.job.getProgress();
    expect(stopped.stopped).toBe(true);
    expect(stopped.finished).toBe(true);
    expect(stopped.items.every((i) => i.state === 'stopped' && i.error === null)).toBe(true);
    await expectCleanAfter(run);
  });
});
