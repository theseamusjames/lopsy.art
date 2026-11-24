import { expect, test, type Page } from '@playwright/test';
import { openFlatImage, openGeneratedImage, openHarness, waitForReady } from './harness';
import { suiteRenderer } from './gpu-args';

/**
 * The screen-only views (the clipping warning, the sharpening mask, a
 * mask's red overlay) against the reads that run while they are on
 * (src/engine/screen-views.ts): an export never has them, however many
 * reads come and go while it waits, and on the working space the pixel
 * readout and the histogram never take them off the screen.
 */

/** Moves the pointer about over the middle of the photo until `stop` is called, so the readout keeps sampling. */
function hoverPhoto(page: Page): { stop: () => Promise<void> } {
  let isHovering = true;
  const done = (async () => {
    const box = await page.getByTestId('edit-canvas').boundingBox();
    if (!box) throw new Error('no canvas');
    let step = 0;
    while (isHovering) {
      step = (step + 1) % 20;
      await page.mouse.move(box.x + box.width * (0.3 + step * 0.02), box.y + box.height * 0.5);
      await page.waitForTimeout(25);
    }
  })();
  return {
    stop: async () => {
      isHovering = false;
      await done;
    },
  };
}

/** Pixels of the harness's export `index` that are clearly coloured: the photo is grey, the warnings red and blue. */
async function colouredPixels(page: Page, index: number): Promise<number> {
  return page.evaluate(async (n) => {
    const blob = window.__photosHarness?.exports[n]?.blob;
    if (!blob) throw new Error('no export');
    const bitmap = await createImageBitmap(blob, { resizeWidth: 600, resizeHeight: 400 });
    const canvas = new OffscreenCanvas(600, 400);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, 600, 400).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 60) count++;
    }
    return count;
  }, index);
}

test('an export waiting for the full size has no clipping colours while the readout samples', async ({ page }) => {
  test.setTimeout(240_000);
  await openHarness(page);
  // Black to white with a white block, larger than the working image: the export loads the full size first.
  await openGeneratedImage(page, 5600, 3600, 'image/jpeg', ['#000000', '#ffffff', '#ffffff']);
  await waitForReady(page, 120_000);
  await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('data-clipped', 'true');
  await page.getByTestId('clip-highlights').click();
  await page.getByTestId('clip-shadows').click();
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('clip-shadows')).toHaveAttribute('aria-pressed', 'true');

  const hover = hoverPhoto(page);
  await expect(page.getByTestId('pixel-readout')).toBeVisible();
  // From the keyboard, so the pointer stays on the photo.
  await page.getByTestId('edit-view').getByRole('button', { name: 'Export', exact: true }).press('Enter');
  await page.waitForFunction(() => (window.__photosHarness?.exports.length ?? 0) > 0, undefined, { timeout: 180_000 });
  await hover.stop();
  expect(await colouredPixels(page, 0)).toBe(0);
});

test('hovering the photo never takes the clipping warning off the screen, nor draws it again', async ({ page }) => {
  await openHarness(page);
  await openFlatImage(page, '#ffffff');
  await waitForReady(page);
  await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('clip-highlights').click();
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('aria-pressed', 'true');

  // The canvas as shown, again and again: red all over while the warning is on.
  const canvas = page.getByTestId('edit-canvas');
  const redShare = async (): Promise<number> => {
    const png = await canvas.screenshot();
    return page.evaluate(async (base64) => {
      const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob, { resizeWidth: 32, resizeHeight: 32 });
      const copy = new OffscreenCanvas(32, 32);
      const ctx = copy.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let red = 0;
      for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) > 180 && (data[i + 1] ?? 0) < 90 && (data[i + 2] ?? 0) < 90) red += 1;
      return red / (data.length / 4);
    }, png.toString('base64'));
  };
  // The photo fills a part of the canvas (it is fitted), all of it red.
  await expect.poll(redShare, { timeout: 15_000 }).toBeGreaterThan(0.2);
  const shown = await redShare();

  await page.evaluate(() => {
    const counts = window.__lopsyRenderCounts;
    if (counts) for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] = 0;
  });
  const hover = hoverPhoto(page);
  await expect(page.getByTestId('pixel-readout')).toBeVisible();
  const shares: number[] = [];
  for (let i = 0; i < 25; i++) shares.push(await redShare());
  await hover.stop();
  // Every look while the readout samples shows the warning as it was before.
  expect(shares.filter((share) => share < shown - 0.1)).toEqual([]);
  // With the working space (always on WebGPU) a sample reads the kept image: the screen is not drawn again for it.
  if (suiteRenderer === 'wgpu') {
    const counts = await page.evaluate(() => window.__lopsyRenderCounts);
    expect((counts?.screen ?? 0) + (counts?.histogram ?? 0)).toBeLessThanOrEqual(3);
  }
  // And the readout reads the photo, not the red.
  const [r = 0, g = 0, b = 0] = ((await page.getByTestId('pixel-readout').textContent()) ?? '').match(/\d+/g)?.map(Number) ?? [];
  expect(Math.min(r, g, b)).toBeGreaterThan(245);
});
