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
 * #1801 — ⌘-clicking the thumbnail of a layer hanging past the canvas edge
 * selects its on-canvas alpha, and a Move drag of that selection carries the
 * whole layer (#1605). The ants and the transform box stayed the size of the
 * canvas-clipped selection, so after the drag they framed only part of the
 * moved disc, and a corner scale then scaled that part alone, splitting it.
 *
 * 800×600 document: a red disc (300,200)–(500,400) moved 400 px left, so it
 * spans x −100…99, then dragged 600 px right to x 500…699.
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

/** Opaque runs along document row `docY`, as [startX, endX] pairs. */
async function opaqueRuns(page: Page, layerId: string, docY: number): Promise<Array<[number, number]>> {
  return page.evaluate(async ({ lid, row }) => {
    const w = window as unknown as Record<string, unknown>;
    const store = w.__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid)!;
    const read = w.__readLayerPixels as (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const p = await read(lid);
    const runs: Array<[number, number]> = [];
    const y = row - layer.y;
    if (!p || y < 0 || y >= p.height) return runs;
    let start = -1;
    for (let x = 0; x <= p.width; x++) {
      const isOpaque = x < p.width && (p.pixels[(y * p.width + x) * 4 + 3] ?? 0) >= 128;
      if (isOpaque && start < 0) start = x;
      if (!isOpaque && start >= 0) {
        runs.push([start + layer.x, x - 1 + layer.x]);
        start = -1;
      }
    }
    return runs;
  }, { lid: layerId, row: docY });
}

interface Frames {
  selection: { x: number; y: number; width: number; height: number } | null;
  box: { x: number; y: number; width: number; height: number } | null;
}

async function selectionFrames(page: Page): Promise<Frames> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const editor = w.__editorStore as { getState: () => { selection: { bounds: Frames['selection'] } } };
    const ui = w.__uiStore as { getState: () => { transform: { originalBounds: Frames['box'] } | null } };
    return {
      selection: editor.getState().selection.bounds ?? null,
      box: ui.getState().transform?.originalBounds ?? null,
    };
  });
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

test.describe('Moving a layer-alpha selection frames all the moved pixels (#1801)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and layers panel');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('the box frames the whole disc after the drag and a corner scale keeps it in one piece', async ({ page }) => {
    const layerId = await addLayer(page);
    await setForegroundColor(page, 255, 0, 0);
    await page.locator('[data-tool-id="marquee-ellipse"]').click();
    await dragDoc(page, 300, 200, 500, 400);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    const drawn = await opaqueBounds(page, layerId);

    // Push the disc half off the left edge.
    await selectTool(page, 'move');
    await dragDoc(page, 400, 300, 0, 300);
    const hanging = await opaqueBounds(page, layerId);
    expect(hanging.minX).toBeLessThan(-90);
    expect(hanging.maxX).toBeLessThan(110);

    // ⌘-click the thumbnail: the selection is the disc's on-canvas half.
    await page.locator(`[data-layer-id="${layerId}"]`).locator('[class*="thumbnail"]').first()
      .click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);
    const clicked = await selectionFrames(page);
    expect(clicked.selection!.x).toBe(0);
    expect(clicked.selection!.width).toBeLessThanOrEqual(hanging.maxX + 1);

    // Drag the selection 600 px right: the whole disc lands at x 500…699.
    await dragDoc(page, 50, 300, 650, 300);
    const moved = await opaqueBounds(page, layerId);
    expect(moved.count).toBe(drawn.count);
    expect(moved.minX).toBe(hanging.minX + 600);
    expect(moved.maxX).toBe(hanging.maxX + 600);

    // The ants' bounds and the transform box take in every moved pixel, not
    // just the half that was on the canvas when it was selected.
    const framed = await selectionFrames(page);
    await page.screenshot({ path: 'e2e/screenshots/layer-alpha-move-box-off-canvas-1801-moved.png' });
    for (const frame of [framed.selection!, framed.box!]) {
      expect(frame.x).toBeLessThanOrEqual(moved.minX);
      expect(frame.x + frame.width).toBeGreaterThanOrEqual(moved.maxX + 1);
      expect(frame.y).toBeLessThanOrEqual(moved.minY);
      expect(frame.y + frame.height).toBeGreaterThanOrEqual(moved.maxY + 1);
    }

    // Scale from the top-right handle 60 px out each way. The bottom-left
    // corner (500, 400) stays pinned.
    const right = framed.box!.x + framed.box!.width;
    const top = framed.box!.y;
    await dragDoc(page, right, top, right + 60, top - 60, 'Control');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);

    const scaled = await opaqueBounds(page, layerId);
    await page.screenshot({ path: 'e2e/screenshots/layer-alpha-move-box-off-canvas-1801-scaled.png' });
    // The whole disc scaled about the pinned corner: it still starts at the
    // left edge it had and grew to ~260 px both ways.
    expect(Math.abs(scaled.minX - moved.minX)).toBeLessThanOrEqual(3);
    expect(scaled.maxX - scaled.minX).toBeGreaterThan(245);
    expect(scaled.maxY - scaled.minY).toBeGreaterThan(245);
    // One piece: a split left an unscaled half and a scaled half with a gap
    // between them along the middle row.
    const midY = Math.round((scaled.minY + scaled.maxY) / 2);
    const runs = await opaqueRuns(page, layerId, midY);
    expect(runs).toHaveLength(1);
    expect(runs[0]![1] - runs[0]![0]).toBeGreaterThan(245);
    // A disc's area, π·r², for r ≈ 128.
    expect(scaled.count).toBeGreaterThan(0.9 * Math.PI * 128 * 128);
  });
});
