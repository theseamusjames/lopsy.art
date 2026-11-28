import { writeFile } from 'node:fs/promises';
import type { Route } from '@playwright/test';
import { BLOB_BODY_SKIP, expect, test, type Page } from './test';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import type { FakeDrive } from '../../../packages/photos-core/src/storage/google-drive/fake-drive';
import { generatedJpeg, importStrip, tiles, toast } from './library';

/**
 * A long import outlives Google's token (an hour, renewed only through
 * Google's window from a click), and a reload interrupts one whose files
 * were never staged on this device. Against the fake Drive and the
 * sign-in stub, with the page's clock moved and uploads held back by the
 * test instead of real waiting.
 */

const MINUTE = 60_000;
const UPLOADS = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files/;
const SCREENSHOTS = process.env.PHOTONAMOUS_IMPORT_FIX_SHOTS;

test.skip(BLOB_BODY_SKIP.skip, BLOB_BODY_SKIP.reason);

/** Holds Drive uploads at a gate the test opens; `free` originals go through first. */
async function holdUploads(page: Page, free = 0): Promise<{ open: () => void }> {
  let opened = false;
  let waiters: (() => void)[] = [];
  let passed = 0;
  await page.context().route(UPLOADS, async (route: Route) => {
    const isOriginal = (route.request().postDataBuffer()?.toString('latin1') ?? '').includes('"lp.role":"original"');
    if (isOriginal && !opened && passed >= free) await new Promise<void>((resolve) => waiters.push(resolve));
    else if (isOriginal) passed++;
    await route.fallback().catch(() => undefined);
  });
  return {
    open: () => {
      opened = true;
      for (const w of waiters) w();
      waiters = [];
    },
  };
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
}

/** Photos on disk, so choosing them again gives the same name, size and modified time, as a person's files do. */
async function photosOnDisk(page: Page, count: number): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = test.info().outputPath(`DSCF${1000 + i}.jpg`);
    await writeFile(path, await generatedJpeg(page, (i * 47) % 360, 320, 240));
    paths.push(path);
  }
  return paths;
}

/** Import photos → Choose photos → the sheet's Import button; does not wait for the import. */
async function chooseAndImport(page: Page, paths: readonly string[], expected: number): Promise<void> {
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles([...paths]);
  await page.getByRole('button', { name: new RegExp(`^Import ${expected} photo`) }).click();
}

/** The originals in the fake Drive. */
async function originals(drive: FakeDrive): Promise<string[]> {
  drive.addToken('inspector');
  const q = encodeURIComponent("appProperties has { key='lp.role' and value='original' } and trashed=false");
  const res = await drive.fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`, {
    headers: { Authorization: 'Bearer inspector' },
  });
  const body = (await res.json()) as { files: { name: string }[] };
  return body.files.map((f) => f.name).sort();
}

async function prompts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stub: unknown = Reflect.get(window, '__lopsyGisStub');
    const requests: unknown = typeof stub === 'object' && stub !== null ? Reflect.get(stub, 'requests') : [];
    return Array.isArray(requests) ? requests.map((r: unknown) => String((typeof r === 'object' && r !== null && Reflect.get(r, 'prompt')) || '')) : [];
  });
}

/** Google's next token: what the stub grants from now on, and what the fake Drive accepts. */
async function nextToken(page: Page, drive: FakeDrive, token: string): Promise<void> {
  drive.addToken(token);
  await page.evaluate((value) => Reflect.set(Reflect.get(window, '__lopsyGisStub') as object, 'token', value), token);
}

test('an import that outlives the token carries on through a click’s renewal', async ({ page }) => {
  await page.clock.install();
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  const gate = await holdUploads(page);
  await signIn(page);
  const paths = await photosOnDisk(page, 4);
  await chooseAndImport(page, paths, 4);
  await expect(importStrip(page)).toContainText('Importing');

  // 46 minutes on, an ordinary click renews the token without showing anything.
  await nextToken(page, drive, 'token-2');
  await page.clock.setSystemTime(new Date(Date.now() + 46 * MINUTE));
  await page.getByRole('heading').first().click();
  await expect.poll(() => prompts(page)).toContain('none');
  // The first token's hour runs out; the uploads go on with the new one.
  drive.revokeToken('test-token');
  await page.clock.setSystemTime(new Date(Date.now() + 61 * MINUTE));
  gate.open();
  await expect(toast(page, /^Imported 4 photos/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(4);
  expect(await originals(drive)).toEqual(['DSCF1000.jpg', 'DSCF1001.jpg', 'DSCF1002.jpg', 'DSCF1003.jpg']);
});

test('an import whose token ran out waits for Reconnect, then finishes, nothing failed', async ({ page }) => {
  await page.clock.install();
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  const gate = await holdUploads(page);
  await signIn(page);
  const paths = await photosOnDisk(page, 4);
  await chooseAndImport(page, paths, 4);
  await expect(importStrip(page)).toContainText('Importing');

  // Nobody clicked: the hour is up.
  drive.revokeToken('test-token');
  await page.clock.setSystemTime(new Date(Date.now() + 61 * MINUTE));
  gate.open();
  const strip = importStrip(page);
  await expect(strip).toContainText('Reconnect to Google Drive to continue · 4 of 4 photos left', { timeout: 30_000 });
  await expect(strip).not.toContainText('could not be imported');
  await expect(page.getByRole('status').filter({ hasText: 'Import paused: reconnect to Google Drive to continue' })).toHaveCount(1);
  if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/paused-for-sign-in.png` });

  // Still waiting after a long while: a pause is not an error.
  await page.clock.runFor(5 * MINUTE);
  await expect(strip).toContainText('Reconnect to Google Drive to continue');

  // The strip's button is the click that opens Google's window.
  await nextToken(page, drive, 'token-2');
  await strip.getByRole('button', { name: 'Reconnect to Google Drive' }).click();
  await expect(toast(page, /^Imported 4 photos/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(4);
  expect(await originals(drive)).toEqual(['DSCF1000.jpg', 'DSCF1001.jpg', 'DSCF1002.jpg', 'DSCF1003.jpg']);
});

test('a reload mid-import: one summary, and choosing the same files again adds only the missing', async ({ page }) => {
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  // As in a browser whose storage quota is far smaller than the photos (Brave's is): nothing can be staged on this device.
  await page.addInitScript(() => {
    const storage = navigator.storage;
    const real = storage.estimate.bind(storage);
    storage.estimate = async () => {
      const estimate = await real();
      return { ...estimate, quota: (estimate.usage ?? 0) + 1024 };
    };
  });
  const gate = await holdUploads(page, 2);
  await signIn(page);
  const paths = await photosOnDisk(page, 6);
  await chooseAndImport(page, paths, 6);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });

  // The tab reloads with four files never staged here.
  await page.reload();
  gate.open();
  await page.getByRole('button', { name: 'Open your Google Drive library' }).click();
  const notice = page.getByRole('region', { name: 'Interrupted import' });
  await expect(notice).toContainText('An import was interrupted: 2 of 6 photos imported, 4 not', { timeout: 30_000 });
  await expect(page.getByText(/import the file again/)).toHaveCount(0);
  await notice.getByRole('button', { name: 'List the 4 photos not imported' }).click();
  await expect(notice.getByRole('list', { name: 'Photos not imported' }).getByRole('listitem')).toHaveCount(4);
  if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/interrupted-import.png` });

  // The remedy: the same six again.
  const chooser = page.waitForEvent('filechooser');
  await notice.getByRole('button', { name: 'Choose photos again…' }).click();
  await (await chooser).setFiles(paths);
  await expect(page.getByRole('note').filter({ hasText: '4 photos of these are what the interrupted import did not finish' })).toBeVisible();
  await page.getByRole('button', { name: /^Import 4 photos/ }).click();
  await expect(toast(page, /^Imported 4 photos, skipped 2 already in the library/)).toBeVisible({ timeout: 60_000 });
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(6);
  expect(await originals(drive)).toEqual(paths.map((p) => p.slice(p.lastIndexOf('/') + 1)).sort());
});
