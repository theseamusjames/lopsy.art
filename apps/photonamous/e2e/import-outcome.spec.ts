import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importStrip, toast } from './library';

/**
 * How an import ends: a clean one says so in a toast, which goes by itself,
 * and leaves no strip behind; one where something failed keeps the strip,
 * with what failed, until it is dismissed.
 */

async function startImport(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: f.buffer })));
  await page.getByRole('button', { name: `Import ${files.length} photos` }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
});

test('a clean import says how it went in a toast, and leaves no strip behind', async ({ page }) => {
  await startImport(page, [
    { name: 'harbour.jpg', buffer: await generatedJpeg(page, 30, 480, 320) },
    { name: 'dunes.jpg', buffer: await generatedJpeg(page, 210, 480, 320) },
  ]);
  const outcome = toast(page, 'Imported 2 photos');
  await expect(outcome).toBeVisible({ timeout: 60_000 });
  await expect(importStrip(page)).toHaveCount(0);
  await expect(page.locator('[role="gridcell"]')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/import-outcome-toast.png' });

  // Off the toast (the pointer over it holds it), it goes after its few seconds, and nothing takes the strip's place.
  await page.mouse.move(10, 10);
  await expect(outcome).toHaveCount(0, { timeout: 15_000 });
  await expect(importStrip(page)).toHaveCount(0);
});

test('an import where something failed keeps the strip, with what failed', async ({ page }) => {
  await startImport(page, [
    { name: 'harbour.jpg', buffer: await generatedJpeg(page, 30, 480, 320) },
    { name: 'broken.jpg', buffer: Buffer.from('this is not a photo') },
  ]);
  const strip = importStrip(page);
  await expect(strip.getByText('Imported 1 photo', { exact: true })).toBeVisible({ timeout: 60_000 });
  const failures = strip.getByRole('button', { name: '1 photo could not be imported' });
  await expect(failures).toBeVisible();
  await expect(toast(page, /^Imported/)).toHaveCount(0);

  // Longer than a toast stays: the strip is still there.
  await page.mouse.move(10, 10);
  await page.waitForTimeout(7000);
  await expect(strip).toBeVisible();
  await failures.click();
  await expect(strip.getByText('broken.jpg')).toBeVisible();
  await expect(strip.getByText('Not a supported photo format')).toBeVisible();
  await page.screenshot({ path: 'test-results/import-outcome-failure-strip.png' });

  await strip.getByRole('button', { name: 'Dismiss' }).click();
  await expect(strip).toHaveCount(0);
});
