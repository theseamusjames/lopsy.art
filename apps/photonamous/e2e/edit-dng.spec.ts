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
const DNGS: readonly {
  readonly name: string;
  readonly path: string | null;
  readonly width: number;
  readonly height: number;
  readonly isWorkingSmaller: boolean;
  /** The Profile menu: a ProRAW also has the camera's own look (its tone curve and gain map), first. */
  readonly profiles: readonly string[];
}[] = [
  { name: '5D3 mosaic', path: sample(adobe, '5D3-adobe-lossless.dng'), width: 5760, height: 3840, isWorkingSmaller: true, profiles: ['Standard', 'Neutral', 'Monochrome'] },
  { name: '5D3 linear RGB', path: sample(adobe, '5D3-adobe-lossless-rgb.dng'), width: 3960, height: 2640, isWorkingSmaller: false, profiles: ['Standard', 'Neutral', 'Monochrome'] },
  { name: 'ProRAW 00', path: sample(proraw, 'sample_dng_00.dng'), width: 3024, height: 4032, isWorkingSmaller: false, profiles: ['Camera', 'Standard', 'Neutral', 'Monochrome'] },
  { name: 'ProRAW 01', path: sample(proraw, 'sample_dng_01.dng'), width: 4032, height: 3024, isWorkingSmaller: false, profiles: ['Camera', 'Standard', 'Neutral', 'Monochrome'] },
];

/** A ProRAW's profiles' own exposures, as its description gives them: the camera's look (the file's), and Standard (matched to the embedded preview). */
const PRORAW_EXPOSURES: readonly { readonly name: string; readonly path: string | null; readonly camera: number; readonly standard: number }[] = [
  { name: 'ProRAW 00', path: sample(proraw, 'sample_dng_00.dng'), camera: -0.169, standard: -0.781 },
  { name: 'ProRAW 01', path: sample(proraw, 'sample_dng_01.dng'), camera: 4.1, standard: 2.192 },
];

/** The exposure the RAW develop stage was last sent (development builds' hook). */
async function sentExposure(page: Page): Promise<number> {
  const json = await page.evaluate(() => window.__photonamousScreenEngine?.rawDevelopSettings() ?? null);
  if (!json) throw new Error('no RAW develop settings were sent');
  return (JSON.parse(json) as { exposureEv: number }).exposureEv;
}

/** A hash of the exact render (development builds' read of what the Edit view drew). */
async function renderHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const read = await window.__photonamousScreenEngine?.readRendered();
    if (!read || read.kind !== 'linear-f32') throw new Error('no linear render to read');
    const words = new Uint32Array(read.pixels.buffer, read.pixels.byteOffset, read.pixels.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ (words[i] ?? 0), 0x01000193) ^ (h >>> 15);
    return `${read.width}x${read.height}:${(h >>> 0).toString(16)}`;
  });
}

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
      expect(profiles).toEqual(dng.profiles);
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

  for (const proraw of PRORAW_EXPOSURES) {
    test(`${proraw.name}: opens on Camera; Standard brings its own exposure, and Camera again the first render exactly`, async ({ page }) => {
      test.skip(!proraw.path, 'Set LOPSY_DNG_SAMPLES to the ProRAW samples to run this test');
      await open(page, proraw.path ?? '');
      await waitForReady(page, 150_000);
      const profile = page.getByRole('combobox', { name: 'Profile' });
      await expect(profile).toHaveValue('standard');
      await expect(profile.locator('option:checked')).toHaveText('Camera');
      await expect.poll(() => sentExposure(page)).toBeCloseTo(proraw.camera, 2);
      const first = await renderHash(page);

      await profile.selectOption({ label: 'Standard' });
      await expect.poll(() => sentExposure(page)).toBeCloseTo(proraw.standard, 2);
      expect(await renderHash(page)).not.toBe(first);

      await profile.selectOption({ label: 'Camera' });
      await expect.poll(() => sentExposure(page)).toBeCloseTo(proraw.camera, 2);
      expect(await renderHash(page)).toBe(first);

      // The user's Exposure adds to the profile's, counted once.
      await profile.selectOption({ label: 'Standard' });
      const readout = page.getByLabel('Exposure value');
      await readout.fill('0.5');
      await readout.press('Enter');
      await expect.poll(() => sentExposure(page)).toBeCloseTo(proraw.standard + 0.5, 2);
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
