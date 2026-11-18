import { expect, test, type Page } from '@playwright/test';
import { openGeneratedImage, openHarness, waitForReady } from './harness';

/**
 * Clipping warnings (spec 5.4): the histogram's highlight and shadow
 * indicators, and J, paint clipped pixels on the live frame only.
 */

/** Pure-red pixels (the highlight warning's colour) in a PNG or JPEG, decoded in the page. */
async function redPixels(page: Page, image: { readonly png: string } | { readonly exportIndex: number }): Promise<number> {
  return page.evaluate(async (source) => {
    let blob: Blob | undefined;
    if ('png' in source) {
      const bytes = Uint8Array.from(atob(source.png), (c) => c.charCodeAt(0));
      blob = new Blob([bytes], { type: 'image/png' });
    } else {
      blob = window.__photosHarness?.exports[source.exportIndex]?.blob;
    }
    if (!blob) throw new Error('no image');
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 200 && (data[i + 1] ?? 0) < 70 && (data[i + 2] ?? 0) < 70) count++;
    }
    return count;
  }, image);
}

async function liveRed(page: Page): Promise<number> {
  const shot = await page.getByTestId('edit-view').locator('canvas').first().screenshot();
  return redPixels(page, { png: shot.toString('base64') });
}

test('the highlight warning paints blown pixels red on screen, never in the export', async ({ page }) => {
  await openHarness(page);
  // A grey-to-white gradient with a white square: plenty of pixels at white.
  await openGeneratedImage(page, 640, 480, 'image/jpeg', ['#404040', '#ffffff', '#ffffff']);
  await waitForReady(page);
  await expect(page.getByTestId('histogram')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('data-clipped', 'true');

  await expect.poll(() => liveRed(page)).toBe(0);
  await page.getByTestId('clip-highlights').click();
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => liveRed(page), { timeout: 15_000 }).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Export' }).click();
  await page.waitForFunction(() => (window.__photosHarness?.exports.length ?? 0) > 0);
  expect(await redPixels(page, { exportIndex: 0 })).toBe(0);

  // J: both on (highlights already were), then both off.
  await page.getByTestId('edit-view').locator('canvas').first().click();
  await page.keyboard.press('j');
  await expect(page.getByTestId('clip-shadows')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('j');
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => liveRed(page), { timeout: 15_000 }).toBe(0);
});

test('Alt while dragging Whites shows the highlight clipping for the drag only', async ({ page }) => {
  await openHarness(page);
  await openGeneratedImage(page, 640, 480, 'image/jpeg', ['#404040', '#ffffff', '#ffffff']);
  await waitForReady(page);
  const slider = page.getByRole('slider', { name: 'Whites' });
  const box = await slider.boundingBox();
  if (!box) throw new Error('no Whites slider');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 });
  await expect.poll(() => liveRed(page), { timeout: 15_000 }).toBeGreaterThan(1000);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect.poll(() => liveRed(page), { timeout: 15_000 }).toBe(0);
  await expect(page.getByTestId('clip-highlights')).toHaveAttribute('aria-pressed', 'false');
});
