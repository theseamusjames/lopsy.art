import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { imageStats, openHarness, raiseExposure, waitForPreview, waitForReady } from './harness';

/**
 * A real Fujifilm RAF (40 MP X-Trans, about 85 MB) through the worker-pool
 * decode. The samples are not in the repository: point LOPSY_RAF_SAMPLES at
 * a directory of them (github.com/theseamusjames/sample-raf-images).
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

  test('decodes, shows a real image and responds to Exposure', async ({ page }) => {
    await openHarness(page);
    await page.getByTestId('harness-file').setInputFiles(sample ?? '');
    await expect(page.getByRole('progressbar', { name: 'Loading' })).toBeVisible();
    await waitForReady(page, 10 * 60_000);

    await waitForPreview(page, 0, 5 * 60_000);
    const before = await imageStats(page, { kind: 'preview', index: 0, which: 'screen' });
    expect(Math.max(before.width, before.height)).toBe(2048);
    expect(before.mean).toBeGreaterThan(5);
    expect(before.mean).toBeLessThan(250);
    expect(before.spread).toBeGreaterThan(5);

    await raiseExposure(page, 10);
    await expect(page.getByLabel('Exposure value')).toHaveValue('+1.00');
    await waitForPreview(page, 1, 5 * 60_000);
    const after = await imageStats(page, { kind: 'preview', index: 1, which: 'screen' });
    expect(after.mean).toBeGreaterThan(before.mean + 10);
  });
});
