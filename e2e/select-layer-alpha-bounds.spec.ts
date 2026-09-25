import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
  getPixelAt,
  undo,
} from './helpers';

// #810 — ⌘-clicking a cropped raster layer's thumbnail (Select Layer Alpha)
// pre-floats that layer, which expands its engine texture to the full
// document at (0, 0). The store kept the cropped 360,90 120x120 bounds, so
// the next full resync (any undo) pushed x/y = 360,90 onto the document-
// sized texture: the circle was drawn at (720, 180), off the canvas.

interface Bounds { x: number; y: number; width: number; height: number }

async function storeAndEngineBounds(page: Page, id: string): Promise<{ store: Bounds; engine: Bounds }> {
  return page.evaluate((lid) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { layers: Array<Bounds & { id: string }> } } };
      __engineState: { getEngine: () => unknown };
      __wasmBridge: { getLayerEngineBounds: (engine: unknown, id: string) => Int32Array };
    };
    const l = w.__editorStore.getState().document.layers.find((x) => x.id === lid)!;
    const e = Array.from(w.__wasmBridge.getLayerEngineBounds(w.__engineState.getEngine(), lid));
    return {
      store: { x: l.x, y: l.y, width: l.width, height: l.height },
      engine: { x: e[0]!, y: e[1]!, width: e[2]!, height: e[3]! },
    };
  }, id);
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function cmdClickThumbnail(page: Page, layerId: string): Promise<void> {
  const thumbnail = page.locator(`[data-layer-id="${layerId}"] div[class*="thumbnail"]`).first();
  await thumbnail.click({ modifiers: ['Control'] });
  await page.waitForTimeout(300);
}

function isRed(p: { r: number; g: number; b: number; a: number }): boolean {
  return p.a > 200 && p.r > 200 && p.g < 60 && p.b < 60;
}

test('#810: ⌘-click a cropped layer thumbnail, deselect, undo — layer stays in place', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 600, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  const layer1 = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });

  // Red circle centred at (420, 150), radius 60, drawn with the Shape tool
  // (⌘ constrains the drag to a circle from the centre).
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'shape');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
  await page.keyboard.down('Meta');
  await drag(page, 420, 150, 480, 210);
  await page.keyboard.up('Meta');
  await page.waitForTimeout(200);

  // Adding a layer crops Layer 1 to the circle.
  const layer2 = await addLayer(page);
  await setActiveLayer(page, layer2);
  await page.waitForTimeout(600);
  const cropped = await storeAndEngineBounds(page, layer1);
  expect(cropped.store).toEqual({ x: 360, y: 90, width: 120, height: 120 });

  await cmdClickThumbnail(page, layer1);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);

  // Store and engine agree on where Layer 1's texture lives.
  const afterDeselect = await storeAndEngineBounds(page, layer1);
  expect(afterDeselect.engine).toEqual(afterDeselect.store);

  // Brush stroke on Layer 2, then undo it.
  await setForegroundColor(page, 0, 0, 255);
  await selectTool(page, 'brush');
  await drag(page, 60, 300, 200, 320);
  await page.waitForTimeout(200);
  await undo(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/select-layer-alpha-bounds.png' });

  const afterUndo = await storeAndEngineBounds(page, layer1);
  expect(afterUndo.engine).toEqual(afterUndo.store);

  // The circle is still centred at (420, 150).
  expect(isRed(await getPixelAt(page, 420, 150, layer1))).toBe(true);
  expect(isRed(await getPixelAt(page, 365, 150, layer1))).toBe(true);
  expect(isRed(await getPixelAt(page, 475, 150, layer1))).toBe(true);
  expect(isRed(await getPixelAt(page, 420, 95, layer1))).toBe(true);
  expect(isRed(await getPixelAt(page, 420, 205, layer1))).toBe(true);

  // Composited output: red at the circle centre (what the user sees).
  const centre = await docToScreen(page, 420, 150);
  const px = await page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const x = Math.round((sx - rect.left) * scale);
    const y = comp.height - 1 - Math.round((sy - rect.top) * scale);
    const i = (y * comp.width + x) * 4;
    return comp.pixels.slice(i, i + 4);
  }, { sx: centre.x, sy: centre.y });
  expect(px[0]!).toBeGreaterThan(200);
  expect(px[2]!).toBeLessThan(60);
});
