import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './test';
import type { Page } from './test';
import {
  harnessSteps,
  imageStats,
  jpegSize,
  lastExportSize,
  loadFullResolution,
  openHarness,
  previewCount,
  raiseExposure,
  settledPreview,
  temperatureKelvin,
  waitForPreview,
  waitForReady,
  type ImageStats,
} from './harness';
import { importStrip, toast } from './library';

/**
 * Real Sony RAWs (ARW) in the Edit view on the RAW path: prepared in
 * workers, a working image first and the full size when asked for, with
 * the white balance the engine describes (measured Kelvin and illuminant
 * presets for bodies with measured colour; relative Temperature and a
 * colour note for the others). The samples are not in the repository:
 * point LOPSY_ARW_SAMPLES at the directory that holds them (raw.pixls.us,
 * CC0).
 *
 * Brightness and saturation are not asserted: the default look of these
 * formats is being decided.
 */
const samples = process.env.LOPSY_ARW_SAMPLES;
const COMPRESSED_A7IV = 'ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW';

/** Each ARW sample and the size the engine decodes it to (and import records). */
const SIZES: readonly (readonly [string, number, number])[] = [
  [COMPRESSED_A7IV, 7008, 4672],
  ['ILCE-7M4_DSC06673_FullFrame-Raw-Uncompressed.ARW', 7008, 4672],
  ['ILCE-7M4_DSC06674_FullFrame-LossLess-Compressed-Large.ARW', 7008, 4672],
  ['ILCE-7M3_DSC0009.ARW', 6000, 4000],
  ['ILCE-6000_DSC01542.ARW', 6000, 4000],
  ['DSC-RX100M3_DSC00734.ARW', 5472, 3648],
];

function samplePath(name: string): string | null {
  if (!samples || !existsSync(samples)) return null;
  return readdirSync(samples).includes(name) ? join(samples, name) : null;
}

const COLOR_NOTE = /^Colour is approximate/;
/** Bodies the engine has no measured colour for: their decode says its colour is approximate. */
const APPROXIMATE = new Set(['ILCE-6000_DSC01542.ARW', 'DSC-RX100M3_DSC00734.ARW']);

/** Makes an edit and measures the screen preview rendered for it, once the edit has settled. */
async function previewAfter(page: Page, edit: () => Promise<void>): Promise<ImageStats> {
  const from = await previewCount(page);
  await edit();
  await waitForPreview(page, from, 3 * 60_000);
  return imageStats(page, { kind: 'preview', index: await settledPreview(page, from), which: 'screen' });
}

async function setExposure(page: Page, value: string): Promise<void> {
  const readout = page.getByLabel('Exposure value');
  await readout.fill(value);
  await readout.press('Enter');
}

/** Bodies with measured colour, and the as-shot Kelvin their description gives. */
const MEASURED: Readonly<Record<string, number>> = {
  [COMPRESSED_A7IV]: 4540.94,
  'ILCE-7M4_DSC06673_FullFrame-Raw-Uncompressed.ARW': 4745.68,
  'ILCE-7M4_DSC06674_FullFrame-LossLess-Compressed-Large.ARW': 4516.17,
  'ILCE-7M3_DSC0009.ARW': 4256.09,
};

async function lastStep(page: Page): Promise<string | undefined> {
  return (await harnessSteps(page)).at(-1);
}

async function exportedSize(page: Page): Promise<{ width: number; height: number } | null> {
  const download = page.waitForEvent('download', { timeout: 5 * 60_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await download;
  return lastExportSize(page);
}

test.describe('Edit view on a Sony ARW', () => {
  const sample = samplePath(COMPRESSED_A7IV);
  test.skip(!sample, 'Set LOPSY_ARW_SAMPLES to the directory of Sony ARW samples to run this test');
  test.setTimeout(6 * 60_000);

  test('the harness opens it as RAW at its working size, with measured colour and no note, edits and exports it', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');
    await waitForReady(page, 120_000);

    // The A7 IV's colour is measured, so the decoder sends no note and the Profile menu has none.
    await expect(page.getByTestId('color-note')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveAccessibleDescription('');
    await expect(page.getByRole('combobox', { name: 'Profile' }).locator('option')).toHaveText(['Standard', 'Monochrome', 'Neutral']);
    await page.screenshot({ path: test.info().outputPath('arw-harness.png') });

    // The working image first; the full size is decoded when asked for.
    await loadFullResolution(page);

    // The screen preview is the picture at 3:2, and Exposure moves it.
    const darker = await previewAfter(page, () => setExposure(page, '-1'));
    expect(Math.max(darker.width, darker.height)).toBe(2048);
    expect(darker.width / darker.height).toBeCloseTo(7008 / 4672, 2);
    expect(darker.spread).toBeGreaterThan(5);
    const brighter = await previewAfter(page, () => setExposure(page, '1'));
    expect(brighter.mean).toBeGreaterThan(darker.mean + 10);

    // A full-size JPEG export.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    expect((await download).suggestedFilename()).toBe(COMPRESSED_A7IV.replace(/\.ARW$/, '.jpg'));
    expect(await lastExportSize(page)).toEqual({ width: 7008, height: 4672 });
  });

  test('imported into a library, it opens at the size recorded, edits, and exports at that size', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: /This browser/ }).click();
    await expect(page.getByText('Your library is empty')).toBeVisible();
    await page.getByRole('button', { name: /Import photos/ }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Choose photos/ }).click();
    await (await chooser).setFiles(sample ?? '');
    await page.getByRole('button', { name: 'Import 1 photo' }).click();
    await expect(toast(page, 'Imported 1 photo')).toBeVisible({ timeout: 150_000 });
    await expect(importStrip(page)).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
    const tile = page.locator('[data-asset-id]').first();
    await tile.click();
    const details = page.getByRole('complementary', { name: 'Details' });
    const size = details.locator('div').filter({ has: page.locator('dt', { hasText: /^Size$/ }) }).locator('dd');
    await expect(size).toHaveText('7008 × 4672 (33 MP)');
    const importedHash = (await tile.getAttribute('data-preview-hash')) ?? '';

    await page.keyboard.press('Enter');
    await waitForReady(page, 120_000);
    await expect(page.getByTestId('color-note')).toHaveCount(0);
    await raiseExposure(page, 10);
    await expect(page.getByLabel('Exposure value')).toHaveValue('+1.00');
    await page.getByRole('button', { name: 'Back', exact: true }).first().click();

    // The edit's preview, rendered by the engine from the ARW, replaces the camera's: still the picture at 3:2.
    await expect(tile).not.toHaveAttribute('data-preview-hash', importedHash, { timeout: 120_000 });
    const image = tile.getByRole('img', { name: COMPRESSED_A7IV });
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), { timeout: 60_000 })
      .toBeGreaterThan(0);
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight)).toBeCloseTo(7008 / 4672, 2);

    // A preset applied from the grid: the preview is rendered again from the ARW, by the engine off screen.
    const editedHash = (await tile.getAttribute('data-preview-hash')) ?? '';
    await tile.click();
    await page.getByRole('button', { name: 'Presets', exact: true }).click();
    await page.getByRole('menu', { name: 'Presets' }).getByRole('menuitem', { name: 'Punchy' }).click();
    await expect(tile).not.toHaveAttribute('data-preview-hash', editedHash, { timeout: 120_000 });
    await expect(tile.getByRole('img', { name: 'Updating' })).toHaveCount(0, { timeout: 60_000 });

    // Export, original size, JPEG (the defaults): the size the library recorded.
    await page.getByRole('button', { name: /^Export 1/ }).click();
    await expect(page.getByRole('radio', { name: /^JPEG/ })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Size' })).toHaveValue('original');
    await page.getByRole('radio', { name: 'Download to this computer' }).check();
    const download = page.waitForEvent('download', { timeout: 180_000 });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.jpg$/);
    const bytes = await readFile(await file.path());
    await file.delete();
    expect(jpegSize(bytes)).toEqual({ width: 7008, height: 4672 });
  });

  test('a file cut short, and an SR2 under an ARW name, say why they cannot be opened', async ({ page }) => {
    const whole = await readFile(sample ?? '');
    await openHarness(page);
    // The sensor data starts at 7.6 MB and runs to the end: cut it in half.
    await page.getByTestId('harness-file').setInputFiles({ name: 'cut.ARW', mimeType: 'image/x-sony-arw', buffer: whole.subarray(0, 20_000_000) });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This photo could not be opened', { timeout: 60_000 });
    await expect(alert).toContainText(/cut short/);
    await page.screenshot({ path: test.info().outputPath('arw-cut-short.png') });

    const sr2 = samples ? readdirSync(samples).find((f) => /\.sr2$/i.test(f)) : undefined;
    if (!sr2 || !samples) return;
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles({ name: 'renamed.ARW', mimeType: 'image/x-sony-arw', buffer: await readFile(join(samples, sr2)) });
    await expect(page.getByRole('alert')).toContainText(/SR2\) is not supported/, { timeout: 60_000 });
  });
});

test.describe('Every ARW sample opens on the RAW path, at the size the baked decode gave', () => {
  test.setTimeout(6 * 60_000);
  for (const [name, width, height] of SIZES.slice(1)) {
    test(name, async ({ page }) => {
      const path = samplePath(name);
      test.skip(!path, `needs ${name} in LOPSY_ARW_SAMPLES`);
      await openHarness(page);
      await page.getByTestId('harness-file').setInputFiles(path ?? '');
      await waitForReady(page, 150_000);
      const temperature = page.getByLabel('Temperature value');
      const mode = page.getByLabel('White balance mode');
      const note = page.getByTestId('color-note');
      const asShot = MEASURED[name];
      if (asShot !== undefined) {
        // Measured colour: Kelvin read from the file, the standard illuminants, no note.
        await expect(note).toHaveCount(0);
        await expect(temperature).toHaveValue(`${Math.round(asShot / 50) * 50} K`);
        await expect(mode.locator('option')).toHaveText(['As shot', 'Auto', 'Daylight', 'Cloudy', 'Shade', 'Tungsten', 'Custom']);
        await temperature.fill('5500');
        await temperature.press('Enter');
        await expect.poll(() => temperatureKelvin(page)).toBeGreaterThanOrEqual(5450);
        expect(await temperatureKelvin(page)).toBeLessThanOrEqual(5550);
        await mode.selectOption({ label: 'Daylight' });
        await expect.poll(() => lastStep(page)).toBe('White balance: Daylight');
      } else {
        // No measured colour: Temperature in relative numbers, no presets, and the note, quietly under Profile and read with it.
        await expect(note).toHaveText(COLOR_NOTE);
        await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveAccessibleDescription(COLOR_NOTE);
        await expect(temperature).toHaveValue('0');
        await expect(mode.locator('option')).toHaveText(['As shot', 'Auto', 'Custom']);
      }
      // Auto and the picker work either way.
      await mode.selectOption('auto');
      await expect.poll(() => lastStep(page)).toBe('White balance: Auto');
      await page.getByRole('button', { name: 'Pick a neutral grey' }).click();
      const canvas = await page.getByTestId('edit-canvas').boundingBox();
      if (!canvas) throw new Error('no canvas');
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await expect.poll(() => lastStep(page), { timeout: 10_000 }).toBe('White balance: picked');

      const shown = await previewAfter(page, () => setExposure(page, '0.5'));
      expect(Math.max(shown.width, shown.height)).toBe(2048);
      expect(shown.width / shown.height).toBeCloseTo(width / height, 2);
      expect(shown.spread).toBeGreaterThan(5);
      // At full size the picture is the size the baked decode gave, which import records and crops rely on.
      expect(await exportedSize(page)).toEqual({ width, height });
    });
  }

  test('without float targets an ARW opens with the baked decode, as an ordinary photo, at the same size', async ({ page }) => {
    const name = 'ILCE-7M3_DSC0009.ARW';
    const path = samplePath(name);
    test.skip(!path, `needs ${name} in LOPSY_ARW_SAMPLES`);
    await page.goto('/edit-harness.html?develop=no-float');
    await expect(page.getByTestId('harness-file')).toBeAttached();
    await page.getByTestId('harness-file').setInputFiles(path ?? '');
    await waitForReady(page, 150_000);
    await expect(page.getByRole('combobox', { name: 'Profile' }).locator('option')).toHaveText(['Standard', 'Monochrome']);
    await expect(page.getByLabel('Temperature value')).toHaveValue('0');
    await expect(page.getByLabel('White balance mode').locator('option')).toHaveText(['As shot', 'Custom']);
    expect(await exportedSize(page)).toEqual({ width: 6000, height: 4000 });
  });
});
