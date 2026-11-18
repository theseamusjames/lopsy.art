import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { imageStats, openHarness, raiseExposure, waitForPreview, waitForReady } from './harness';

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

  test('shows a first view quickly, then develops with white balance and exposure', async ({ page }) => {
    await openHarness(page);
    const started = Date.now();
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');

    // The binned first view: editable before the full-size decode is done.
    await expect(page.getByTestId('refining-badge')).toBeVisible({ timeout: 20_000 });
    const quickMs = Date.now() - started;
    await expect(page.getByRole('slider', { name: 'Exposure' })).not.toHaveAttribute('aria-disabled', 'true');
    const temperature = page.getByLabel('Temperature value');
    await temperature.fill('60');
    await temperature.press('Enter');

    await waitForReady(page, 10 * 60_000);
    const fullMs = Date.now() - started;
    test.info().annotations.push({ type: 'timing', description: `first view ${quickMs} ms, full resolution ${fullMs} ms` });
    console.log(`RAF first view after ${quickMs} ms, full resolution after ${fullMs} ms`);

    // The edit made during the decode applies to the full-size image.
    await waitForPreview(page, 0, 5 * 60_000);
    const warm = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    expect(Math.max(warm.width, warm.height)).toBe(2048);
    expect(warm.mean).toBeGreaterThan(5);
    expect(warm.mean).toBeLessThan(250);
    expect(warm.spread).toBeGreaterThan(5);

    await temperature.fill('-60');
    await temperature.press('Enter');
    await waitForPreview(page, 1, 5 * 60_000);
    const cool = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect(warm.red - warm.blue).toBeGreaterThan(cool.red - cool.blue + 10);
    // White balance in camera space moves colour, not brightness.
    expect(Math.abs(warm.mean - cool.mean)).toBeLessThan(25);

    // RAW gets the camera's profiles and Auto white balance.
    const profiles = page.getByRole('combobox', { name: 'Profile' }).locator('option');
    await expect(profiles).toContainText(['Camera', 'Velvia', 'Neutral', 'Monochrome']);
    await page.getByRole('button', { name: 'Auto White balance' }).click();
    await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps.at(-1))).toBe('Auto white balance');
    await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');
    await waitForPreview(page, 2, 5 * 60_000);
    const balanced = await imageStats(page, { kind: 'preview', index: 2, which: 'screen' });

    await raiseExposure(page, 10);
    await expect(page.getByLabel('Exposure value')).toHaveValue('+1.00');
    await waitForPreview(page, 3, 5 * 60_000);
    const bright = await imageStats(page, { kind: 'preview', index: 3, which: 'screen' });
    expect(bright.mean).toBeGreaterThan(balanced.mean + 10);

    // An engine profile changes the develop settings: Monochrome drops the colour.
    await page.getByRole('combobox', { name: 'Profile' }).selectOption('monochrome');
    await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps.at(-1))).toBe('Profile: Monochrome');
    await waitForPreview(page, 4, 5 * 60_000);
    const mono = await imageStats(page, { kind: 'preview', index: 4, which: 'screen' });
    expect(Math.abs(mono.red - mono.blue)).toBeLessThan(4);
    expect(Math.abs(mono.red - mono.green)).toBeLessThan(4);
  });
});
