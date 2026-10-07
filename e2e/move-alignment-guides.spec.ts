/**
 * Move-drag alignment lines (#1224): dragging content close to an edge or
 * centre of other content draws a dark pink line there; with View → Snap to
 * Layers on the drag lands on it.
 */
import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, docToScreen, drawRect, waitForStore } from './helpers';

interface LayerBox { id: string; x: number; y: number; width: number; height: number }

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function layerBox(page: Page, id: string): Promise<LayerBox> {
  return page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: LayerBox[] } };
    };
    const l = store.getState().document.layers.find((layer) => layer.id === lid)!;
    return { id: l.id, x: l.x, y: l.y, width: l.width, height: l.height };
  }, id);
}

async function viewMenu(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'View' }).click();
  await page.locator(`[role="menuitem"]:has-text("${item}")`).click();
  await page.waitForTimeout(100);
}

interface PinkPixels { count: number; minDocX: number; maxDocX: number; minDocY: number; maxDocY: number }

/** Dark pink pixels on the 2D overlay canvas, with their extent mapped back to document space. */
async function pinkOverlayPixels(page: Page): Promise<PinkPixels> {
  return page.evaluate(() => {
    const overlay = Array.from(document.querySelectorAll('canvas'))
      .find((c) => /overlayCanvas/.test(c.className)) as HTMLCanvasElement;
    const ctx = overlay.getContext('2d')!;
    const img = ctx.getImageData(0, 0, overlay.width, overlay.height);
    const rect = overlay.getBoundingClientRect();
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { viewport: { zoom: number; panX: number; panY: number }; document: { width: number; height: number } };
    };
    const { viewport: v, document: d } = store.getState();
    const scale = overlay.width / rect.width;
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        const r = img.data[i]!;
        const g = img.data[i + 1]!;
        const b = img.data[i + 2]!;
        const a = img.data[i + 3]!;
        if (a < 100 || r < 150 || g > 90 || b < 60 || b > 190) continue;
        count++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    // Screen = canvas centre + pan + (doc − doc centre) × zoom, in CSS px.
    const toDocX = (px: number) => (px / scale - rect.width / 2 - v.panX) / v.zoom + d.width / 2;
    const toDocY = (py: number) => (py / scale - rect.height / 2 - v.panY) / v.zoom + d.height / 2;
    return {
      count,
      minDocX: toDocX(minX),
      maxDocX: toDocX(maxX + 1),
      minDocY: toDocY(minY),
      maxDocY: toDocY(maxY + 1),
    };
  });
}

/** Press on the layer's centre and drag it so its left edge would land at `left` (unsnapped). */
async function dragLayerLeftEdgeTo(page: Page, box: LayerBox, left: number, top: number, release = true): Promise<void> {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const start = await docToScreen(page, cx, cy);
  const end = await docToScreen(page, cx + (left - box.x), cy + (top - box.y));
  await page.mouse.move(Math.round(start.x), Math.round(start.y));
  await page.mouse.down();
  await page.mouse.move(Math.round(end.x), Math.round(end.y), { steps: 12 });
  await page.waitForTimeout(150);
  if (!release) return;
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test.describe('Move alignment lines', () => {
  let stillId = '';
  let moverId = '';

  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'the menu bar and options bar need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);

    // Still: 60 × 60 at (100, 100), so its right edge is x = 160.
    await drawRect(page, 100, 100, 60, 60, { r: 220, g: 40, b: 40 });
    stillId = await activeLayerId(page);
    // Mover: 30 × 30 at (230, 200), clear of every edge and centre of Still and the canvas.
    moverId = await addLayer(page);
    await drawRect(page, 230, 200, 30, 30, { r: 40, g: 40, b: 220 });
    // Leaving Still crops it to its content; wait for that, the box the lines use.
    await expect.poll(async () => (await layerBox(page, stillId)).width, { timeout: 5000 }).toBe(60);
    await page.keyboard.press('v');
  });

  test('a dark pink line marks the edge the content lines up with, and clears on release', async ({ page }) => {
    const before = await layerBox(page, moverId);
    expect(before).toMatchObject({ x: 230, y: 200, width: 30, height: 30 });

    // Left edge 3 px short of Still's right edge (160); Snap to Layers is off.
    await dragLayerLeftEdgeTo(page, before, 163, 200, false);
    const during = await pinkOverlayPixels(page);
    await page.screenshot({ path: 'e2e/screenshots/move-alignment-line-during-drag.png' });
    expect(during.count).toBeGreaterThan(50);
    // One vertical line at x = 160 running from Still's top (100) past the mover's bottom (230).
    expect(during.minDocX).toBeGreaterThan(158);
    expect(during.maxDocX).toBeLessThan(162);
    expect(during.minDocY).toBeLessThan(100);
    expect(during.maxDocY).toBeGreaterThan(230);

    await page.mouse.up();
    await page.waitForTimeout(150);
    expect((await pinkOverlayPixels(page)).count).toBe(0);

    // Without snapping the layer stays where it was dropped.
    const after = await layerBox(page, moverId);
    expect(Math.abs(after.x - 163)).toBeLessThanOrEqual(1);
    expect(after.x).not.toBe(160);
  });

  test('with Snap to Layers on, the drag lands exactly on the line', async ({ page }) => {
    await viewMenu(page, 'Snap to Layers');
    const before = await layerBox(page, moverId);
    await dragLayerLeftEdgeTo(page, before, 163, 200);
    await page.screenshot({ path: 'e2e/screenshots/move-alignment-snapped.png' });

    const after = await layerBox(page, moverId);
    expect(after.x).toBe(160);
    expect(after.y).toBe(200);
  });
});
