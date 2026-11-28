import { writeFile } from 'node:fs/promises';
import type { Route } from '@playwright/test';
import { BLOB_BODY_SKIP, expect, test, type Page } from './test';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import type { FakeDrive } from '../../../packages/photos-core/src/storage/google-drive/fake-drive';
import { generatedJpeg, importStrip, tiles } from './library';

/**
 * Stop on a large import to Drive: it shows at once, ends the import, and
 * leaves in Drive only the photos imported. Against the fake Drive with
 * uploads slowed by the test, and the sign-in stub.
 */

const MINUTE = 60_000;
const UPLOADS = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files/;

test.skip(BLOB_BODY_SKIP.skip, BLOB_BODY_SKIP.reason);

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
}

async function chooseAndImport(page: Page, count: number): Promise<void> {
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = test.info().outputPath(`S${String(i).padStart(3, '0')}.jpg`);
    await writeFile(path, await generatedJpeg(page, (i * 37) % 360, 160, 120));
    paths.push(path);
  }
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(paths);
  await page.getByRole('button', { name: new RegExp(`^Import ${count} photo`) }).click();
}

async function originalsInDrive(drive: FakeDrive): Promise<number> {
  drive.addToken('inspector');
  const q = encodeURIComponent("appProperties has { key='lp.role' and value='original' } and trashed=false");
  const res = await drive.fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1000`, { headers: { Authorization: 'Bearer inspector' } });
  return ((await res.json()) as { files: unknown[] }).files.length;
}

test('Stop mid-way through a large import: at once, the imported stay, nothing more arrives', async ({ page }) => {
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  // Every upload takes a while, as a large RAW does.
  await page.context().route(UPLOADS, async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fallback().catch(() => undefined);
  });
  await signIn(page);
  await chooseAndImport(page, 30);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect.poll(() => tiles(page).count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(4);

  const strip = importStrip(page);
  await strip.getByRole('button', { name: 'Stop' }).click();
  // It shows at once, and ends promptly with what came in and what did not.
  await expect(strip).toContainText(/Stopping the import…|Import stopped/, { timeout: 1_000 });
  await expect(strip).toContainText(/Import stopped: \d+ of 30 photos imported, \d+ not\. Choose the same photos again to import the rest\./, { timeout: 5_000 });
  await expect(strip).not.toContainText('could not be imported');
  const [, imported] = /Import stopped: (\d+) of/.exec((await strip.textContent()) ?? '') ?? [];
  const count = Number(imported);
  expect(count).toBeGreaterThanOrEqual(4);
  expect(count).toBeLessThan(30);

  // The library and Drive hold the same whole photos, and nothing more arrives afterwards.
  await expect(tiles(page)).toHaveCount(count);
  await expect.poll(() => originalsInDrive(drive), { timeout: 10_000 }).toBe(count);
  await page.waitForTimeout(3_000);
  await expect(tiles(page)).toHaveCount(count);
  expect(await originalsInDrive(drive)).toBe(count);

  // Stopped stays stopped: a reload resumes nothing and shows no interrupted import.
  await page.reload();
  await page.getByRole('button', { name: 'Open your Google Drive library' }).click();
  await expect(tiles(page)).toHaveCount(count, { timeout: 30_000 });
  await expect(importStrip(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Interrupted import' })).toHaveCount(0);
  await page.waitForTimeout(2_000);
  expect(await originalsInDrive(drive)).toBe(count);
});

test('Stop while the import waits for sign-in ends it at once, nothing failed', async ({ page }) => {
  await page.clock.install();
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  await signIn(page);
  // Uploads held (once the library is open) until the token has run out.
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  await page.context().route(UPLOADS, async (route: Route) => {
    await gate;
    await route.fallback().catch(() => undefined);
  });
  await chooseAndImport(page, 4);
  await expect(importStrip(page)).toContainText('Importing');
  drive.revokeToken('test-token');
  await page.clock.setSystemTime(new Date(Date.now() + 61 * MINUTE));
  open();
  const strip = importStrip(page);
  await expect(strip).toContainText('Reconnect to Google Drive to continue', { timeout: 30_000 });
  await strip.getByRole('button', { name: 'Stop' }).click();
  await expect(strip).toContainText('Import stopped: 0 of 4 photos imported, 4 not.', { timeout: 5_000 });
  await expect(strip).not.toContainText('could not be imported');
  expect(await originalsInDrive(drive)).toBe(0);
});
