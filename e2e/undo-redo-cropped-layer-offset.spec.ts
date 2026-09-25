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
  redo,
} from './helpers';

// #833 — Undo x2 -> Redo -> Undo across Move steps on two layers.
//
// The second undo makes the first layer active again, and the render loop
// expands it from its cropped 200x200 texture to the full document outside
// of history. The redo then paired the restored snapshot's cropped 200x200
// handle with the live, expanded (0, 0, 600x400) bounds, so the final undo
// blitted the 200x200 disc into a document-sized layer at (0, 0): the store
// and engine both said 0,0 600x400 and the disc sat at (0..199, 0..199)
// instead of (300..499, 150..349).

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function ellipseFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-ellipse');
  await dragDoc(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
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

/** Composited RGBA at doc (x, y). The GL buffer is bottom-up. */
async function compositeAt(page: Page, docX: number, docY: number): Promise<number[]> {
  const screen = await docToScreen(page, docX, docY);
  return page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const px = Math.round((sx - rect.left) * scale);
    const py = comp.height - 1 - Math.round((sy - rect.top) * scale);
    const i = (py * comp.width + px) * 4;
    return comp.pixels.slice(i, i + 4);
  }, { sx: screen.x, sy: screen.y });
}

function isBlue(p: { r: number; g: number; b: number; a: number }): boolean {
  return p.a > 200 && p.b > 180 && p.r < 80;
}

test('#833: undo x2, redo, undo keeps a cropped layer at its content position', async ({ page, isMobile }) => {
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

  // Layer 1: blue disc (300,150)-(500,350).
  await setForegroundColor(page, 0x24, 0x50, 0xdd);
  await ellipseFill(page, 300, 150, 500, 350);

  // "Dot": white disc (100,100)-(220,220). Adding it crops Layer 1.
  const dot = await addLayer(page);
  await setActiveLayer(page, dot);
  await setForegroundColor(page, 255, 255, 255);
  await ellipseFill(page, 100, 100, 220, 220);

  // Move Layer 1 by (-40, -30), then Dot by (+40, +40).
  await setActiveLayer(page, layer1);
  await page.waitForTimeout(200);
  await selectTool(page, 'move');
  await dragDoc(page, 400, 250, 360, 220);
  await setActiveLayer(page, dot);
  await page.waitForTimeout(200);
  await selectTool(page, 'move');
  await dragDoc(page, 160, 160, 200, 200);
  await page.waitForTimeout(300);

  await undo(page);
  await page.waitForTimeout(200);
  await undo(page);
  await page.waitForTimeout(200);
  await redo(page);
  await page.waitForTimeout(200);
  // The redo re-applied Layer 1's move: disc centred at (360, 220).
  expect(isBlue(await getPixelAt(page, 360, 220, layer1))).toBe(true);

  await undo(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/undo-redo-cropped-layer-offset.png' });

  // Both moves are undone: the blue disc is back at (300..500, 150..350)
  // and the white disc at (100..220, 100..220).
  expect(isBlue(await getPixelAt(page, 400, 250, layer1))).toBe(true);
  expect(isBlue(await getPixelAt(page, 305, 250, layer1))).toBe(true);
  expect(isBlue(await getPixelAt(page, 495, 250, layer1))).toBe(true);
  const white = await getPixelAt(page, 160, 160, dot);
  expect(white.a).toBeGreaterThan(200);
  expect(white.r).toBeGreaterThan(200);

  // What the user sees: blue at the disc centre, and not in the top-left
  // corner where the unshifted 200x200 snapshot used to land.
  const centre = await compositeAt(page, 400, 250);
  expect(centre[2]!).toBeGreaterThan(180);
  expect(centre[0]!).toBeLessThan(80);
  const corner = await compositeAt(page, 100, 60);
  expect(corner[2]! - corner[0]!).toBeLessThan(60);

  // Store and engine agree on where Layer 1's texture lives, and it covers
  // the disc.
  const { store, engine } = await storeAndEngineBounds(page, layer1);
  expect(engine).toEqual(store);
  expect(store.x).toBeLessThanOrEqual(300);
  expect(store.y).toBeLessThanOrEqual(150);
  expect(store.x + store.width).toBeGreaterThanOrEqual(500);
  expect(store.y + store.height).toBeGreaterThanOrEqual(350);
});
