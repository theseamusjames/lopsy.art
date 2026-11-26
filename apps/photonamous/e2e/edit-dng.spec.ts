import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './test';
import type { Page } from './test';
import { lastExportSize, loadFullResolution, waitForReady } from './harness';

/**
 * Real DNGs in the Edit view on the RAW path: the engine prepares the file
 * in workers, shows a working image first and the full size when it is
 * asked for, and the photo is edited as RAW (its profile list, Kelvin).
 * Samples, not in the repository: LOPSY_DNG_ADOBE_SAMPLES (raw.pixls.us,
 * Canon 5D Mark III converted by Adobe: a mosaic, a linear RGB one, and
 * lossy ones the RAW path refuses) and LOPSY_DNG_SAMPLES (sample_dng_00
 * and 01, iPhone ProRAW).
 *
 * Brightness is not asserted: the default look of these formats is being
 * decided.
 */
const adobe = process.env.LOPSY_DNG_ADOBE_SAMPLES;
const proraw = process.env.LOPSY_DNG_SAMPLES;

function sample(dir: string | undefined, name: string): string | null {
  if (!dir) return null;
  const path = join(dir, name);
  return existsSync(path) ? path : null;
}

/**
 * Each DNG and the size its picture is: the baked decode's, which import
 * records and existing crops and masks rely on. The working image is the
 * file binned by a whole factor to at least 2048 px on its long edge, so
 * only a file at least twice that long has a smaller working image first.
 */
const DNGS: readonly { readonly name: string; readonly path: string | null; readonly width: number; readonly height: number; readonly isWorkingSmaller: boolean }[] = [
  { name: '5D3 mosaic', path: sample(adobe, '5D3-adobe-lossless.dng'), width: 5760, height: 3840, isWorkingSmaller: true },
  { name: '5D3 linear RGB', path: sample(adobe, '5D3-adobe-lossless-rgb.dng'), width: 3960, height: 2640, isWorkingSmaller: false },
  { name: 'ProRAW 00', path: sample(proraw, 'sample_dng_00.dng'), width: 3024, height: 4032, isWorkingSmaller: false },
  { name: 'ProRAW 01', path: sample(proraw, 'sample_dng_01.dng'), width: 4032, height: 3024, isWorkingSmaller: false },
];

async function open(page: Page, path: string, query = ''): Promise<void> {
  await page.goto(`/edit-harness.html${query}`);
  await expect(page.getByTestId('harness-file')).toBeAttached();
  await page.getByTestId('harness-file').setInputFiles(path);
}

async function exportedSize(page: Page): Promise<{ width: number; height: number } | null> {
  const download = page.waitForEvent('download', { timeout: 5 * 60_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await download;
  return lastExportSize(page);
}

test.describe('DNG on the RAW path', () => {
  test.setTimeout(8 * 60_000);

  for (const dng of DNGS) {
    test(`${dng.name}: opens as RAW, at its working size, then full size, and exports at its size`, async ({ page }) => {
      test.skip(!dng.path, 'Set LOPSY_DNG_ADOBE_SAMPLES and LOPSY_DNG_SAMPLES to the DNG samples to run this test');
      await open(page, dng.path ?? '');
      await waitForReady(page, 150_000);

      // A RAW photo: the RAW profiles, and Temperature in Kelvin (the file's calibration measures it).
      const profiles = await page.getByRole('combobox', { name: 'Profile' }).locator('option').allTextContents();
      expect(profiles).toEqual(['Standard', 'Monochrome', 'Neutral']);
      await expect(page.getByLabel('Temperature value')).toHaveValue(/^\d+ K$/);
      await expect(page.getByTestId('color-note')).toHaveCount(0);

      if (dng.isWorkingSmaller) {
        await loadFullResolution(page);
      } else {
        // Already the full size: Full asks for nothing more.
        await page.getByRole('button', { name: 'Full', exact: true }).click();
        await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
        await expect(page.getByTestId('loading-badge')).toHaveCount(0);
      }
      expect(await exportedSize(page)).toEqual({ width: dng.width, height: dng.height });
    });
  }

  test('a lossy DNG, which the RAW path cannot prepare, says why as it did before', async ({ page }) => {
    const lossy = sample(adobe, '5D3-adobe-lossy.dng');
    test.skip(!lossy, 'Set LOPSY_DNG_ADOBE_SAMPLES to the DNG samples to run this test');
    await open(page, lossy ?? '');
    // The baked decode is tried in its place, and its refusal is what the person reads.
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This photo could not be opened', { timeout: 120_000 });
    await expect(alert).toContainText('This DNG uses lossy JPEG compression, which is not supported yet');
  });

  test('without float targets a DNG opens with the baked decode and is edited as an ordinary photo, at the same size', async ({ page }) => {
    const [mosaic, , prorawFile] = DNGS;
    test.skip(!mosaic?.path || !prorawFile?.path, 'Set LOPSY_DNG_ADOBE_SAMPLES and LOPSY_DNG_SAMPLES to the DNG samples to run this test');
    for (const dng of [mosaic, prorawFile]) {
      if (!dng?.path) continue;
      await open(page, dng.path, '?develop=no-float');
      await waitForReady(page, 150_000);
      // An ordinary photo's controls: Standard and Monochrome, a relative Temperature, no presets or Auto.
      await expect(page.getByRole('combobox', { name: 'Profile' }).locator('option')).toHaveText(['Standard', 'Monochrome']);
      await expect(page.getByLabel('Temperature value')).toHaveValue('0');
      await expect(page.getByLabel('White balance mode').locator('option')).toHaveText(['As shot', 'Custom']);
      // The baked decode is the full size at once.
      await expect(page.getByTestId('loading-badge')).toHaveCount(0);
      expect(await exportedSize(page)).toEqual({ width: dng.width, height: dng.height });
    }
  });
});
