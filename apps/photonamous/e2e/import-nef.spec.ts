import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './test';
import type { Page } from './test';
import { openHarness, waitForReady } from './harness';
import { importStrip, tiles, toast } from './library';

/**
 * A Nikon RAW (NEF) chosen in Import photos is accepted by the sheet,
 * imports into a "This browser" library, and shows as a tile with the
 * camera's embedded preview and its details; it opens in the Edit view,
 * with the colour note on a body the engine has no matrix for. The files
 * the engine refuses say why, in its own sentence: a compressed NEF (in
 * the library and the harness) and a COOLPIX compact's NRW (the sheet
 * leaves a .NRW out, as it does Sony's SR2 and SRF; the harness, given one
 * under a NEF name, says why). Needs the raw.pixls.us samples (CC0):
 * point LOPSY_NEF_SAMPLES at the directory that holds them.
 */
const samples = process.env.LOPSY_NEF_SAMPLES;
const D850 = 'D850_14bit_uncompressed.NEF';
const LOSSLESS = 'Z6_14bit_lossless.NEF';
const D3 = 'D3_14bit_uncompressed.NEF';
const NRW = 'P950_12bit_uncompressed.NRW';

function samplePath(name: string): string | null {
  if (!samples || !existsSync(samples)) return null;
  return readdirSync(samples).includes(name) ? join(samples, name) : null;
}

const LOSSLESS_SENTENCE = 'This Nikon RAW is lossless compressed, which is not supported yet: only uncompressed NEF files open';
const NRW_SENTENCE = 'This RAW file is from a Nikon COOLPIX compact (NRW), which is not supported';
const COLOR_NOTE = 'Colour is approximate: there is no colour matrix for this Nikon camera yet, so only its white balance is applied and colours look washed out.';

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

test.describe('Nikon NEF', () => {
  test.skip(samplePath(D850) === null, `needs LOPSY_NEF_SAMPLES pointing at the Nikon samples (${D850})`);

  test('a NEF imports and shows its preview, camera, size and file type', async ({ page }) => {
    test.setTimeout(180_000);
    const sample = samplePath(D850) ?? '';
    const megabytes = (statSync(sample).size / 1_000_000).toFixed(1);
    await emptyLibrary(page);
    await importOne(page, sample);
    const tile = page.locator('[data-asset-id]').first();
    await expect(tile).toHaveAttribute('title', D850);

    // The preview is the camera's full-size JPEG, decoded: 3:2, not a placeholder.
    const image = tile.getByRole('img', { name: D850 });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 60_000 })
      .toBeGreaterThan(0);
    const ratio = await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
    expect(ratio).toBeCloseTo(8256 / 5504, 2);

    // The details: Nikon's camera named once, the picture's size (the crop the engine keeps), and the file type.
    await tile.click();
    const details = page.getByRole('complementary', { name: 'Details' });
    await expect(details.getByRole('heading', { name: D850 })).toBeVisible();
    const fact = (term: string) => details.locator('div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${term}$`) }) }).locator('dd');
    await expect(fact('Camera')).toHaveText('NIKON D850');
    await expect(fact('Size')).toHaveText('8256 × 5504 (45 MP)');
    await expect(fact('File')).toHaveText(`NEF, ${megabytes} MB`);
    await expect(fact('Taken')).not.toBeEmpty();

    // The file-type filter names it.
    await page.keyboard.press('Escape');
    const filters = page.getByRole('group', { name: 'Filters' });
    const fileType = filters.getByRole('button', { name: /^File type/ });
    if ((await fileType.count()) > 0) await fileType.click();
    else await filters.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /RAW \(Nikon\)/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('import-nef.png') });
  });

  test('a compressed NEF imports, and opening it says why it cannot be edited', async ({ page }) => {
    test.setTimeout(180_000);
    const lossless = samplePath(LOSSLESS);
    test.skip(lossless === null, `needs ${LOSSLESS} in LOPSY_NEF_SAMPLES`);
    await emptyLibrary(page);
    // Import cannot tell a compressed NEF from an uncompressed one: it keeps it, with the camera's preview.
    await importOne(page, lossless ?? '');
    const tile = tiles(page).first();
    await tile.hover();
    await tile.getByRole('button', { name: /^Edit / }).click();
    const alert = page.getByTestId('edit-view').getByRole('alert');
    await expect(alert).toContainText('This photo could not be opened', { timeout: 120_000 });
    await expect(alert).toContainText(LOSSLESS_SENTENCE);
    await page.screenshot({ path: test.info().outputPath('nef-compressed-refused.png') });
  });

  test('a COOLPIX NRW is not a photo the sheet offers to import', async ({ page }) => {
    const nrw = samplePath(NRW);
    test.skip(nrw === null, `needs ${NRW} in LOPSY_NEF_SAMPLES`);
    await emptyLibrary(page);
    await choose(page, nrw ?? '');
    await expect(page.getByText('None of these files are photos this app can read (RAF, DNG, ARW, CR2, NEF, JPEG, PNG or WebP).')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import 0 photos' })).toBeDisabled();
  });

  test('the harness opens a NEF as RAW, with the colour note only for a body without a matrix', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const note = page.getByTestId('color-note');
    // The D850 has a matrix of the engine's own: no note.
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(samplePath(D850) ?? '');
    await waitForReady(page, 150_000);
    await expect(page.getByRole('combobox', { name: 'Profile' })).toBeVisible();
    await expect(note).toHaveCount(0);
    // The D3 has none: its white balance only, and the note says so, under Profile and read with it.
    const d3 = samplePath(D3);
    if (!d3) return;
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(d3);
    await waitForReady(page, 150_000);
    await expect(note).toHaveText(COLOR_NOTE);
    await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveAccessibleDescription(COLOR_NOTE);
  });

  test('the harness says why a compressed NEF, and an NRW under a NEF name, cannot be opened', async ({ page }) => {
    test.setTimeout(180_000);
    const lossless = samplePath(LOSSLESS);
    test.skip(lossless === null, `needs ${LOSSLESS} in LOPSY_NEF_SAMPLES`);
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(lossless ?? '');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This photo could not be opened', { timeout: 60_000 });
    await expect(alert).toContainText(LOSSLESS_SENTENCE);

    const nrw = samplePath(NRW);
    if (!nrw) return;
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles({ name: 'renamed.NEF', mimeType: 'image/x-nikon-nef', buffer: await readFile(nrw) });
    await expect(page.getByRole('alert')).toContainText(NRW_SENTENCE, { timeout: 60_000 });
    await page.screenshot({ path: test.info().outputPath('nrw-refused.png') });
  });
});
