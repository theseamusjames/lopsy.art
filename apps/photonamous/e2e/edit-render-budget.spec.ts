import { expect, test, type Page } from './test';
import { openGeneratedImage, openHarness, waitForPreview, waitForReady } from './harness';

/**
 * The GPU work one edit costs (src/engine/render-counts.ts, on the window
 * in development builds). A committed change gets one screen render and one
 * histogram read; the stored previews (512 and 2048 px) are encoded once,
 * after the edit has settled, and never for a slider draft.
 */

interface Counts {
  screen: number;
  histogram: number;
  offscreen: number;
  restore: number;
  readback: number;
  histogramReads: number;
  previewEncodes: number;
}

async function resetCounts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const counts = (window as unknown as { __lopsyRenderCounts?: Record<string, number> }).__lopsyRenderCounts;
    if (!counts) throw new Error('render counts are not on the window (a development build is needed)');
    for (const key of Object.keys(counts)) counts[key] = 0;
  });
}

async function counts(page: Page): Promise<Counts> {
  return page.evaluate(() => ({ ...(window as unknown as { __lopsyRenderCounts: Counts }).__lopsyRenderCounts }));
}

async function previewCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__photosHarness?.previews.length ?? 0);
}

async function setValue(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}

/** Waits until the previews stop changing: the edit has settled and nothing more is rendered. */
async function settle(page: Page): Promise<void> {
  let last = -1;
  for (;;) {
    const now = await previewCount(page);
    if (now === last) return;
    last = now;
    await page.waitForTimeout(3000);
  }
}

test('one committed change: one screen render, one histogram read, previews once it settles', async ({ page }) => {
  test.setTimeout(600_000);
  await openHarness(page);
  // 3600 × 2400, edited at the working size, with sharpening and local contrast on: the heavy case.
  await openGeneratedImage(page, 3600, 2400);
  await waitForReady(page, 120_000);
  await waitForPreview(page, 0, 120_000);
  await setValue(page, 'Sharpen', '120');
  await setValue(page, 'Large details', '50');
  await settle(page);

  // A typed value is one committed change.
  const before = await previewCount(page);
  await resetCounts(page);
  const started = Date.now();
  await setValue(page, 'Exposure', '0.5');
  await expect.poll(() => counts(page).then((c) => c.histogramReads), { timeout: 120_000 }).toBeGreaterThan(0);
  const histogramMs = Date.now() - started;
  await waitForPreview(page, before, 300_000);
  const previewsMs = Date.now() - started;
  await settle(page);
  const settled = await counts(page);
  console.log(`One committed change: histogram after ${histogramMs} ms, previews after ${previewsMs} ms`);
  console.log(`  counts once settled: ${JSON.stringify(settled)}`);

  expect(settled.histogramReads).toBe(1);
  // The histogram reads the frame the screen render made; it renders nothing of its own.
  expect(settled.histogram).toBe(0);
  expect(settled.previewEncodes).toBe(2);
  // One screen render for the change; the previews draw both sizes, then put the view back once.
  expect(settled.screen).toBe(1);
  expect(settled.offscreen).toBe(2);
  expect(settled.restore).toBe(1);
  expect(await previewCount(page)).toBe(before + 1);

  // Two committed changes in one go (Undo twice, in one task) render and settle once.
  const beforePair = await previewCount(page);
  await resetCounts(page);
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  });
  await expect(page.getByLabel('Exposure value', { exact: true })).toHaveValue('0.00');
  await settle(page);
  const pair = await counts(page);
  console.log(`  counts for two changes at once: ${JSON.stringify(pair)}`);
  expect(pair.screen).toBe(1);
  expect(pair.histogramReads).toBe(1);
  expect(pair.previewEncodes).toBe(2);
  expect(await previewCount(page)).toBe(beforePair + 1);

  // A slider drag is a draft: screen renders only, no histogram and no previews until it is let go.
  await resetCounts(page);
  const slider = page.getByRole('slider', { name: 'Exposure' });
  const box = await slider.boundingBox();
  if (!box) throw new Error('no Exposure slider');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.6, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + box.width * (0.6 + i * 0.02), y);
    await page.waitForTimeout(300);
  }
  const dragging = await counts(page);
  await page.mouse.up();
  console.log(`  counts during a drag: ${JSON.stringify(dragging)}`);
  expect(dragging.previewEncodes).toBe(0);
  expect(dragging.histogramReads).toBe(0);
  expect(dragging.screen).toBeGreaterThan(0);
  await settle(page);
  const released = await counts(page);
  expect(released.histogramReads).toBe(1);
  expect(released.previewEncodes).toBe(2);
});
