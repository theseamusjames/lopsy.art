// #1610 — Layer thumbnails were a single LINEAR blit of the whole layer into
// a 24 px target: one 2x2 tap per thumbnail pixel. A fine regular pattern
// whose period matched the stride was sampled only at one phase, so a white
// layer ruled with thin black lines showed as a solid black thumbnail. Each
// thumbnail pixel now averages its whole source footprint.

import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  createDocument,
  docToScreen,
  getEditorState,
  setForegroundColor,
  waitForStore,
} from './helpers';

// 576 px wide → a 24 px thumbnail samples every 24 px, the pattern's period.
const DOC_W = 576;
const DOC_H = 288;
const TILE = 24;

async function menu(page: Page, top: string, item: string): Promise<void> {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

/** Exact rectangular selection through the marquee's click-to-enter dialog. */
async function selectExact(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  const pt = await docToScreen(page, DOC_W / 2, DOC_H / 2);
  await page.mouse.click(pt.x, pt.y);
  const dialog = page.getByRole('dialog', { name: 'Rectangular Selection' });
  await dialog.getByLabel('From X').fill(String(x0));
  await dialog.getByLabel('From Y').fill(String(y0));
  await dialog.getByLabel('To X').fill(String(x1));
  await dialog.getByLabel('To Y').fill(String(y1));
  await dialog.getByRole('button', { name: 'Select' }).click();
  await expect(dialog).toBeHidden();
}

async function fillExact(page: Page, x0: number, y0: number, x1: number, y1: number, grey: number): Promise<void> {
  await setForegroundColor(page, grey, grey, grey);
  await selectExact(page, x0, y0, x1, y1);
  await menu(page, 'Edit', 'Fill');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

/** Mean red of the layer's opaque pixels, read from its GPU texture. */
async function layerMeanRed(page: Page, layerId: string): Promise<{ mean: number; count: number }> {
  return page.evaluate(async (lid) => {
    const read = (window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    }).__readLayerPixels;
    const r = await read(lid);
    if (!r) return { mean: -1, count: 0 };
    let sum = 0;
    let count = 0;
    for (let i = 0; i < r.pixels.length; i += 4) {
      if ((r.pixels[i + 3] ?? 0) < 250) continue;
      sum += r.pixels[i] ?? 0;
      count++;
    }
    return { mean: count ? sum / count : -1, count };
  }, layerId);
}

/** Mean red of the opaque pixels of the layer's panel thumbnail. */
async function thumbnailMeanRed(page: Page, layerId: string): Promise<number> {
  return page.evaluate((lid) => {
    const canvas = document.querySelector(`[data-layer-id="${lid}"] canvas`) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return -1;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 250) continue;
      sum += data[i] ?? 0;
      count++;
    }
    return count ? sum / count : -1;
  }, layerId);
}

test.describe('#1610 layer thumbnail of a fine pattern', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('averages the pattern instead of sampling one phase of it', async ({ page }) => {
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    const layerId = (await getEditorState(page)).document.activeLayerId;

    // One tile: white with a 4 px black line through its middle.
    await fillExact(page, 0, 0, TILE, TILE, 255);
    await fillExact(page, 10, 0, 14, TILE, 0);
    await selectExact(page, 0, 0, TILE, TILE);
    await menu(page, 'Edit', 'Define Pattern');
    await page.keyboard.press('Control+d');

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Fill with Pattern...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Pattern Fill' });
    await dialog.locator('button[class*="patternSwatch"]').first().click();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    // Leave the layer so it is cropped and its thumbnail re-read.
    await addLayer(page);
    await page.waitForTimeout(500);

    const layer = await layerMeanRed(page, layerId);
    expect(layer.count).toBe(DOC_W * DOC_H);
    // 20 of every 24 columns are white.
    expect(layer.mean).toBeGreaterThan(200);
    expect(layer.mean).toBeLessThan(225);

    await expect
      .poll(async () => Math.abs((await thumbnailMeanRed(page, layerId)) - layer.mean), { timeout: 5000 })
      .toBeLessThan(12);
  });
});
