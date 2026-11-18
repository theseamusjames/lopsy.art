import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openHarness, waitForReady } from './harness';

/**
 * White balance on a real Fujifilm RAF: the body's presets in the Mode
 * menu, a preset setting Temperature and Tint, and the Kelvin readout.
 * The samples are not in the repository: point LOPSY_RAF_SAMPLES at a
 * directory of them (github.com/theseamusjames/sample-raf-images).
 * DSCF6952 is an X100VI frame shot at about 4970 K.
 */
const samples = process.env.LOPSY_RAF_SAMPLES;
const SAMPLE = 'DSCF6952.RAF';

function samplePath(): string | null {
  if (!samples) return null;
  const path = join(samples, SAMPLE);
  return existsSync(path) ? path : null;
}

/** What the engine says about this file's white balance, read in the page from the same wasm the app uses. */
async function engineWhiteBalance(page: Page, path: string): Promise<{
  presets: { name: string; temperature: number; tint: number }[];
  kelvin: { miredAtZero: number; miredPerUnit: number; asShotKelvin: number } | null;
}> {
  // The file goes into the page through a file input of its own, as the browser would read it.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'wb-probe';
    input.hidden = true;
    document.body.append(input);
  });
  await page.setInputFiles('#wb-probe', path);
  return page.evaluate(async () => {
    const wasm = (await import('/@id/@lopsy/engine-pkg/lopsy_wasm.js')) as {
      default: () => Promise<unknown>;
      rafWhiteBalancePresets: (data: Uint8Array) => string;
      rafWhiteBalanceKelvin: (data: Uint8Array) => string;
    };
    await wasm.default();
    const file = document.querySelector<HTMLInputElement>('#wb-probe')?.files?.[0];
    if (!file) throw new Error('no file');
    const data = new Uint8Array(await file.arrayBuffer());
    return { presets: JSON.parse(wasm.rafWhiteBalancePresets(data)), kelvin: JSON.parse(wasm.rafWhiteBalanceKelvin(data)) };
  });
}

test.describe('White balance on a RAF', () => {
  const sample = samplePath();
  test.skip(!sample, `Set LOPSY_RAF_SAMPLES to a directory holding ${SAMPLE} to run this test`);
  test.setTimeout(10 * 60_000);

  test('lists the body presets, applies Daylight, and reads Temperature in Kelvin', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');
    await waitForReady(page, 120_000);
    const expected = await engineWhiteBalance(page, sample ?? '');
    expect(expected.presets.length).toBeGreaterThan(3);
    expect(expected.kelvin).not.toBeNull();

    // The menu: As shot, Auto, then the body's presets in the engine's order, then Custom.
    const mode = page.getByLabel('White balance mode');
    await expect(mode).toHaveValue('asShot');
    const options = await mode.locator('option').allTextContents();
    expect(options).toEqual(['As shot', 'Auto', ...expected.presets.map((p) => p.name), 'Custom']);
    expect(options.indexOf('Daylight')).toBeLessThan(options.indexOf('Cloudy'));

    // As shot reads as the camera's Kelvin.
    const temperature = page.getByLabel('Temperature value');
    const asShot = Number((await temperature.inputValue()).replace(' K', ''));
    expect(Math.abs(asShot - 4970)).toBeLessThanOrEqual(100);
    expect(Math.abs(asShot - expected.kelvin!.asShotKelvin)).toBeLessThanOrEqual(25);

    // Daylight sets the preset's Temperature and Tint as one step.
    const daylight = expected.presets.find((p) => p.name === 'Daylight')!;
    await mode.selectOption({ label: 'Daylight' });
    await expect(mode).toHaveValue('preset:daylight');
    const scale = expected.kelvin!;
    const daylightKelvin = 1e6 / (scale.miredAtZero + scale.miredPerUnit * daylight.temperature);
    await expect(temperature).toHaveValue(`${Math.round(daylightKelvin / 50) * 50} K`);
    expect(await page.evaluate(() => window.__photosHarness?.recipe?.whiteBalance)).toEqual({
      mode: 'custom',
      temperature: daylight.temperature,
      tint: daylight.tint,
    });

    // A typed Kelvin round-trips through the recipe's units.
    await temperature.fill('6500');
    await temperature.press('Enter');
    await expect(temperature).toHaveValue('6500 K');
    await expect(mode).toHaveValue('custom');
    expect(await page.evaluate(() => window.__photosHarness?.steps)).toEqual(['White balance: Daylight', expect.stringMatching(/^Temperature /)]);
  });
});
