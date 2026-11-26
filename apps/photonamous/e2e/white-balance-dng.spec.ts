import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './test';
import type { Page } from './test';
import { harnessSteps, openHarness, temperatureKelvin, waitForReady } from './harness';

/**
 * White balance on DNGs on the RAW path: Kelvin measured from the file's
 * own calibration, read for both sliders; typed Kelvin back to the
 * recipe's relative units; the CIE illuminant presets; Auto and the
 * picker. Samples: LOPSY_DNG_ADOBE_SAMPLES (5D Mark III DNGs from
 * raw.pixls.us, lossless and lossy JPEG) and LOPSY_DNG_SAMPLES (iPhone
 * ProRAW).
 */
const adobe = process.env.LOPSY_DNG_ADOBE_SAMPLES;
const proraw = process.env.LOPSY_DNG_SAMPLES;

function sample(dir: string | undefined, name: string): string | null {
  if (!dir) return null;
  const path = join(dir, name);
  return existsSync(path) ? path : null;
}

/** Each DNG and its as-shot Kelvin, as its description gives it. */
const DNGS: readonly { readonly name: string; readonly path: string | null; readonly asShotKelvin: number }[] = [
  { name: '5D3 mosaic', path: sample(adobe, '5D3-adobe-lossless.dng'), asShotKelvin: 3753.69 },
  { name: '5D3 linear RGB', path: sample(adobe, '5D3-adobe-lossless-rgb.dng'), asShotKelvin: 3699.15 },
  // The lossy JPEG conversions carry their lossless siblings' calibration and as-shot white.
  { name: '5D3 lossy', path: sample(adobe, '5D3-adobe-lossy.dng'), asShotKelvin: 3753.69 },
  { name: '5D3 lossy RGB', path: sample(adobe, '5D3-adobe-lossy-rgb.dng'), asShotKelvin: 3699.15 },
  { name: 'ProRAW 00', path: sample(proraw, 'sample_dng_00.dng'), asShotKelvin: 6164.8 },
  { name: 'ProRAW 01', path: sample(proraw, 'sample_dng_01.dng'), asShotKelvin: 2749.04 },
];

async function lastStep(page: Page): Promise<string | undefined> {
  return (await harnessSteps(page)).at(-1);
}

test.describe('White balance on a DNG', () => {
  test.setTimeout(6 * 60_000);

  for (const dng of DNGS) {
    test(`${dng.name}: as-shot Kelvin, typed Kelvin, Daylight, Auto and the picker`, async ({ page }) => {
      test.skip(!dng.path, 'Set LOPSY_DNG_ADOBE_SAMPLES and LOPSY_DNG_SAMPLES to the DNG samples to run this test');
      await openHarness(page);
      await page.getByTestId('harness-file').setInputFiles(dng.path ?? '');
      await waitForReady(page, 150_000);

      // As shot reads the file's own Kelvin, to the readout's 50 K.
      const temperature = page.getByLabel('Temperature value');
      await expect(temperature).toHaveValue(`${Math.round(dng.asShotKelvin / 50) * 50} K`);

      // The menu: As shot, Auto, the standard illuminants, Custom.
      const mode = page.getByLabel('White balance mode');
      await expect(mode.locator('option')).toHaveText(['As shot', 'Auto', 'Daylight', 'Cloudy', 'Shade', 'Tungsten', 'Custom']);

      // A typed Kelvin goes into the recipe's units, as one step, and reads back.
      await temperature.fill('5500');
      await temperature.press('Enter');
      await expect.poll(() => temperatureKelvin(page)).toBeGreaterThanOrEqual(5450);
      expect(await temperatureKelvin(page)).toBeLessThanOrEqual(5550);
      expect(await lastStep(page)).toMatch(/^Temperature \d+ K$/);
      await expect(mode).toHaveValue('custom');

      // Daylight is the standard D55 white: about 5500 K.
      await mode.selectOption({ label: 'Daylight' });
      await expect(mode).toHaveValue('preset:daylight');
      await expect.poll(() => lastStep(page)).toBe('White balance: Daylight');
      expect(Math.abs((await temperatureKelvin(page)) - 5500)).toBeLessThanOrEqual(200);

      // Auto measures the photo.
      await mode.selectOption('auto');
      await expect.poll(() => lastStep(page)).toBe('White balance: Auto');
      expect(await temperatureKelvin(page)).toBeGreaterThan(1500);

      // The picker takes a spot in the photo as neutral.
      await page.getByRole('button', { name: 'Pick a neutral grey' }).click();
      const picker = page.getByTestId('white-balance-picker');
      await expect(picker).toBeVisible();
      const canvas = await page.getByTestId('edit-canvas').boundingBox();
      if (!canvas) throw new Error('no canvas');
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await expect(picker).toHaveCount(0);
      await expect.poll(() => lastStep(page), { timeout: 10_000 }).toBe('White balance: picked');
      await expect(temperature).toHaveValue(/^\d+ K$/);
    });
  }

  test('the readout at the far end of Temperature shows the Kelvin it reaches, not the Kelvin typed', async ({ page }) => {
    const [mosaic] = DNGS;
    test.skip(!mosaic?.path, 'Set LOPSY_DNG_ADOBE_SAMPLES to the DNG samples to run this test');
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(mosaic?.path ?? '');
    await waitForReady(page, 150_000);
    const temperature = page.getByLabel('Temperature value');
    await temperature.fill('50000');
    await temperature.press('Enter');
    // The recipe holds the far end of the slider.
    await expect.poll(() => page.evaluate(() => window.__photosHarness?.recipe?.whiteBalance.temperature)).toBe(200);
    const reached = await temperatureKelvin(page);
    expect(reached).toBeGreaterThan(10_000);
    expect(reached).toBeLessThan(50_000);
  });
});
