import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  setActiveLayer,
  setForegroundColor,
  selectTool,
  getPixelAt,
  undo,
  redo,
} from './helpers';

// #858 — Auto Contrast, then undo / redo / undo with layer switches between.
//
// Auto Contrast pushes a pixel history entry while Pool is expanded to the
// full document. Switching to Background crops Pool back to its content
// (400,300 300x120) outside of history. The redo then recorded the live,
// cropped Pool bounds with the restored snapshot's full-document handle, so
// the undo after it left the store at 400,300 300x120 on top of a 1500x500
// texture. Re-activating Pool expanded that mismatch to 0,0 1900x800 with the
// rectangle baked in at (800, 600) — off the bottom of the canvas.

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

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

async function layerIds(page: Page): Promise<{ pool: string; background: string }> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; type: string }> } };
    };
    const doc = store.getState().document;
    const background = doc.layers.find((l) => l.type === 'raster' && l.id !== doc.activeLayerId)!.id;
    return { pool: doc.activeLayerId, background };
  });
}

async function autoContrast(page: Page): Promise<void> {
  await page.locator('button:has-text("Image")').first().click();
  await page.locator('[role="menuitem"]:has-text("Auto Contrast")').click();
  await page.waitForTimeout(300);
}

/** Switch layers and give the deferred crop of the old layer time to run. */
async function switchTo(page: Page, id: string): Promise<void> {
  await setActiveLayer(page, id);
  await page.waitForTimeout(700);
}

function isBlue(p: { r: number; g: number; b: number; a: number }): boolean {
  return p.a > 200 && p.b > 180 && p.r < 80;
}

test('#858: undo/redo across Auto Contrast with layer switches keeps the layer in place', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1500, 500, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
  const { pool, background } = await layerIds(page);

  // Pool: blue rectangle (400,300)-(700,420).
  await selectTool(page, 'marquee-rect');
  await dragDoc(page, 400, 300, 700, 420);
  await setForegroundColor(page, 0x30, 0x70, 0xff);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);

  // Crop Pool to its content and expand it back.
  await switchTo(page, background);
  await switchTo(page, pool);

  await autoContrast(page);
  await switchTo(page, background);
  await undo(page);
  await page.waitForTimeout(700);
  await switchTo(page, background);
  await redo(page);
  await page.waitForTimeout(300);
  await undo(page);
  await page.waitForTimeout(300);

  // Before re-activating Pool: its texture must match its stored bounds.
  // The bug left store 400,300 300x120 over a 1500x500 texture here.
  const beforeClick = await storeAndEngineBounds(page, pool);
  expect(beforeClick.engine).toEqual(beforeClick.store);

  await switchTo(page, pool);

  const { store, engine } = await storeAndEngineBounds(page, pool);
  expect(engine).toEqual(store);
  // Expanded to the document, not the doubled 1900x800.
  expect(store).toEqual({ x: 0, y: 0, width: 1500, height: 500 });

  // The rectangle is still at (400..700, 300..420), not at (800, 600).
  expect(isBlue(await getPixelAt(page, 550, 360, pool))).toBe(true);
  expect(isBlue(await getPixelAt(page, 405, 305, pool))).toBe(true);
  expect(isBlue(await getPixelAt(page, 695, 415, pool))).toBe(true);
  expect((await getPixelAt(page, 350, 360, pool)).a).toBe(0);
});
