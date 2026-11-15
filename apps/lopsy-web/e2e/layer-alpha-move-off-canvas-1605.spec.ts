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
 * #1605 — ⌘-clicking a layer thumbnail selects the layer's alpha, but the
 * document-sized selection mask cannot hold the part of the layer hanging
 * past the canvas edge. A Move drag of that selection extended the mask past
 * the edge column by column, so a diagonal bar pushed off the top split:
 * the off-canvas pixels left of where the bar crosses the edge stayed behind.
 * A selection that is still the layer's own alpha now lifts the whole layer.
 *
 * 800×600 document: a red diagonal bar (80,250)→(180,250)→(480,550)→(380,550)
 * on its own layer, moved 400 px up so it spans y −150…149.
 */

interface OpaqueStats { count: number; offTop: number; minX: number; minY: number; maxX: number; maxY: number }

async function opaqueStats(page: Page, layerId: string): Promise<OpaqueStats> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const p = await read(lid);
    const stats = { count: 0, offTop: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    if (!p) return stats;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        if ((p.pixels[(y * p.width + x) * 4 + 3] ?? 0) < 128) continue;
        const dx = x + layer.x;
        const dy = y + layer.y;
        stats.count++;
        if (dy < 0) stats.offTop++;
        stats.minX = Math.min(stats.minX, dx);
        stats.minY = Math.min(stats.minY, dy);
        stats.maxX = Math.max(stats.maxX, dx);
        stats.maxY = Math.max(stats.maxY, dy);
      }
    }
    return stats;
  }, layerId);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function traceLasso(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  await selectTool(page, 'lasso');
  const screen: Array<{ x: number; y: number }> = [];
  for (const p of points) screen.push(await docToScreen(page, p.x, p.y));
  await page.mouse.move(screen[0]!.x, screen[0]!.y);
  await page.mouse.down();
  for (const sp of screen.slice(1)) await page.mouse.move(sp.x, sp.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function editFill(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[role="menu"][aria-label="Edit"]').getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await page.waitForTimeout(200);
}

test.describe('Moving a layer-alpha selection of a layer hanging off the canvas (#1605)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('the whole bar moves, including the part above the canvas', async ({ page }) => {
    const layerId = await addLayer(page);
    await setForegroundColor(page, 255, 0, 0);
    await traceLasso(page, [
      { x: 80, y: 250 }, { x: 180, y: 250 }, { x: 480, y: 550 }, { x: 380, y: 550 }, { x: 80, y: 250 },
    ]);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    const drawn = await opaqueStats(page, layerId);
    expect(drawn.count).toBeGreaterThan(20_000);
    expect(drawn.minY).toBeGreaterThanOrEqual(249);

    // Move the whole layer 400 px up: the bar's upper-left end hangs off the top.
    await selectTool(page, 'move');
    await dragDoc(page, 330, 450, 330, 50);
    const lifted = await opaqueStats(page, layerId);
    expect(lifted.minY).toBeLessThan(-100);
    expect(lifted.count).toBe(drawn.count);

    // ⌘-click the thumbnail: the selection is the bar's on-canvas part.
    await page.locator(`[data-layer-id="${layerId}"]`).locator('[class*="thumbnail"]').first()
      .click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);

    // Drag the selection 400 px down from inside it, commit and deselect.
    await dragDoc(page, 330, 100, 330, 500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);

    const moved = await opaqueStats(page, layerId);
    expect(moved.offTop).toBe(0);
    expect(moved.count).toBe(drawn.count);
    // One piece, the bar's own size: a cut would leave the stranded strip
    // 400 px above the rest, stretching the bounds.
    expect(moved.maxX - moved.minX).toBe(drawn.maxX - drawn.minX);
    expect(moved.maxY - moved.minY).toBe(drawn.maxY - drawn.minY);
    expect(Math.abs(moved.minY - drawn.minY)).toBeLessThanOrEqual(2);
  });
});
