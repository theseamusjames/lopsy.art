import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setForegroundColor,
  selectTool,
} from './helpers';

// #795 — Image → Flip Horizontal / Flip Vertical on a layer whose texture is
// not the document's size (a fresh paste, or a paste wider than the canvas)
// replaced the layer with a squashed copy of the whole composite: the flip
// went through a document-sized scratch buffer that was then stretched back
// into the layer's smaller texture. The flip must mirror the layer's own
// pixels inside its own bounds, and nothing from any other layer.

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

interface LayerGeometry { id: string; name: string; x: number; y: number; width: number; height: number }

async function activeLayer(page: Page): Promise<LayerGeometry> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: LayerGeometry[] } };
    };
    const doc = store.getState().document;
    const l = doc.layers.find((layer) => layer.id === doc.activeLayerId)!;
    return { id: l.id, name: l.name, x: l.x, y: l.y, width: l.width, height: l.height };
  });
}

interface ColorStats { count: number; sumX: number; sumY: number }
interface LayerScan { width: number; height: number; red: ColorStats; blue: ColorStats; other: number }

/**
 * Classify the opaque texels of a layer's GPU texture (texture-local coords).
 * Red and blue are the only colours painted on the source layer; anything
 * else opaque would be part of some other layer leaking in.
 */
async function scanLayer(page: Page, layerId: string): Promise<LayerScan> {
  return page.evaluate(async (lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await fn(lid);
    const out = {
      width: r.width,
      height: r.height,
      red: { count: 0, sumX: 0, sumY: 0 },
      blue: { count: 0, sumX: 0, sumY: 0 },
      other: 0,
    };
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const i = (y * r.width + x) * 4;
        if (r.pixels[i + 3]! < 200) continue;
        const red = r.pixels[i]!;
        const green = r.pixels[i + 1]!;
        const blue = r.pixels[i + 2]!;
        if (red > 200 && green < 60 && blue < 60) {
          out.red.count++; out.red.sumX += x; out.red.sumY += y;
        } else if (blue > 200 && red < 60 && green < 60) {
          out.blue.count++; out.blue.sumX += x; out.blue.sumY += y;
        } else {
          out.other++;
        }
      }
    }
    return out;
  }, layerId);
}

async function copyPaste(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<LayerGeometry> {
  await selectTool(page, 'marquee-rect');
  await drag(page, x0, y0, x1, y1);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  await expect.poll(async () => (await activeLayer(page)).name, { timeout: 30000 }).toMatch(/Paste/i);
  const pasted = await activeLayer(page);
  await expect.poll(async () => (await scanLayer(page, pasted.id)).red.count, { timeout: 30000 })
    .toBeGreaterThan(0);
  // The paste's marquee stays live, as it does for a user going straight to
  // the Image menu; the menu flip acts on the whole layer regardless.
  return pasted;
}

test.describe('Image → Flip on a pasted layer (#795)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menu bar is hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
  });

  test('Flip Horizontal mirrors a small pasted layer in place', async ({ page }) => {
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    // A big blue block far from the copied area, so a squashed composite
    // would drag blue (and the white background) into the paste.
    await setForegroundColor(page, 0, 0, 255);
    await marqueeFill(page, 450, 250, 650, 450);
    // The copied piece: a red bar 150..250 × 100..200 with a blue notch in
    // its top-left corner, so a horizontal mirror is unambiguous.
    await setForegroundColor(page, 255, 0, 0);
    await marqueeFill(page, 150, 100, 250, 200);
    await setForegroundColor(page, 0, 0, 255);
    await marqueeFill(page, 150, 100, 180, 130);

    // The paste lands as its own content-sized layer.
    const pasted = await copyPaste(page, 140, 90, 260, 210);
    const before = await scanLayer(page, pasted.id);
    expect(before.width).toBeLessThan(800);
    expect(before.other).toBe(0);
    expect(before.red.count).toBeGreaterThan(8000);
    expect(before.blue.count).toBeGreaterThan(800);
    // Notch on the left half before the flip.
    expect(before.blue.sumX / before.blue.count).toBeLessThan(before.width / 2);

    await imageMenu(page, 'Flip Horizontal');
    await page.screenshot({ path: 'e2e/screenshots/image-flip-pasted-layer-h.png' });

    const after = await scanLayer(page, pasted.id);
    const geomAfter = await activeLayer(page);
    // Same layer, same place.
    expect(geomAfter).toMatchObject({ x: pasted.x, y: pasted.y });
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    // Nothing from the background or the other block leaked in, and every
    // pasted texel survived.
    expect(after.other).toBe(0);
    expect(after.red.count).toBe(before.red.count);
    expect(after.blue.count).toBe(before.blue.count);
    // Each texel moved to x' = w - 1 - x; rows are unchanged.
    const w = before.width;
    expect(after.blue.sumX / after.blue.count)
      .toBeCloseTo(w - 1 - before.blue.sumX / before.blue.count, 1);
    expect(after.red.sumX / after.red.count)
      .toBeCloseTo(w - 1 - before.red.sumX / before.red.count, 1);
    expect(after.blue.sumY).toBe(before.blue.sumY);
  });

  test('Flip Vertical mirrors a paste wider than the document in place', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    // A full-width band 100..190 whose top 20 rows are red and the rest blue.
    await setForegroundColor(page, 0, 0, 255);
    await marqueeFill(page, 0, 100, 400, 190);
    await setForegroundColor(page, 255, 0, 0);
    await marqueeFill(page, 0, 100, 400, 120);
    // Something above the band that must not end up inside it.
    await marqueeFill(page, 0, 10, 400, 40);

    // A marquee hanging off both side edges, as in the issue's reflection repro.
    const pasted = await copyPaste(page, -5, 100, 405, 190);
    const before = await scanLayer(page, pasted.id);
    // Wider than the 400 px document: the off-canvas columns came along.
    expect(before.width).toBeGreaterThan(400);
    expect(before.other).toBe(0);
    expect(before.red.count).toBeGreaterThan(7000);
    expect(before.blue.count).toBeGreaterThan(25000);
    expect(before.red.sumY / before.red.count).toBeLessThan(before.height / 2);

    await imageMenu(page, 'Flip Vertical');
    await page.screenshot({ path: 'e2e/screenshots/image-flip-pasted-layer-v.png' });

    const after = await scanLayer(page, pasted.id);
    const geomAfter = await activeLayer(page);
    expect(geomAfter).toMatchObject({ x: pasted.x, y: pasted.y });
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.other).toBe(0);
    expect(after.red.count).toBe(before.red.count);
    expect(after.blue.count).toBe(before.blue.count);
    // Each texel moved to y' = h - 1 - y; columns are unchanged.
    const h = before.height;
    expect(after.red.sumY / after.red.count)
      .toBeCloseTo(h - 1 - before.red.sumY / before.red.count, 1);
    expect(after.blue.sumY / after.blue.count)
      .toBeCloseTo(h - 1 - before.blue.sumY / before.blue.count, 1);
    expect(after.red.sumX).toBe(before.red.sumX);

    // Undo restores the band exactly.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await scanLayer(page, pasted.id);
    expect(undone.red.sumY).toBe(before.red.sumY);
    expect(undone.blue.sumY).toBe(before.blue.sumY);
  });
});
