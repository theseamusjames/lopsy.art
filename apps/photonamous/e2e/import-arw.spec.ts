import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './test';
import { importStrip, toast } from './library';

/**
 * A Sony RAW (ARW) chosen in Import photos is accepted by the sheet,
 * imports into a "This browser" library, and shows as a tile with the
 * camera's embedded preview and its details. Needs the real Sony A7 IV
 * sample: point LOPSY_ARW_SAMPLES at the directory that holds it
 * (ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW, CC0, raw.pixls.us).
 */
const samples = process.env.LOPSY_ARW_SAMPLES;

function a7ivSample(): string | null {
  if (!samples || !existsSync(samples)) return null;
  const name = 'ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW';
  return readdirSync(samples).includes(name) ? join(samples, name) : null;
}

const sample = a7ivSample();

test.skip(sample === null, 'needs LOPSY_ARW_SAMPLES pointing at the Sony A7 IV sample ARW');

test('a Sony ARW imports and shows its preview, camera, size and file type', async ({ page }) => {
  test.setTimeout(180_000);
  if (!sample) return;
  const fileName = sample.split('/').pop() ?? '';
  const megabytes = (statSync(sample).size / 1_000_000).toFixed(1);
  // Wide enough that the filters are buttons in their row, not one menu.
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();

  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(sample);
  // The sheet takes it for a photo: nothing is left out.
  await expect(page.getByText(/None of these files are photos/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Import 1 photo' }).click();
  await expect(toast(page, 'Imported 1 photo')).toBeVisible({ timeout: 150_000 });
  await expect(importStrip(page)).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
  const tile = page.locator('[data-asset-id]').first();
  await expect(tile).toHaveAttribute('title', fileName);

  // The preview is the picture, decoded: landscape at the photo's 3:2 (7008 x 4672), not a placeholder.
  const image = tile.getByRole('img', { name: fileName });
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 60_000 })
    .toBeGreaterThan(0);
  const ratio = await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(ratio).toBeCloseTo(7008 / 4672, 2);

  // The details: Sony's camera, the picture's size (the default crop, not the sensor's 7040 x 4688), and the file type.
  await tile.click();
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('heading', { name: fileName })).toBeVisible();
  const fact = (term: string) => details.locator('div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) }).locator('dd');
  await expect(fact('Camera')).toHaveText('Sony ILCE-7M4');
  await expect(fact('Lens')).toHaveText('FE 50mm F2.5 G');
  await expect(fact('Size')).toHaveText('7008 × 4672 (33 MP)');
  await expect(fact('File')).toHaveText(`ARW, ${megabytes} MB`);
  await expect(fact('Taken')).not.toBeEmpty();

  // The file-type filter names it.
  await page.keyboard.press('Escape');
  const filters = page.getByRole('group', { name: 'Filters' });
  const fileType = filters.getByRole('button', { name: /^File type/ });
  if ((await fileType.count()) > 0) await fileType.click();
  else await filters.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /RAW \(Sony\)/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('import-arw.png') });
});

test("Sony's older SR2 and SRF files are not photos the sheet offers to import", async ({ page }) => {
  const older = samples ? readdirSync(samples).filter((f) => /\.(sr2|srf)$/i.test(f)) : [];
  test.skip(older.length === 0, 'needs the SR2 and SRF samples in LOPSY_ARW_SAMPLES');
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(older.map((f) => join(samples ?? '', f)));
  await expect(page.getByText('None of these files are photos this app can read (RAF, DNG, ARW, CR2, NEF, JPEG, PNG or WebP).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 photos' })).toBeDisabled();
});
