/**
 * An import that outlives Google's token (an hour, renewed only through
 * Google's window from a click). On the fake Drive through the real
 * adapter and token source, with the clock in the test's hands: every
 * photo finished moves it on, as a long import does.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from './hash';
import { startImport } from './importer';
import type { ImportContext } from './importer';
import { MemoryImportQueueStore } from './queue-store';
import { MemoryStagingStore } from './staging';
import { buildJpeg, buildTiff } from './test-support/builders';
import { driveImportHarness, removeGis, type DriveImportHarness } from './test-support/drive-import';
import type { ImportJob, PreviewRenderer } from './types';

const MINUTE = 60_000;

function jpegFile(name: string, seed: number, padding = 0): File {
  const exif = buildTiff({
    entries: [{ tag: 0x8769, ifds: [{ entries: [{ tag: 0x9003, ascii: '2026:11:14 16:02:11' }, { tag: 0x8827, type: 3, values: [100 + seed] }] }] }],
  });
  const parts: BlobPart[] = [buildJpeg({ width: 600 + seed, height: 400, exif })];
  if (padding > 0) parts.push(new Uint8Array(padding).fill(seed));
  return new File(parts, name, { lastModified: 1_700_000_000_000 + seed });
}

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob([`p${maxSize}`], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

function files(count: number, padding = 0): File[] {
  return Array.from({ length: count }, (_, i) => jpegFile(`IMG_${String(i).padStart(4, '0')}.JPG`, i, padding));
}

function context(h: DriveImportHarness, extra: Partial<ImportContext> = {}): ImportContext {
  return {
    session: h.session,
    previewRenderer: renderer,
    now: () => new Date(h.now()),
    queueStore: new MemoryImportQueueStore(),
    staging: new MemoryStagingStore(),
    retryDelaysMs: [1, 1, 1, 1, 1],
    authorization: h.tokens,
    ...extra,
  };
}

/** Every photo the importer finished moves the clock on `minutes`; `click` is the person clicking meanwhile. */
function everyPhoto(job: ImportJob, h: DriveImportHarness, minutes: number, click: boolean): void {
  let done = 0;
  job.subscribe(() => {
    const now = job.getProgress().items.filter((i) => i.state === 'done').length;
    for (; done < now; done++) {
      h.advance(minutes * MINUTE);
      if (click) void h.tokens.refreshOnGesture();
    }
  });
}

/** Each file is in Drive once, with its own bytes, and in the library once. */
async function expectEachOnce(h: DriveImportHarness, imported: readonly File[]): Promise<void> {
  const originals = (await h.adapter.findByProperty('lp.role', 'original')).filter((f) => !f.trashed);
  const shas = await Promise.all(imported.map((f) => sha256Hex(f)));
  expect(originals.map((f) => f.sha256).sort()).toEqual([...shas].sort());
  const assets = [...h.session.getView().assets.values()];
  expect(assets.map((a) => a.sha256).sort()).toEqual([...shas].sort());
}

async function waitForSignInNeeded(job: ImportJob): Promise<void> {
  await vi.waitFor(() => expect(job.getProgress().needsSignIn).toBe(true), { timeout: 5000 });
}

afterEach(removeGis);

describe('an import that outlives the Google token', () => {
  it('carries on through a renewal from clicks, every file once', async () => {
    const h = await driveImportHarness();
    const batch = files(40);
    const job = startImport(batch, context(h));
    everyPhoto(job, h, 2, true);
    const result = await job.finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual(batch.map(() => ['done', null]));
    expect(h.prompts).toContain('none');
    await expectEachOnce(h, batch);
  });

  it('does not stall when the silent renewal never answers: it waits for sign-in, then carries on', async () => {
    const h = await driveImportHarness();
    // Google's window opens from each click and never reports back. Before, the first such window held
    // every request behind it: in the token's last five minutes each Drive call waited on it for good.
    h.answer = () => 'never';
    const batch = files(80);
    const job = startImport(batch, context(h));
    everyPhoto(job, h, 1, true);
    await waitForSignInNeeded(job);
    expect(h.prompts.slice(1)).toContain('none');
    const waiting = job.getProgress();
    expect(waiting.finished).toBe(false);
    expect(waiting.items.filter((i) => i.state === 'failed' || i.error !== null)).toEqual([]);
    // The strip's Reconnect: Google's window from the click, answered this time.
    h.answer = () => 'grant';
    await h.tokens.requestInteractive();
    const result = await job.finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual(batch.map(() => ['done', null]));
    expect(result.needsSignIn).toBe(false);
    await expectEachOnce(h, batch);
  });

  it('waits, however long, when no token can be had, and resumes when one arrives', async () => {
    const h = await driveImportHarness();
    const batch = files(20);
    const job = startImport(batch, context(h));
    everyPhoto(job, h, 6, false);
    await waitForSignInNeeded(job);
    // Hours later, nothing has failed and the job still waits.
    h.advance(5 * 60 * MINUTE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const waiting = job.getProgress();
    expect(waiting.finished).toBe(false);
    expect(waiting.needsSignIn).toBe(true);
    expect(waiting.items.some((i) => i.state === 'failed' || i.state === 'queued' && i.error !== null)).toBe(false);
    const done = waiting.items.filter((i) => i.state === 'done').length;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(20);
    // A token from elsewhere (the header's Reconnect) is enough: the job hears of it.
    await h.tokens.requestInteractive();
    const result = await job.finished;
    expect(result.items.map((i) => i.state)).toEqual(batch.map(() => 'done'));
    await expectEachOnce(h, batch);
  });

  it('retries a file refused with 401 before its hour is up', async () => {
    const h = await driveImportHarness();
    const batch = files(10);
    const job = startImport(batch, context(h));
    let expired = false;
    job.subscribe(() => {
      if (!expired && job.getProgress().items.some((i) => i.state === 'done')) {
        expired = true;
        h.expireAll();
      }
    });
    await waitForSignInNeeded(job);
    expect(job.getProgress().items.some((i) => i.state === 'failed')).toBe(false);
    await h.tokens.requestInteractive();
    const result = await job.finished;
    expect(result.items.map((i) => i.state)).toEqual(batch.map(() => 'done'));
    await expectEachOnce(h, batch);
  });

  it('continues a resumable upload refused mid-way from where Drive has it', async () => {
    const KIB = 1024;
    const h = await driveImportHarness({ chunkSize: 256 * KIB, resumableThreshold: 256 * KIB });
    const batch = files(1, 900 * KIB);
    const ranges: string[] = [];
    let chunks = 0;
    h.beforeFetch = (request) => {
      if (request.method !== 'PUT' || !new URL(request.url).searchParams.has('upload_id')) return;
      ranges.push(request.headers.get('Content-Range') ?? '');
      // The token runs out after the second chunk is in.
      if (++chunks === 3) h.expireAll();
    };
    const job = startImport(batch, context(h, { options: { concurrency: 1 } }));
    await waitForSignInNeeded(job);
    const sent = ranges.length;
    await h.tokens.requestInteractive();
    const result = await job.finished;
    expect(result.items.map((i) => i.state)).toEqual(['done']);
    // After the new token: Drive is asked where it stands, then the rest goes up; the first 512 KiB are not sent again.
    const after = ranges.slice(sent);
    expect(after[0]).toMatch(/^bytes \*\//);
    expect(after.slice(1).every((r) => !r.startsWith('bytes 0-'))).toBe(true);
    await expectEachOnce(h, batch);
  });

  it('a pause while waiting for sign-in stops the job, with nothing failed', async () => {
    const h = await driveImportHarness();
    const batch = files(6);
    const job = startImport(batch, context(h));
    h.expireAll();
    await waitForSignInNeeded(job);
    job.pause();
    const result = await job.finished;
    expect(result.items.every((i) => i.state === 'queued' && i.error === 'Paused')).toBe(true);
    expect(result.needsSignIn).toBe(false);
  });
});
