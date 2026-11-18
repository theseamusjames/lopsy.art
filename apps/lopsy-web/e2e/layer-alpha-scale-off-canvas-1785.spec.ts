import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  selectTool,
  setForegroundColor,
} from './helpers';

/**
 * #1785 — ⌘-clicking a layer thumbnail selects the layer's alpha, clamped to
 * the canvas, and a transform of it lifts the whole layer (#1605). A scale
 * from a corner handle then sampled only the canvas-clamped box, so the part
 * of the layer past the canvas edge was dropped on commit, leaving a straight
 * cut. The whole layer now goes through the transform.
 *
 * 800×600 document: a red disc (350,150)–(650,450) nudged 250 px right, so it
 * spans x 600–899 and hangs 100 px past the right edge.
 */

interface Bounds { count: number; minX: number; maxX: number; minY: number; maxY: number }

async function opaqueBounds(page: Page, layerId: string): Promise<Bounds> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const p = await read(lid);
    const b = { count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    if (!p) return b;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        if ((p.pixels[(y * p.width + x) * 4 + 3] ?? 0) < 128) continue;
        b.count++;
        b.minX = Math.min(b.minX, x + layer.x);
        b.maxX = Math.max(b.maxX, x + layer.x);
        b.minY = Math.min(b.minY, y + layer.y);
        b.maxY = Math.max(b.maxY, y + layer.y);
      }
    }
    return b;
  }, layerId);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, modifier?: 'Control'): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(250);
}

async function editFill(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[role="menu"][aria-label="Edit"]').getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await page.waitForTimeout(200);
}

async function nudge(page: Page, key: 'ArrowRight' | 'ArrowLeft', times: number): Promise<void> {
  for (let i = 0; i < times; i++) await page.keyboard.press(`Shift+${key}`);
  await page.waitForTimeout(400);
}

test.describe('Scaling a layer-alpha selection of a layer hanging off the canvas (#1785)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('a corner-handle scale keeps the off-canvas part of the layer', async ({ page }) => {
    const layerId = await addLayer(page);
    await setForegroundColor(page, 255, 0, 0);
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragDoc(page, 350, 150, 650, 450);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    await selectTool(page, 'move');
    await nudge(page, 'ArrowRight', 25);
    const placed = await opaqueBounds(page, layerId);
    expect(placed.minX).toBeGreaterThanOrEqual(598);
    expect(placed.maxX).toBeGreaterThan(890);

    await page.locator(`[data-layer-id="${layerId}"]`).locator('[class*="thumbnail"]').first()
      .click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);

    // Scale from the top-left handle (600, 150) 50 px in: the box's
    // bottom-right corner (800, 450) stays pinned, scale 0.75.
    await dragDoc(page, 600, 150, 650, 200, 'Control');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    const scaled = await opaqueBounds(page, layerId);
    await page.screenshot({ path: 'e2e/screenshots/layer-alpha-scale-off-canvas-1785.png' });
    // The on-canvas part starts near 650; the off-canvas part, scaled with it
    // about the same corner, still reaches ~874 instead of stopping at ~803.
    expect(scaled.minX).toBeGreaterThan(640);
    expect(scaled.minX).toBeLessThan(660);
    expect(scaled.maxX).toBeGreaterThan(860);
    // A 300 px disc scaled by 0.75 is ~225 px across in both directions.
    expect(scaled.maxX - scaled.minX).toBeGreaterThan(210);
    expect(scaled.maxY - scaled.minY).toBeGreaterThan(210);

    // Bring it back into view: the disc is whole, not cut along a line.
    await nudge(page, 'ArrowLeft', 30);
    const back = await opaqueBounds(page, layerId);
    expect(back.maxX - back.minX).toBeGreaterThan(210);
    // A disc's area, π·r², for r ≈ 112: no half is missing.
    expect(back.count).toBeGreaterThan(0.9 * Math.PI * 112 * 112);
  });
});
