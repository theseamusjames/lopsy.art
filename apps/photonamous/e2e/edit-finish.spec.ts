import { expect, test, type Page } from '@playwright/test';
import { imageStats, openGeneratedImage, openHarness, waitForReady } from './harness';

/**
 * Finish group (spec 5.4): vignette shape and grain. Grain is seeded per
 * photo, so two exports of the same photo have exactly the same grain.
 */

async function setValue(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByLabel(`${label} value`);
  if (!(await readout.isVisible())) await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await readout.fill(value);
  await readout.press('Enter');
}

async function exportBytes(page: Page, index: number): Promise<string> {
  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction((n) => (window.__photosHarness?.exports.length ?? 0) > n, index);
  return page.evaluate(async (n) => {
    const blob = window.__photosHarness?.exports[n]?.blob;
    if (!blob) throw new Error('no export');
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }, index);
}

test('grain is the same in every export of a photo, and the vignette shape changes the corners', async ({ page }) => {
  await openHarness(page);
  // A flat mid grey: grain is the only texture, the vignette the only gradient.
  await openGeneratedImage(page, 480, 320, 'image/png', ['#808080', '#808080', '#808080']);
  await waitForReady(page);

  const plain = await exportBytes(page, 0);
  await setValue(page, 'Grain', '60');
  const grainy = await exportBytes(page, 1);
  const again = await exportBytes(page, 2);
  expect(grainy).not.toBe(plain);
  expect(again).toBe(grainy);
  expect((await imageStats(page, { kind: 'export', index: 1 })).spread).toBeGreaterThan((await imageStats(page, { kind: 'export', index: 0 })).spread);

  await setValue(page, 'Grain', '0');
  await setValue(page, 'Vignette', '60');
  await exportBytes(page, 3);
  const vignette = await imageStats(page, { kind: 'export', index: 3 });
  await setValue(page, 'Midpoint', '10');
  await exportBytes(page, 4);
  const smaller = await imageStats(page, { kind: 'export', index: 4 });
  // A positive vignette darkens; a smaller midpoint darkens more of the frame.
  expect(vignette.mean).toBeLessThan(128);
  expect(smaller.mean).toBeLessThan(vignette.mean);
});
