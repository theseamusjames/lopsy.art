/**
 * Reading from Drive with no usable Google token, on the fake Drive through
 * the real adapter and token source, with the clock in the test's hands.
 * The owner's sequence: a library on Drive, left past 45 minutes and past
 * the hour; a click whose silent renewal opens a window that never answers;
 * then the single view's full-size picture (the screen preview) and the
 * Edit view's original.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBlobCache } from '../cache/blob-cache';
import { OriginalsCache } from '../cache/originals-cache';
import { PreviewCache } from '../cache/preview-cache';
import { startImportFromStorage } from '../import/from-storage';
import { startImport } from '../import/importer';
import { buildJpeg } from '../import/test-support/builders';
import { driveImportHarness, removeGis, type DriveImportHarness } from '../import/test-support/drive-import';
import type { PreviewRenderer } from '../import/types';
import { withSignIn } from './sign-in-wait';
import { StorageError } from '../storage/errors';

const MINUTE = 60_000;

const renderer: PreviewRenderer = {
  async render(_source, maxSize) {
    return { blob: new Blob([`p${maxSize}`], { type: 'image/jpeg' }), width: maxSize, height: maxSize };
  },
};

/** A library on Drive with one photo, its previews and original in Drive and nothing on this device. */
async function libraryWithAPhoto(): Promise<{ h: DriveImportHarness; fileId: string; sha256: string; byteSize: number; screenId: string }> {
  const h = await driveImportHarness();
  const file = new File([buildJpeg({ width: 640, height: 480 }), new Uint8Array(3000).fill(7)], 'DSCF0001.JPG');
  await startImport([file], { session: h.session, previewRenderer: renderer, now: () => new Date(h.now()) }).finished;
  const asset = [...h.session.getView().assets.values()][0];
  const screen = asset ? h.session.getView().versions.get(asset.primaryVersionId)?.screen : null;
  if (!asset || !screen) throw new Error('no photo');
  return { h, fileId: asset.fileId, sha256: asset.sha256, byteSize: asset.byteSize, screenId: screen.fileId };
}

/** Whether a promise has settled within a moment of real time. */
async function settledSoon(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  return settled;
}

afterEach(removeGis);

describe('his sequence', () => {
  it('past 45 minutes, a click whose window never answers holds nothing: the picture and the original load', async () => {
    const { h, fileId, sha256, byteSize, screenId } = await libraryWithAPhoto();
    h.answer = (prompt) => (prompt === 'none' ? 'never' : 'grant');
    h.advance(46 * MINUTE);
    // The click on a photo: Google's window flashes and never answers.
    expect(await h.tokens.refreshOnGesture()).toBe(false);
    // Back in the token's last minutes, where main's own silent try joined that window and every read waited for good.
    h.advance(10 * MINUTE);
    const screen = await new PreviewCache(new MemoryBlobCache()).readPreview(h.adapter, screenId);
    expect(screen.size).toBeGreaterThan(0);
    const progress: number[] = [];
    const original = await new OriginalsCache(new MemoryBlobCache()).readOriginal(h.adapter, { fileId, sha256, byteSize }, { onProgress: (b) => progress.push(b) });
    expect(original.size).toBe(byteSize);
    expect(progress.at(-1)).toBe(byteSize);
    // No window of its own, and Reconnect is offered: clicks will not renew here.
    expect(h.prompts).toEqual(['consent', 'none']);
    expect(h.tokens.signInState()).toBe('renew');
  });

  it('past the hour, the picture and the original wait for Reconnect, say so, and load once it is done', async () => {
    const { h, fileId, sha256, byteSize, screenId } = await libraryWithAPhoto();
    h.advance(61 * MINUTE);
    const states: string[] = [];
    h.tokens.subscribeSignIn(() => states.push(h.tokens.signInState()));
    const picture = withSignIn(h.tokens, () => new PreviewCache(new MemoryBlobCache()).readPreview(h.adapter, screenId));
    let bytes = 0;
    const original = withSignIn(h.tokens, () =>
      new OriginalsCache(new MemoryBlobCache()).readOriginal(h.adapter, { fileId, sha256, byteSize }, { onProgress: (b) => (bytes = b) }),
    );
    // Waiting, not failed, and the sign-in says it needs the person.
    expect(await settledSoon(picture)).toBe(false);
    expect(await settledSoon(original)).toBe(false);
    expect(h.tokens.signInState()).toBe('needed');
    expect(bytes).toBe(0);
    // Hours later, still waiting.
    h.advance(5 * 60 * MINUTE);
    expect(await settledSoon(original)).toBe(false);
    // One Reconnect serves both.
    await h.tokens.requestInteractive();
    expect((await picture).size).toBeGreaterThan(0);
    expect((await original).size).toBe(byteSize);
    expect(bytes).toBe(byteSize);
    expect(states).toEqual(['needed', 'ok']);
    expect(h.prompts).toEqual(['consent', '']);
  });
});

describe('every read waits for sign-in the same way', () => {
  it('a 401 before the hour is up: the read waits for a token, then goes on', async () => {
    const { h, fileId } = await libraryWithAPhoto();
    h.expireAll();
    const read = withSignIn(h.tokens, () => h.adapter.readContent(fileId));
    expect(await settledSoon(read)).toBe(false);
    expect(h.tokens.signInState()).toBe('needed');
    await h.tokens.requestInteractive();
    expect((await read).size).toBeGreaterThan(0);
  });

  it('a wait ends when its view closes, as aborted, not failed', async () => {
    const { h, fileId } = await libraryWithAPhoto();
    h.advance(61 * MINUTE);
    const closed = new AbortController();
    const read = withSignIn(h.tokens, () => h.adapter.readContent(fileId, { signal: closed.signal }), { signal: closed.signal });
    expect(await settledSoon(read)).toBe(false);
    closed.abort();
    await expect(read).rejects.toMatchObject({ code: 'aborted' });
  });

  it('a token that came while the read ran is not waited for again', async () => {
    const { h, fileId } = await libraryWithAPhoto();
    h.advance(61 * MINUTE);
    let runs = 0;
    const read = withSignIn(h.tokens, async () => {
      runs++;
      if (runs === 1) {
        // Refused, but Reconnect was done meanwhile (another view's button): no wait, the read runs again at once.
        await h.tokens.requestInteractive();
        throw new StorageError('auth', 'Google Drive needs reconnecting');
      }
      return h.adapter.readContent(fileId);
    });
    expect((await read).size).toBeGreaterThan(0);
    expect(runs).toBe(2);
    expect(h.tokens.signInState()).toBe('ok');
  });

  it('an error that is not about sign-in is the work’s own', async () => {
    const { h } = await libraryWithAPhoto();
    await expect(withSignIn(h.tokens, () => h.adapter.readContent('no-such-file'))).rejects.toMatchObject({ code: 'not-found' });
  });

  it('Add from Google Drive waits for sign-in instead of failing the file, then adds it', async () => {
    const h = await driveImportHarness();
    const id = h.drive.seedFile({ name: 'picked.jpg', mimeType: 'image/jpeg', content: buildJpeg({ width: 500, height: 300 }) });
    h.advance(61 * MINUTE);
    const job = startImportFromStorage([id], { session: h.session, previewRenderer: renderer, now: () => new Date(h.now()), signIn: h.tokens });
    await vi.waitFor(() => expect(job.getProgress().needsSignIn).toBe(true));
    expect(job.getProgress().items.some((i) => i.state === 'failed')).toBe(false);
    expect(h.tokens.signInState()).toBe('needed');
    await h.tokens.requestInteractive();
    const result = await job.finished;
    expect(result.items.map((i) => [i.state, i.error])).toEqual([['done', null]]);
    expect(result.needsSignIn).toBe(false);
    expect(h.session.getView().assets.size).toBe(1);
  });
});
