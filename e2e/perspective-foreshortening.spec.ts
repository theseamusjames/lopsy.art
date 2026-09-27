import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
} from './helpers';

// #927 — the Move tool's Perspective (and Distort) mode mapped pixels with an
// inverse-bilinear warp, which keeps equally spaced source rows equally
// spaced in the output: no foreshortening, so a tilted floor looked like a
// flat trapezoid. A real perspective warp is a projective homography, under
// which rows near the narrow ("far") edge bunch together and rows near the
// wide ("near") edge spread apart.
//
// Setup: 800x800 doc, a layer with eight black bars 50px tall every 100px
// (y = 0..50, 100..150, ..., 700..750). Select all, Perspective mode, drag
// the bottom-left corner 400px left — the bottom-right mirrors, so the bottom
// edge becomes x = -400..1200 while the top edge stays x = 0..800.

const DOC = 800;
const BAR_PERIOD = 100;
const BAR_HEIGHT = 50;

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 10): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

interface ColumnScan {
  layer: { x: number; y: number; width: number; height: number };
  /** Doc-space y of each row in the column whose pixel is opaque and dark. */
  darkRows: number[];
}

/** Scan doc column `docX` of the layer texture, returning the dark rows in doc space. */
async function scanColumn(page: Page, layerId: string, docX: number): Promise<ColumnScan> {
  return page.evaluate(async ({ lid, docX }) => {
    const w = window as unknown as {
      __editorStore: { getState: () => { document: { layers: { id: string; x: number; y: number }[] } } };
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const px = await w.__readLayerPixels(lid);
    const lx = docX - layer.x;
    const darkRows: number[] = [];
    if (lx >= 0 && lx < px.width) {
      for (let ly = 0; ly < px.height; ly++) {
        const i = (ly * px.width + lx) * 4;
        const isDark = px.pixels[i + 3]! > 128 && px.pixels[i]! < 100 && px.pixels[i + 1]! < 100 && px.pixels[i + 2]! < 100;
        if (isDark) darkRows.push(ly + layer.y);
      }
    }
    return { layer: { x: layer.x, y: layer.y, width: px.width, height: px.height }, darkRows };
  }, { lid: layerId, docX });
}

/** Group sorted rows into contiguous runs [start, end] (inclusive). */
function runs(rows: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r === last[1] + 1) last[1] = r;
    else out.push([r, r]);
  }
  return out;
}

test('#927: Perspective foreshortens evenly spaced rows toward the narrow edge', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC, DOC, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  // Zoom out so the dragged corner (doc x = -400) stays over the canvas.
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await page.waitForTimeout(200);

  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);
  await setForegroundColor(page, 0, 0, 0);

  for (let k = 0; k < DOC / BAR_PERIOD; k++) {
    await selectTool(page, 'marquee-rect');
    await drag(page, -20, k * BAR_PERIOD, DOC + 20, k * BAR_PERIOD + BAR_HEIGHT, 5);
    await page.locator('nav[aria-label="Application menu"] button:has-text("Edit")').click();
    await page.locator('[role="menu"][aria-label="Edit"] [role="menuitem"]').filter({ hasText: /^Fill(?! with)/ }).click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);
  }

  await page.screenshot({ path: 'e2e/screenshots/perspective-foreshortening-before.png' });

  // Before: eight 50px bars exactly every 100px.
  const before = runs((await scanColumn(page, layerId, DOC / 2)).darkRows);
  expect(before).toEqual(
    Array.from({ length: 8 }, (_, k) => [k * BAR_PERIOD, k * BAR_PERIOD + BAR_HEIGHT - 1]),
  );

  // Select all, Move tool, Perspective, drag bottom-left corner 400px left.
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  await page.locator('button:has-text("Perspective")').click();
  await page.waitForTimeout(150);
  await drag(page, 0, DOC, -400, DOC, 20);

  const corners = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: { mode: string; corners: unknown } | null };
    };
    const t = ui.getState().transform;
    return t ? { mode: t.mode, corners: t.corners } : null;
  });
  expect(corners?.mode).toBe('perspective');

  await page.screenshot({ path: 'e2e/screenshots/perspective-foreshortening-dragging.png' });

  // Commit the same way the issue does: back to Free, then deselect.
  await page.locator('button:has-text("Free")').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/perspective-foreshortening-committed.png' });

  const scan = await scanColumn(page, layerId, DOC / 2);
  const after = runs(scan.darkRows);

  // Still eight bars spanning the full height: the top edge stays at y = 0
  // and the last bar ends at the source's y = 750 row.
  expect(after.length).toBe(8);
  expect(after[0]![0]).toBeLessThanOrEqual(2);
  expect(after[7]![1]).toBeGreaterThan(700);
  expect(after[7]![1]).toBeLessThan(DOC);

  // Band heights (bar + the gap after it) grow monotonically down the image.
  const periods = after.slice(1).map((r, i) => r[0] - after[i]![0]);
  for (let i = 1; i < periods.length; i++) {
    expect(periods[i]!, `band ${i} vs band ${i - 1}: ${JSON.stringify(periods)}`).toBeGreaterThanOrEqual(periods[i - 1]!);
  }

  // Foreshortening: bars near the narrow top are clearly shorter than bars
  // near the wide bottom. The old bilinear warp left every bar exactly 50px.
  const heights = after.map(([s, e]) => e - s + 1);
  const ratio = heights[7]! / heights[0]!;
  expect(ratio, `bar heights ${JSON.stringify(heights)}`).toBeGreaterThan(1.5);
  expect(heights[0]!).toBeLessThan(BAR_HEIGHT - 10);
  expect(heights[7]!).toBeGreaterThan(BAR_HEIGHT + 10);
});
