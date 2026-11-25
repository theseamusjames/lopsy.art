import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './test';
import { imageStats, openHarness, previewCount, raiseExposure, settledPreview, waitForPreview, waitForReady, type ImageStats } from './harness';
import type { Page } from './test';

/** Makes an edit and measures the screen preview rendered for it, once the edit has settled. */
async function previewAfter(page: Page, edit: () => Promise<void>): Promise<ImageStats> {
  const from = await previewCount(page);
  await edit();
  await waitForPreview(page, from, 5 * 60_000);
  const index = await settledPreview(page, from);
  return imageStats(page, { kind: 'preview', index, which: 'screen' });
}

/**
 * A real Fujifilm RAF (40 MP X-Trans, about 85 MB) through the worker-pool
 * decode and the engine's RAW develop stage. The samples are not in the
 * repository: point LOPSY_RAF_SAMPLES at a directory of them
 * (github.com/theseamusjames/sample-raf-images).
 *
 * Only previews are read back (2048 px at most): a full-size export of a
 * 40 MP image would hold several hundred MB in the page.
 */
const samples = process.env.LOPSY_RAF_SAMPLES;

function firstSample(): string | null {
  if (!samples || !existsSync(samples)) return null;
  const name = readdirSync(samples)
    .filter((f) => f.toLowerCase().endsWith('.raf'))
    .sort()[0];
  return name ? join(samples, name) : null;
}

test.describe('Edit view on a RAF', () => {
  const sample = firstSample();
  test.skip(!sample, 'Set LOPSY_RAF_SAMPLES to a directory of RAF files to run this test');
  test.setTimeout(15 * 60_000);

  test('edits a working image, then develops with white balance and exposure', async ({ page }) => {
    await openHarness(page);
    const started = Date.now();
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');

    // The working image (spec 6.10): the binned frame, editable without a full-size decode.
    await waitForReady(page, 60_000);
    const readyMs = Date.now() - started;
    test.info().annotations.push({ type: 'timing', description: `working image ready after ${readyMs} ms` });
    console.log(`RAF working image ready after ${readyMs} ms`);
    expect(readyMs).toBeLessThan(45_000);
    // Fit shows the photo far below 50 % of its full size.
    const fitPercent = Number((await page.getByTestId('zoom-readout').inputValue()).replace('%', ''));
    expect(fitPercent).toBeLessThan(50);

    // On a RAW file the Temperature field reads and takes Kelvin.
    const temperature = page.getByLabel('Temperature value');
    await expect(temperature).toHaveValue(/ K$/);
    const warm = await previewAfter(page, async () => {
      await temperature.fill('7500');
      await temperature.press('Enter');
    });
    expect(Math.max(warm.width, warm.height)).toBe(2048);
    expect(warm.mean).toBeGreaterThan(5);
    expect(warm.mean).toBeLessThan(250);
    expect(warm.spread).toBeGreaterThan(5);

    const cool = await previewAfter(page, async () => {
      await temperature.fill('3500');
      await temperature.press('Enter');
    });
    expect(warm.red - warm.blue).toBeGreaterThan(cool.red - cool.blue + 10);
    // White balance in camera space moves colour, not brightness.
    expect(Math.abs(warm.mean - cool.mean)).toBeLessThan(25);

    // RAW gets the camera's profiles and Auto white balance.
    const profiles = page.getByRole('combobox', { name: 'Profile' }).locator('option');
    // The camera's own look first (not listed twice), Provia as Standard, then Neutral and Monochrome.
    await expect(profiles).toContainText(['Camera', 'Standard (Provia look)', 'Neutral', 'Monochrome']);
    const balanced = await previewAfter(page, async () => {
      await page.getByLabel('White balance mode').selectOption('auto');
      await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps.at(-1))).toBe('White balance: Auto');
    });
    await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');

    const exposureStart = Date.now();
    const from = await previewCount(page);
    await raiseExposure(page, 10);
    await expect(page.getByLabel('Exposure value')).toHaveValue('+1.00');
    await waitForPreview(page, from, 5 * 60_000);
    const exposureMs = Date.now() - exposureStart;
    console.log(`RAF exposure change to its settled preview: ${exposureMs} ms`);
    test.info().annotations.push({ type: 'timing', description: `exposure change settled in ${exposureMs} ms` });
    const bright = await imageStats(page, { kind: 'preview', index: await settledPreview(page, from), which: 'screen' });
    expect(bright.mean).toBeGreaterThan(balanced.mean + 10);

    // An engine profile changes the develop settings: Monochrome drops the colour.
    const mono = await previewAfter(page, async () => {
      await page.getByRole('combobox', { name: 'Profile' }).selectOption('monochrome');
      await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps.at(-1))).toBe('Profile: Monochrome');
    });
    expect(Math.abs(mono.red - mono.blue)).toBeLessThan(4);
    expect(Math.abs(mono.red - mono.green)).toBeLessThan(4);
  });

  test('100 % loads the full resolution', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');
    await waitForReady(page, 60_000);
    const started = Date.now();
    await page.getByRole('button', { name: 'Full', exact: true }).click();
    await expect(page.getByTestId('loading-badge')).toHaveText('Loading full resolution…', { timeout: 30_000 });
    await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 10 * 60_000 });
    console.log(`RAF full resolution after ${Date.now() - started} ms`);
    await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
  });
});
