/**
 * #1257 — Oil Paint turned flat colours black on Metal: the quadrant variance
 *         E[s²] − m² rounded slightly negative and pow() of it was NaN.
 * #1260 — Smudge mixed straight RGB, so red smeared into transparent pixels
 *         was stored premultiplied (R == A) and composited grey.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getEditorState,
  setForegroundColor,
  setToolOption,
  docToScreen,
  applyFilter,
} from './helpers';

interface LayerRaster {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number[];
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 8): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): Promise<void> {
  await setForegroundColor(page, rgb[0], rgb[1], rgb[2]);
  await page.keyboard.press('m');
  await dragOnCanvas(page, x0, y0, x1, y1);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function activeLayerId(page: Page): Promise<string> {
  const state = await getEditorState(page);
  return state.document.activeLayerId;
}

async function readLayer(page: Page, layerId: string): Promise<LayerRaster> {
  return page.evaluate(async (lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await readFn(lid);
    return { x: layer?.x ?? 0, y: layer?.y ?? 0, width, height, pixels: Array.from(pixels) };
  }, layerId);
}

function pixelAtDoc(r: LayerRaster, dx: number, dy: number): [number, number, number, number] {
  const x = dx - r.x;
  const y = dy - r.y;
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return [0, 0, 0, 0];
  const i = (y * r.width + x) * 4;
  return [r.pixels[i] ?? 0, r.pixels[i + 1] ?? 0, r.pixels[i + 2] ?? 0, r.pixels[i + 3] ?? 0];
}

test.describe('Pixel fixes #1245 #1253 #1257 #1260', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and marquee drags need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('#1257 Oil Paint leaves a flat colour unchanged', async ({ page }) => {
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    await setForegroundColor(page, 0xd8, 0x43, 0x2e);
    await editFill(page);
    expect(pixelAtDoc(await readLayer(page, id), 300, 200)).toEqual([216, 67, 46, 255]);

    await applyFilter(page, 'Oil Paint...', { Radius: 4, Sharpness: 1.5 });
    await page.waitForTimeout(300);
    const after = pixelAtDoc(await readLayer(page, id), 300, 200);
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(after[c]! - [216, 67, 46][c]!), `channel ${c} of ${after}`).toBeLessThanOrEqual(1);
    }
    expect(after[3]).toBe(255);
  });

  test('#1260 Smudge into transparency keeps the colour', async ({ page }) => {
    await createDocument(page, 600, 600, false);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    await fillRect(page, 100, 100, 500, 300, [255, 0, 0]);

    await page.keyboard.press('r');
    await setToolOption(page, 'Size', 40);
    await setToolOption(page, 'Strength', 80);
    await dragOnCanvas(page, 300, 290, 300, 460, 30);
    await page.waitForTimeout(300);

    const raster = await readLayer(page, id);
    let smeared = 0;
    for (let y = 305; y < 460; y++) {
      const [r, g, b, a] = pixelAtDoc(raster, 300, y);
      if (a < 20) continue;
      smeared++;
      expect(r, `R at y=${y} (alpha ${a})`).toBeGreaterThanOrEqual(250);
      expect(g).toBeLessThanOrEqual(5);
      expect(b).toBeLessThanOrEqual(5);
    }
    expect(smeared, 'smudge pulled colour below the rectangle').toBeGreaterThan(5);
  });
});
