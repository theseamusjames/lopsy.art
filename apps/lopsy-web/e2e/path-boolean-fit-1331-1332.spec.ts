import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, selectTool, setForegroundColor } from './helpers';

/**
 * #1331 — Path boolean results looped on straight edges: each anchor's
 *         handles were attached to the wrong neighbour.
 * #1332 — Subtract / Exclude kept only the longest contour, dropping holes
 *         and islands.
 */

interface StoredAnchor {
  point: { x: number; y: number };
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
}

async function getPaths(page: Page): Promise<Array<{ id: string; anchors: StoredAnchor[] }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ id: string; anchors: StoredAnchor[] }> };
    };
    return store.getState().paths.map((p) => ({ id: p.id, anchors: p.anchors }));
  });
}

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function drawShapePath(page: Page, mode: 'ellipse' | 'rectangle', x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'shape');
  await page.locator('select[aria-labelledby="shape-mode-label"]').selectOption(mode);
  await page.locator('select[aria-labelledby="shape-output-label"]').selectOption('path');
  await dragOnCanvas(page, x0, y0, x1, y1);
}

async function pathsList(page: Page) {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible())) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
  }
  return list;
}

async function clickMenuItem(page: Page, menuLabel: string, itemLabel: string): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').locator(`button:has-text("${menuLabel}")`).click();
  await page.waitForTimeout(100);
  await page.locator('[role="menu"]').locator(`button:has-text("${itemLabel}")`).click();
  await page.waitForTimeout(200);
}

function bounds(anchors: StoredAnchor[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = anchors.map((a) => a.point.x);
  const ys = anchors.map((a) => a.point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test.describe('path boolean results (#1331, #1332)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(300);
  });

  test('#1332 Subtract Paths keeps the inner circle as a hole', async ({ page }) => {
    await drawShapePath(page, 'ellipse', 300, 300, 420, 420);
    await drawShapePath(page, 'ellipse', 300, 300, 360, 360);
    const before = await getPaths(page);
    expect(before).toHaveLength(2);

    const list = await pathsList(page);
    await list.locator(`[data-testid="path-item-${before[0]!.id}"]`).click();
    await clickMenuItem(page, 'Path', 'Subtract Paths');

    const after = await getPaths(page);
    expect(after).toHaveLength(2);
    const sized = after.map((p) => bounds(p.anchors)).sort((a, b) => (b.maxX - b.minX) - (a.maxX - a.minX));
    const outer = sized[0]!;
    const hole = sized[1]!;
    expect(outer.maxX - outer.minX).toBeGreaterThan(225);
    expect(outer.maxX - outer.minX).toBeLessThan(255);
    expect(hole.maxX - hole.minX).toBeGreaterThan(105);
    expect(hole.maxX - hole.minX).toBeLessThan(135);
    // The hole is centred on the outer circle.
    expect(Math.abs((hole.minX + hole.maxX) / 2 - 300)).toBeLessThan(3);
    expect(Math.abs((hole.minY + hole.maxY) / 2 - 300)).toBeLessThan(3);
  });

  test('#1331 Unite Paths keeps straight edges straight', async ({ page }) => {
    await drawShapePath(page, 'ellipse', 200, 300, 260, 360);
    await drawShapePath(page, 'rectangle', 400, 300, 580, 315);
    const before = await getPaths(page);
    expect(before).toHaveLength(2);

    const list = await pathsList(page);
    await list.locator(`[data-testid="path-item-${before[0]!.id}"]`).click();
    await clickMenuItem(page, 'Path', 'Unite Paths');

    const after = await getPaths(page);
    expect(after).toHaveLength(1);
    const anchors = after[0]!.anchors;
    const n = anchors.length;
    expect(n).toBeGreaterThan(3);
    let backwards = 0;
    for (let i = 0; i < n; i++) {
      const a = anchors[i]!;
      const next = anchors[(i + 1) % n]!.point;
      const prev = anchors[(i - 1 + n) % n]!.point;
      if (a.handleOut) {
        const dot = (a.handleOut.x - a.point.x) * (next.x - a.point.x) + (a.handleOut.y - a.point.y) * (next.y - a.point.y);
        if (dot < 0) backwards++;
      }
      if (a.handleIn) {
        const dot = (a.handleIn.x - a.point.x) * (prev.x - a.point.x) + (a.handleIn.y - a.point.y) * (prev.y - a.point.y);
        if (dot < 0) backwards++;
      }
    }
    expect(backwards).toBe(0);

    // Stroke it: nothing may land well off the bar's long edges (y 285 / 315).
    await setForegroundColor(page, 0, 0, 0);
    const row = list.locator('[data-testid^="path-item-"]').first();
    if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
    await page.locator('button[aria-label="Stroke Path"]').click();
    const modal = page.locator('[role="dialog"][aria-label="Stroke Path"]');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('input[type="number"]').fill('3');
    await modal.locator('button:has-text("Stroke")').click();
    await modal.waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);

    const stray = await page.evaluate(async () => {
      const w = window as unknown as {
        __editorStore: { getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } } };
        __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      };
      const doc = w.__editorStore.getState().document;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
      const tex = await w.__readLayerPixels(layer.id);
      let onEdges = 0;
      let off = 0;
      for (let ly = 0; ly < tex.height; ly++) {
        for (let lx = 0; lx < tex.width; lx++) {
          if ((tex.pixels[(ly * tex.width + lx) * 4 + 3] ?? 0) < 64) continue;
          const x = lx + layer.x;
          const y = ly + layer.y;
          if (x < 300 || x > 560) continue;
          if (Math.abs(y - 285) <= 4 || Math.abs(y - 315) <= 4) onEdges++;
          else off++;
        }
      }
      return { onEdges, off };
    });
    expect(stray.onEdges).toBeGreaterThan(400);
    expect(stray.off).toBe(0);
  });
});
