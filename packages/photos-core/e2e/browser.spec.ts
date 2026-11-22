/**
 * The browser-only parts of photos-core, run for real in Chromium through
 * the Vite-served harness page (harness/main.ts).
 */

import { expect, test, type Page } from '@playwright/test';
import { gisStubInitScript, routeFakeDrive } from '../src/storage/google-drive/playwright-fake-drive';
import type { Harness } from './harness/main';

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('ready');
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('#status')).toHaveText('ready');
}

async function call<K extends keyof Harness>(page: Page, name: K, ...args: Parameters<Harness[K]>): Promise<Awaited<ReturnType<Harness[K]>>> {
  const result: unknown = await page.evaluate(
    async ({ name: method, args: params }) => {
      const harness = Reflect.get(window, 'harness') as Record<string, (...values: unknown[]) => unknown>;
      const fn = harness[method];
      if (!fn) throw new Error(`No harness method ${method}`);
      return fn(...params);
    },
    { name: String(name), args: [...args] as unknown[] },
  );
  return result as Awaited<ReturnType<Harness[K]>>;
}

test('IndexedDbLocalStore applies patches atomically and keeps them across a reload', async ({ page }) => {
  await open(page);
  expect(await call(page, 'localStoreWrite', 'harness-store', 'lib-1')).toEqual({ failedPatch: 'DataCloneError' });
  await reload(page);
  expect(await call(page, 'localStoreLoad', 'harness-store', 'lib-1')).toEqual({ deviceId: 'dev1', nextSeq: 4, outboxSeqs: [2, 3] });
  expect(await call(page, 'localStoreLoad', 'harness-store', 'other')).toBeNull();
});

test('WebLocksLibraryLock reports busy and lets a second tab take over', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await open(first);
  await open(second);
  expect(await call(first, 'acquireLock', 'photonamous:lib', false)).toBe('granted');
  expect(await call(second, 'acquireLock', 'photonamous:lib', false)).toBe('busy');
  expect(await call(second, 'acquireLock', 'photonamous:lib', true)).toBe('granted');
  await expect.poll(() => call(first, 'lockLost', 'photonamous:lib')).toBe(true);
  expect(await call(second, 'lockLost', 'photonamous:lib')).toBe(false);
  await call(second, 'releaseLock', 'photonamous:lib');
  expect(await call(first, 'acquireLock', 'photonamous:lib', false)).toBe('granted');
});

test('LocalFolderAdapter works on real OPFS and persists across a reload', async ({ page }) => {
  await open(page);
  await call(page, 'resetOpfs');
  const created = await call(page, 'opfsCreate');
  expect(created.kind).toBe('browser');
  expect(created.changed).toEqual(expect.arrayContaining([created.folderId, created.fileId, created.trashedId]));
  await reload(page);
  expect(await call(page, 'opfsRead', created.folderId, created.fileId, created.trashedId)).toEqual({
    text: 'raw bytes',
    range: 'bytes',
    children: ['DSCF1.RAF'],
    trashed: true,
    found: 1,
    onDisk: ['DSCF1.RAF', 'raw bytes'],
  });
});

test('OpfsBlobCache evicts least recently used and survives a reload', async ({ page }) => {
  await open(page);
  await call(page, 'resetOpfs');
  expect(await call(page, 'blobCacheFill')).toEqual({ usage: 30, b: false });
  await reload(page);
  expect(await call(page, 'blobCacheReopen')).toEqual({ usage: 10, present: ['a', 'c', 'd'] });
});

test('GoogleTokenSource uses the GIS stub, asks only for Drive files and reads the account from Drive', async ({ page }) => {
  await routeFakeDrive(page);
  await page.addInitScript(gisStubInitScript('test-token'));
  await open(page);
  expect(await call(page, 'gisToken')).toEqual({
    interactive: 'test-token',
    silent: 'test-token',
    accountId: '01234567890123456789',
    scope: 'https://www.googleapis.com/auth/drive.file',
  });
});

test('a resumable upload continues after a reload mid-upload, and reads stream progress', async ({ page }) => {
  const drive = await routeFakeDrive(page);
  await open(page);
  const size = 1024 * 1024;
  await call(page, 'startUpload', size);
  await reload(page);
  const result = await call(page, 'resumeUpload', size);
  expect(result.sha).toBe(result.expectedSha);
  expect(result.firstProgress).toBeGreaterThanOrEqual(256 * 1024);
  expect(result.storeEmpty).toBe(true);
  const initiations = drive.requests.filter((request) => request.method === 'POST' && request.url.searchParams.get('uploadType') === 'resumable');
  expect(initiations).toHaveLength(1);
  expect(drive.requests.some((request) => request.headers.get('content-range') === `bytes */${size}`)).toBe(true);
  expect(drive.contentOf(result.fileId)?.length).toBe(size);

  const read = await call(page, 'readWithProgress', result.fileId);
  expect(read.size).toBe(size);
  expect(read.last).toEqual([size, size]);
  expect(read.calls).toBeGreaterThan(1);
});

test('two devices on one Drive converge after syncNow', async ({ context }) => {
  await routeFakeDrive(context);
  const a = await context.newPage();
  const b = await context.newPage();
  await open(a);
  await open(b);
  const libraryA = await call(a, 'openDevice', 'a');
  const one = await call(a, 'addAsset', 'a', 'one.jpg');
  await call(a, 'syncNow', 'a');

  expect(await call(b, 'openDevice', 'b')).toBe(libraryA);
  await call(b, 'syncNow', 'b');
  expect(await call(b, 'view', 'b')).toEqual([{ name: 'one.jpg', rating: 0 }]);

  await call(b, 'setRating', 'b', one, 4);
  await call(b, 'addAsset', 'b', 'two.jpg');
  await call(b, 'syncNow', 'b');
  await call(a, 'syncNow', 'a');
  const expected = [
    { name: 'one.jpg', rating: 4 },
    { name: 'two.jpg', rating: 0 },
  ];
  expect(await call(a, 'view', 'a')).toEqual(expected);
  expect(await call(b, 'view', 'b')).toEqual(expected);
});
