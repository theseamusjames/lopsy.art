import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
} from './helpers';

// #818 — committing a rotate/scale transform permanently cropped pixels that
// landed outside the canvas. The float buffer only covered the union of the
// canvas and the layer's pre-transform content, so a 200x40 bar near the
// bottom edge turned upright (40x200, centred at (200, 260) on a 400x300
// canvas) lost the 60px that hung below the canvas: after ⌘D the layer was
// 40x140, and dragging it back up showed a 140px bar. A plain move keeps
// off-canvas pixels, so a transform must too.

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function opaqueCount(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id: string) => Promise<{ pixels: number[] }>;
    const r = await fn(lid);
    let n = 0;
    for (let i = 3; i < r.pixels.length; i += 4) if (r.pixels[i]! > 200) n++;
    return n;
  }, layerId);
}

/** Rows of the doc column `x` whose composited pixel is dark (the black bar). */
async function darkRowsInColumn(page: Page, x: number): Promise<number[]> {
  return page.evaluate(async (docX) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const { document: doc, viewport } = w.__editorStore.getState();
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const rows: number[] = [];
    for (let y = 0; y < doc.height; y++) {
      const sx = (docX + 0.5 - doc.width / 2) * viewport.zoom + viewport.panX + rect.width / 2;
      const sy = (y + 0.5 - doc.height / 2) * viewport.zoom + viewport.panY + rect.height / 2;
      const px = Math.floor(sx * scale);
      const py = comp.height - 1 - Math.floor(sy * scale);
      const i = (py * comp.width + px) * 4;
      if (comp.pixels[i]! < 60 && comp.pixels[i + 1]! < 60 && comp.pixels[i + 2]! < 60) rows.push(y);
    }
    return rows;
  }, x);
}

test('#818: a quarter-turn that pushes pixels past the canvas edge keeps them after commit', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);

  // Black bar (100,240)-(300,280).
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'marquee-rect');
  await drag(page, 100, 240, 300, 280, 5);
  await selectTool(page, 'fill');
  const inside = await docToScreen(page, 200, 260);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  const barPixels = await opaqueCount(page, layerId);
  expect(barPixels).toBeGreaterThan(7800);
  expect(barPixels).toBeLessThan(8200);

  // Marquee around the bar, then ⌘-drag the top-right rotate handle a
  // quarter turn clockwise about the centre (200, 260). The handle sits 20px
  // outside the (95,235)-(305,285) corner.
  await selectTool(page, 'marquee-rect');
  await drag(page, 95, 235, 305, 285, 5);
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  await page.keyboard.down('Meta');
  // (325, 215) is (125, -45) from the centre; a quarter turn maps it to (45, 125).
  await drag(page, 325, 215, 245, 385, 20);
  await page.keyboard.up('Meta');

  const rotation = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: { rotation: number } | null };
    };
    return ui.getState().transform?.rotation ?? null;
  });
  expect(rotation).toBeCloseTo(Math.PI / 2, 5);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);

  // Every pixel of the bar survives the commit, including the 60px that
  // hang below the canvas.
  const committed = await opaqueCount(page, layerId);
  expect(committed).toBeGreaterThan(barPixels * 0.95);

  // Drag the layer up 120px: the full 200px bar comes into view, spanning
  // y 40..240 in column x = 200.
  await selectTool(page, 'move');
  await drag(page, 200, 200, 200, 80);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/transform-offcanvas-commit.png' });

  const rows = await darkRowsInColumn(page, 200);
  expect(rows.length).toBeGreaterThan(195);
  expect(Math.min(...rows)).toBeGreaterThanOrEqual(38);
  expect(Math.min(...rows)).toBeLessThanOrEqual(42);
  expect(Math.max(...rows)).toBeGreaterThanOrEqual(237);
  expect(Math.max(...rows)).toBeLessThanOrEqual(241);
});
