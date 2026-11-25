import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from './test';
import { openHarness, waitForReady } from './harness';
import { generatedJpeg, importFiles, tiles } from './library';
import { setMaskValue } from './masks';

/**
 * The Edit view edits a working image (spec 6.10) and loads the full size
 * for a full-size export. Everything sized in pixels (sharpening and local
 * contrast radii, masks, straighten, the crop) must follow it there, so the
 * Edit view's export matches the export renderer's, which loads the full
 * size from the start.
 *
 * No straighten here: its inscribed crop makes the document smaller than
 * the 2048 px preview, whose render would load the full size before
 * Export does.
 */

/** Larger than the working image (at least 2048 px), so the Edit view opens below full size. */
const WIDTH = 3000;
const HEIGHT = 2000;

async function setValue(page: Page, label: string, value: string): Promise<void> {
  const readout = page.getByTestId('edit-view').getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
  await expect(readout).not.toBeFocused();
}

/** Sized in pixels: a mask and sharpening at its largest radius. */
async function makeEdits(page: Page): Promise<void> {
  await page.keyboard.press('m');
  await setMaskValue(page, 'Mask 1', 'Exposure', '-1.5');
  // The mask has its own panel: back to the Edit panel for sharpening.
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await setValue(page, 'Sharpen', '150');
  await setValue(page, 'Radius', '3');
  await expect(page.getByTestId('edit-view').getByTestId('history-list').getByRole('button', { name: /^Sharpen radius/ })).toBeVisible();
}

async function bytesOf(download: Download): Promise<string> {
  const path = await download.path();
  const bytes = await readFile(path);
  await download.delete();
  return bytes.toString('base64');
}

interface Compared {
  readonly width: number;
  readonly height: number;
  readonly otherWidth: number;
  readonly otherHeight: number;
  /** Mean difference of the two, scaled down to 150 px wide, per channel, 0..255. */
  readonly wholeMean: number;
  /** Largest difference of any pixel of the scaled-down pair. */
  readonly wholeMax: number;
  /** Largest difference between the two images' column averages across the circle's left edge, at full size. */
  readonly edgeMax: number;
  /** How much the edge strip's columns vary: the edge must be in it for edgeMax to mean anything. */
  readonly edgeRange: number;
}

/** Decodes both JPEGs in the page and compares them. */
async function compare(page: Page, a: string, b: string): Promise<Compared> {
  return page.evaluate(
    async ({ a, b, edgeX, edgeY }) => {
      const blobOf = (base64: string) => new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
      const pixels = async (blob: Blob, crop: [number, number, number, number] | null, w: number, h: number) => {
        const bitmap = crop
          ? await createImageBitmap(blob, crop[0], crop[1], crop[2], crop[3])
          : await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const [first, second] = [blobOf(a), blobOf(b)];
      const [sizeA, sizeB] = await Promise.all([createImageBitmap(first), createImageBitmap(second)]);
      const sw = 150;
      const sh = Math.round((sw * sizeA.height) / sizeA.width);
      const [smallA, smallB] = await Promise.all([pixels(first, null, sw, sh), pixels(second, null, sw, sh)]);
      let sum = 0;
      let max = 0;
      let count = 0;
      for (let i = 0; i < smallA.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs((smallA[i + c] ?? 0) - (smallB[i + c] ?? 0));
          sum += d;
          max = Math.max(max, d);
          count += 1;
        }
      }
      // A strip across the circle's left edge, at full size: column averages show sharpening's halo.
      const strip: [number, number, number, number] = [Math.round(edgeX * sizeA.width) - 200, Math.round(edgeY * sizeA.height) - 100, 400, 200];
      const [edgeA, edgeB] = await Promise.all([pixels(first, strip, 400, 200), pixels(second, strip, 400, 200)]);
      const columns = (data: Uint8ClampedArray) =>
        Array.from({ length: 400 }, (_, x) => {
          let total = 0;
          for (let y = 0; y < 200; y++) {
            const i = (y * 400 + x) * 4;
            total += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
          }
          return total / (200 * 3);
        });
      const colA = columns(edgeA);
      const colB = columns(edgeB);
      const edgeMax = Math.max(...colA.map((v, i) => Math.abs(v - (colB[i] ?? 0))));
      return {
        width: sizeA.width,
        height: sizeA.height,
        otherWidth: sizeB.width,
        otherHeight: sizeB.height,
        wholeMean: sum / count,
        wholeMax: max,
        edgeMax,
        edgeRange: Math.max(...colA) - Math.min(...colA),
      };
    },
    // generatedJpeg's circle: centre (0.65, 0.4) of the frame, radius 0.2 of its height.
    { a, b, edgeX: 0.65 - (0.2 * HEIGHT) / WIDTH, edgeY: 0.4 },
  );
}

test('a full-size export from the working image matches the export renderer’s', async ({ page }) => {
  test.setTimeout(480_000);
  const started = Date.now();
  const log = (what: string) => console.log(`${what}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  // The Edit view's own export is the Edit harness's (in the app, Export is the header's): the same photo, the same edits.
  await openHarness(page);
  const photo = await generatedJpeg(page, 200, WIDTH, HEIGHT);
  await page.getByTestId('harness-file').setInputFiles({ name: 'large.jpg', mimeType: 'image/jpeg', buffer: photo });
  await waitForReady(page, 120_000);
  log('ready');
  await makeEdits(page);

  // From the working image: it loads the full size first.
  await expect(page.getByTestId('loading-badge')).toHaveCount(0);
  await page.evaluate(() => {
    const seen = { isLoadingFull: false };
    (window as unknown as { __loadedFull: typeof seen }).__loadedFull = seen;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="loading-badge"]')?.textContent === 'Loading full resolution…') seen.isLoadingFull = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId('edit-view').getByRole('button', { name: 'Export', exact: true }).click();
  await page.waitForFunction(() => (window.__photosHarness?.exports.length ?? 0) > 0, undefined, { timeout: 300_000 });
  const editBytes = await page.evaluate(async () => {
    const blob = window.__photosHarness?.exports[0]?.blob;
    if (!blob) throw new Error('no export');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  });
  log('Edit view export');
  expect(await page.evaluate(() => (window as unknown as { __loadedFull: { isLoadingFull: boolean } }).__loadedFull.isLoadingFull)).toBe(true);

  // The export renderer: the library's Export, from the Edit view, the same JPEG quality, full size.
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'large.jpg', buffer: photo }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();
  await page.keyboard.press('Enter');
  await waitForReady(page, 120_000);
  await makeEdits(page);
  await page.getByRole('banner').getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('radio', { name: /^JPEG/ }).check();
  await page.getByRole('slider', { name: /Quality/ }).fill('92');
  await page.getByRole('combobox', { name: 'Size' }).selectOption({ label: 'Original size' });
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const fromRenderer = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const rendererBytes = await bytesOf(await fromRenderer);
  log('renderer export');

  const result = await compare(page, editBytes, rendererBytes);
  console.log(`Full-size export from the working image vs the renderer: ${JSON.stringify(result)}`);
  expect([result.width, result.height, result.otherWidth, result.otherHeight]).toEqual([WIDTH, HEIGHT, WIDTH, HEIGHT]);
  expect(result.edgeRange).toBeGreaterThan(30);
  expect(result.wholeMean).toBeLessThan(1);
  expect(result.wholeMax).toBeLessThanOrEqual(3);
  expect(result.edgeMax).toBeLessThanOrEqual(2);
});
