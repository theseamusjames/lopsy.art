import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setForegroundColor,
  selectTool,
  addLayer,
} from './helpers';

// #1268 — Image → Flip Horizontal / Vertical on a raster layer mirrored its
// content across the whole document: the active layer's texture is held at
// document size, so mirroring the texture within itself sent content at
// columns 100..299 to 900..1099. The flip must mirror the content about its
// own bounds, leaving it where it was.

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function marqueeFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await drag(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

async function imageMenu(page: Page, item: 'Flip Horizontal' | 'Flip Vertical'): Promise<void> {
  await page.getByRole('button', { name: /^Image$/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${item}$`) }).click();
  await page.waitForTimeout(300);
}

interface Box { count: number; x0: number; x1: number; y0: number; y1: number }
interface Scan { red: Box; blue: Box; other: number }

/**
 * Classify the opaque texels of a layer's GPU texture and report each
 * colour's extent in **document** space (texture coords + the layer's x/y).
 */
async function scanLayerInDocument(page: Page, layerId: string): Promise<Scan> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid)!;
    const read = w.__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await read(lid);
    const empty = (): Box => ({ count: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
    const out = { red: empty(), blue: empty(), other: 0 };
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const i = (y * r.width + x) * 4;
        if (r.pixels[i + 3]! < 200) continue;
        const red = r.pixels[i]!;
        const green = r.pixels[i + 1]!;
        const blue = r.pixels[i + 2]!;
        let box: Box | null = null;
        if (red > 200 && green < 60 && blue < 60) box = out.red;
        else if (blue > 200 && red < 60 && green < 60) box = out.blue;
        if (!box) { out.other++; continue; }
        const dx = x + layer.x;
        const dy = y + layer.y;
        box.count++;
        box.x0 = Math.min(box.x0, dx);
        box.x1 = Math.max(box.x1, dx);
        box.y0 = Math.min(box.y0, dy);
        box.y1 = Math.max(box.y1, dy);
      }
    }
    return out;
  }, layerId);
}

function union(a: Box, b: Box): { x0: number; x1: number; y0: number; y1: number } {
  return {
    x0: Math.min(a.x0, b.x0),
    x1: Math.max(a.x1, b.x1),
    y0: Math.min(a.y0, b.y0),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * The issue's repro on a 1200×1800 white document: on Layer 1, a red box
 * over (100,300)-(300,600) with a blue notch in its top-left corner, so a
 * mirror is unambiguous.
 */
async function paintRepro(page: Page): Promise<{ layerId: string; before: Scan }> {
  await createDocument(page, 1200, 1800, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
  const layerId = await addLayer(page);
  await setForegroundColor(page, 255, 0, 0);
  await marqueeFill(page, 100, 300, 300, 600);
  await setForegroundColor(page, 0, 0, 255);
  await marqueeFill(page, 100, 300, 160, 360);

  const before = await scanLayerInDocument(page, layerId);
  expect(before.other).toBe(0);
  const all = union(before.red, before.blue);
  // The box spans roughly 100..299 × 300..599 (the zoomed-out drag may land a
  // pixel either side), with the notch in the top-left corner.
  expect(Math.abs(all.x0 - 100)).toBeLessThanOrEqual(2);
  expect(Math.abs(all.x1 - 299)).toBeLessThanOrEqual(2);
  expect(Math.abs(all.y0 - 300)).toBeLessThanOrEqual(2);
  expect(Math.abs(all.y1 - 599)).toBeLessThanOrEqual(2);
  expect(before.blue.x0).toBe(all.x0);
  expect(before.blue.y0).toBe(all.y0);
  expect(before.blue.count).toBeGreaterThan(2500);
  return { layerId, before };
}

test.describe('Image → Flip mirrors a layer in place (#1268)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar is hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('Flip Horizontal keeps the content at the same columns, mirrored', async ({ page }) => {
    const { layerId, before } = await paintRepro(page);
    const box = union(before.red, before.blue);

    await imageMenu(page, 'Flip Horizontal');
    await page.screenshot({ path: 'e2e/screenshots/flip-layer-in-place-1268-h.png' });

    const after = await scanLayerInDocument(page, layerId);
    expect(after.other).toBe(0);
    expect(after.red.count).toBe(before.red.count);
    expect(after.blue.count).toBe(before.blue.count);
    // The content did not move across the document.
    expect(union(after.red, after.blue)).toEqual(box);
    // The notch moved from the top-left to the top-right corner: column
    // p went to box.x0 + box.x1 − p, rows unchanged.
    expect(after.blue.x1).toBe(box.x1);
    expect(after.blue.x0).toBe(box.x0 + box.x1 - before.blue.x1);
    expect(after.blue.y0).toBe(before.blue.y0);
    expect(after.blue.y1).toBe(before.blue.y1);

    // Undo puts the notch back on the left.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await scanLayerInDocument(page, layerId);
    expect(undone.blue).toEqual(before.blue);
    expect(undone.red).toEqual(before.red);

    // Redo mirrors in place again.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    const redone = await scanLayerInDocument(page, layerId);
    expect(redone.blue).toEqual(after.blue);
    expect(redone.red).toEqual(after.red);
  });

  test('Flip Vertical keeps the content at the same rows, mirrored', async ({ page }) => {
    const { layerId, before } = await paintRepro(page);
    const box = union(before.red, before.blue);

    await imageMenu(page, 'Flip Vertical');
    await page.screenshot({ path: 'e2e/screenshots/flip-layer-in-place-1268-v.png' });

    const after = await scanLayerInDocument(page, layerId);
    expect(after.other).toBe(0);
    expect(after.red.count).toBe(before.red.count);
    expect(after.blue.count).toBe(before.blue.count);
    expect(union(after.red, after.blue)).toEqual(box);
    // The notch moved from the top-left to the bottom-left corner.
    expect(after.blue.y1).toBe(box.y1);
    expect(after.blue.y0).toBe(box.y0 + box.y1 - before.blue.y1);
    expect(after.blue.x0).toBe(before.blue.x0);
    expect(after.blue.x1).toBe(before.blue.x1);

    // Flipping back restores the original exactly.
    await imageMenu(page, 'Flip Vertical');
    const twice = await scanLayerInDocument(page, layerId);
    expect(twice.blue).toEqual(before.blue);
    expect(twice.red).toEqual(before.red);
  });
});
