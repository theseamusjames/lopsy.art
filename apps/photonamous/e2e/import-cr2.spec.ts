import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './test';
import type { Page } from './test';
import { openHarness, waitForReady } from './harness';
import { importStrip, tiles, toast } from './library';

/**
 * A Canon RAW (CR2) chosen in Import photos is accepted by the sheet,
 * imports into a "This browser" library, and shows as a tile with the
 * camera's embedded preview and its details; it opens in the Edit view,
 * with the colour note on a body the engine has no matrix for. The files
 * the engine refuses say why, in its own sentence: a reduced-size sRAW
 * (in the library and the harness) and a CR3 (the sheet leaves a .CR3
 * out, as it does Sony's SR2 and SRF; the harness, given one under a CR2
 * name, says why). Needs the raw.pixls.us samples (CC0): point
 * LOPSY_CR2_SAMPLES at the directory that holds them.
 */
const samples = process.env.LOPSY_CR2_SAMPLES;
const MARK_III = 'EOS-5D-Mark-III_RAW.CR2';
const SRAW = 'EOS-40D_sRAW.CR2';
const SEVEN_D = 'EOS-7D_RAW.CR2';
const CR3 = 'EOS-R_RAW.CR3';

function samplePath(name: string): string | null {
  if (!samples || !existsSync(samples)) return null;
  return readdirSync(samples).includes(name) ? join(samples, name) : null;
}

const SRAW_SENTENCE = 'This Canon RAW is a reduced-size sRAW or mRAW, which is not supported';
const CR3_SENTENCE = "This Canon CR3 is compressed with Canon's own lossless codec, which this app cannot decode yet";
const COLOR_NOTE = 'Colour is approximate: this Canon RAW carries no colour matrix, so only its white balance is applied and colours look washed out.';

async function emptyLibrary(page: Page): Promise<void> {
  // Wide enough that the filters are buttons in their row, not one menu.
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
}

async function choose(page: Page, files: string | string[]): Promise<void> {
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles(files);
}

async function importOne(page: Page, path: string): Promise<void> {
  await choose(page, path);
  await expect(page.getByText(/None of these files are photos/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Import 1 photo' }).click();
  await expect(toast(page, 'Imported 1 photo')).toBeVisible({ timeout: 150_000 });
  await expect(importStrip(page)).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
}

test.describe('Canon CR2', () => {
  test.skip(samplePath(MARK_III) === null, `needs LOPSY_CR2_SAMPLES pointing at the Canon samples (${MARK_III})`);

  test('a CR2 imports and shows its preview, camera, size and file type', async ({ page }) => {
    test.setTimeout(180_000);
    const sample = samplePath(MARK_III) ?? '';
    const megabytes = (statSync(sample).size / 1_000_000).toFixed(1);
    await emptyLibrary(page);
    await importOne(page, sample);
    const tile = page.locator('[data-asset-id]').first();
    await expect(tile).toHaveAttribute('title', MARK_III);

    // The preview is the camera's full-size JPEG, decoded: 3:2, not a placeholder.
    const image = tile.getByRole('img', { name: MARK_III });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 60_000 })
      .toBeGreaterThan(0);
    const ratio = await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
    expect(ratio).toBeCloseTo(5760 / 3840, 2);

    // The details: Canon's camera, the picture's size (the crop of the sensor the engine keeps), and the file type.
    await tile.click();
    const details = page.getByRole('complementary', { name: 'Details' });
    await expect(details.getByRole('heading', { name: MARK_III })).toBeVisible();
    const fact = (term: string) => details.locator('div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) }).locator('dd');
    await expect(fact('Camera')).toHaveText('Canon EOS 5D Mark III');
    await expect(fact('Size')).toHaveText('5760 × 3840 (22 MP)');
    await expect(fact('File')).toHaveText(`CR2, ${megabytes} MB`);
    await expect(fact('Taken')).not.toBeEmpty();

    // The file-type filter names it.
    await page.keyboard.press('Escape');
    const filters = page.getByRole('group', { name: 'Filters' });
    const fileType = filters.getByRole('button', { name: /^File type/ });
    if ((await fileType.count()) > 0) await fileType.click();
    else await filters.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /RAW \(Canon\)/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('import-cr2.png') });
  });

  test('an sRAW imports, and opening it says why it cannot be edited', async ({ page }) => {
    test.setTimeout(180_000);
    const sraw = samplePath(SRAW);
    test.skip(sraw === null, `needs ${SRAW} in LOPSY_CR2_SAMPLES`);
    await emptyLibrary(page);
    // Import cannot tell an sRAW from a full-size CR2: it keeps it, with the camera's preview.
    await importOne(page, sraw ?? '');
    const tile = tiles(page).first();
    await tile.hover();
    await tile.getByRole('button', { name: /^Edit / }).click();
    const alert = page.getByTestId('edit-view').getByRole('alert');
    await expect(alert).toContainText('This photo could not be opened', { timeout: 120_000 });
    await expect(alert).toContainText(SRAW_SENTENCE);
    await page.screenshot({ path: test.info().outputPath('cr2-sraw-refused.png') });
  });

  test('a CR3 is not a photo the sheet offers to import', async ({ page }) => {
    const cr3 = samples ? readdirSync(samples).filter((f) => /\.cr3$/i.test(f)) : [];
    test.skip(cr3.length === 0, 'needs the CR3 samples in LOPSY_CR2_SAMPLES');
    await emptyLibrary(page);
    await choose(page, cr3.map((f) => join(samples ?? '', f)));
    await expect(page.getByText('None of these files are photos this app can read (RAF, DNG, ARW, CR2, NEF, JPEG, PNG or WebP).')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import 0 photos' })).toBeDisabled();
  });

  test('the harness opens a CR2 as RAW, with the colour note only for a body without a matrix', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const note = page.getByTestId('color-note');
    // The 5D Mark III has a matrix of the engine's own: no note.
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(samplePath(MARK_III) ?? '');
    await waitForReady(page, 150_000);
    await expect(page.getByRole('combobox', { name: 'Profile' })).toBeVisible();
    await expect(note).toHaveCount(0);
    // The 7D has none: its white balance only, and the note says so, under Profile and read with it.
    const sevenD = samplePath(SEVEN_D);
    if (!sevenD) return;
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sevenD);
    await waitForReady(page, 150_000);
    await expect(note).toHaveText(COLOR_NOTE);
    await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveAccessibleDescription(COLOR_NOTE);
  });

  test('the harness says why an sRAW, and a CR3 under a CR2 name, cannot be opened', async ({ page }) => {
    test.setTimeout(180_000);
    const sraw = samplePath(SRAW);
    test.skip(sraw === null, `needs ${SRAW} in LOPSY_CR2_SAMPLES`);
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sraw ?? '');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This photo could not be opened', { timeout: 60_000 });
    await expect(alert).toContainText(SRAW_SENTENCE);

    const cr3 = samplePath(CR3);
    if (!cr3) return;
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles({ name: 'renamed.CR2', mimeType: 'image/x-canon-cr2', buffer: await readFile(cr3) });
    await expect(page.getByRole('alert')).toContainText(CR3_SENTENCE, { timeout: 60_000 });
    await page.screenshot({ path: test.info().outputPath('cr3-refused.png') });
  });
});
