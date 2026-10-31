import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, waitForStore } from './helpers';

// #1276: Select → Selection → Path on a rectangular marquee produced a
// lopsided blob — every corner smoothed with collinear Catmull-Rom handles a
// third of the neighbour chord long (so they overshot far outside the box),
// plus a duplicated start anchor 1px from the first one that tied a knot.
// A rectangle must come back as exactly its four corners with straight
// edges, and stroking that path must paint only along the box outline.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

const BOX = { x: 100, y: 120, w: 200, h: 150 };
const STROKE_WIDTH = 10;

interface AnchorState {
  point: { x: number; y: number };
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
}

async function drawRectSelection(page: Page): Promise<void> {
  await page.keyboard.press('m');
  await page.waitForTimeout(100);
  const start = await docToScreen(page, BOX.x, BOX.y);
  const end = await docToScreen(page, BOX.x + BOX.w, BOX.y + BOX.h);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function clickSelectMenuItem(page: Page, label: string): Promise<void> {
  await page.locator('nav[aria-label="Application menu"] button', { hasText: 'Select' }).click();
  await page.waitForTimeout(100);
  await page.locator('[role="menu"] [role="menuitem"]', { hasText: label }).click();
  await page.waitForTimeout(200);
}

async function readPaths(page: Page): Promise<Array<{ closed: boolean; anchors: AnchorState[] }>> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: Array<{ closed: boolean; anchors: AnchorState[] }> };
    };
    return store.getState().paths.map((p) => ({ closed: p.closed, anchors: p.anchors }));
  });
}

async function strokeSelectedPath(page: Page): Promise<void> {
  const list = page.locator('[role="listbox"][aria-label="Paths"]');
  if (!(await list.isVisible())) {
    await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
  }
  const row = list.locator('[data-testid^="path-item-"]').first();
  if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await page.locator('button[aria-label="Stroke Path"]').click();
  const modal = page.locator('[role="dialog"][aria-label="Stroke Path"]');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[type="number"]').fill(String(STROKE_WIDTH));
  await modal.locator('button:has-text("Stroke")').click();
  await modal.waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
}

interface StrokeProbe {
  outsideOpaque: number;
  edgeMidpoints: number[];
  insideCenter: number;
}

/**
 * Reads the active layer in document space: opaque pixels lying farther from
 * the box than the stroke reaches, the alpha at each edge's midpoint, and the
 * alpha in the middle of the box.
 */
async function probeStroke(page: Page): Promise<StrokeProbe> {
  return page.evaluate(
    async ({ box, reach }) => {
      const w = window as unknown as {
        __editorStore: {
          getState: () => {
            document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
          };
        };
        __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      };
      const doc = w.__editorStore.getState().document;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
      const tex = await w.__readLayerPixels(layer.id);
      const alphaAt = (dx: number, dy: number): number => {
        const lx = dx - layer.x;
        const ly = dy - layer.y;
        if (lx < 0 || ly < 0 || lx >= tex.width || ly >= tex.height) return 0;
        return tex.pixels[(ly * tex.width + lx) * 4 + 3] ?? 0;
      };
      let outsideOpaque = 0;
      for (let ly = 0; ly < tex.height; ly++) {
        for (let lx = 0; lx < tex.width; lx++) {
          if ((tex.pixels[(ly * tex.width + lx) * 4 + 3] ?? 0) === 0) continue;
          const dx = lx + layer.x;
          const dy = ly + layer.y;
          const outside =
            dx < box.x - reach || dx >= box.x + box.w + reach || dy < box.y - reach || dy >= box.y + box.h + reach;
          if (outside) outsideOpaque++;
        }
      }
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      return {
        outsideOpaque,
        edgeMidpoints: [
          alphaAt(cx, box.y),
          alphaAt(box.x + box.w - 1, cy),
          alphaAt(cx, box.y + box.h - 1),
          alphaAt(box.x, cy),
        ],
        insideCenter: alphaAt(cx, cy),
      };
    },
    { box: BOX, reach: STROKE_WIDTH / 2 + 2 },
  );
}

test.describe('Selection → Path keeps rectangle corners sharp (#1276)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'paths panel requires the desktop sidebar');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('a rectangular marquee becomes four corner anchors with handles inside the box', async ({ page }) => {
    await drawRectSelection(page);
    await clickSelectMenuItem(page, 'Selection → Path');

    const paths = await readPaths(page);
    expect(paths).toHaveLength(1);
    const { closed, anchors } = paths[0]!;
    expect(closed).toBe(true);

    const corners = anchors.map((a) => `${a.point.x},${a.point.y}`).sort();
    expect(corners).toEqual(
      [
        `${BOX.x},${BOX.y}`,
        `${BOX.x + BOX.w},${BOX.y}`,
        `${BOX.x + BOX.w},${BOX.y + BOX.h}`,
        `${BOX.x},${BOX.y + BOX.h}`,
      ].sort(),
    );

    for (const a of anchors) {
      for (const h of [a.handleIn, a.handleOut]) {
        if (!h) continue;
        expect(h.x).toBeGreaterThanOrEqual(BOX.x);
        expect(h.x).toBeLessThanOrEqual(BOX.x + BOX.w);
        expect(h.y).toBeGreaterThanOrEqual(BOX.y);
        expect(h.y).toBeLessThanOrEqual(BOX.y + BOX.h);
        // Corner handles run along an edge: they share the anchor's x or y.
        expect(h.x === a.point.x || h.y === a.point.y).toBe(true);
      }
    }
  });

  test('stroking the traced path paints the box outline and nothing beyond it', async ({ page }) => {
    await drawRectSelection(page);
    await clickSelectMenuItem(page, 'Selection → Path');
    // Drop the marquee so it can't clip an overshooting stroke.
    await clickSelectMenuItem(page, 'Deselect');
    await strokeSelectedPath(page);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'selection-to-path-corners-stroked.png') });

    const probe = await probeStroke(page);
    // The four edge midpoints sit on the stroked outline...
    for (const alpha of probe.edgeMidpoints) expect(alpha).toBeGreaterThan(200);
    // ...the middle of the box is untouched...
    expect(probe.insideCenter).toBe(0);
    // ...and no paint lands farther out than half the stroke width.
    expect(probe.outsideOpaque).toBe(0);
  });
});
