/**
 * A Polygon drawn with Path output must be the same polygon Pixels output
 * paints for the same drag (#794 follow-up).
 *
 * Pixels output is the regular polygon `sdPolygon` fits inside the drag box
 * (rounded by Corner Radius). Path output used to put the vertices on the
 * drag box's ellipse — a stretched polygon, with sharp corners whatever the
 * radius — so stroking the path did not trace the painted shape.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, selectTool, setToolOption, docToScreen } from './helpers';

const DOC_W = 600;
const DOC_H = 400;
const CENTRE = { x: 300, y: 200 };
const CORNER = { x: 450, y: 280 };

async function dragFromCentre(page: Page) {
  const start = await docToScreen(page, CENTRE.x, CENTRE.y);
  const end = await docToScreen(page, CORNER.x, CORNER.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

interface Match {
  fillBoundary: number;
  stroke: number;
  /** Fraction of stroke pixels within 2px of the painted polygon's edge. */
  strokeOnEdge: number;
  /** Fraction of the painted polygon's edge pixels within 2px of the stroke. */
  edgeCovered: number;
}

/** Compares the painted polygon's outline with the stroked path, in doc space. */
async function compareOutlines(page: Page, fillLayerId: string, strokeLayerId: string): Promise<Match> {
  return page.evaluate(async ({ fillLayerId, strokeLayerId, w, h }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const opaqueMask = async (id: string): Promise<Uint8Array> => {
      const layer = store.getState().document.layers.find((l) => l.id === id)!;
      const res = await readFn(id);
      const mask = new Uint8Array(w * h);
      if (!res) return mask;
      for (let y = 0; y < res.height; y++) {
        for (let x = 0; x < res.width; x++) {
          const dx = x + layer.x;
          const dy = y + layer.y;
          if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
          if ((res.pixels[(y * res.width + x) * 4 + 3] ?? 0) > 127) mask[dy * w + dx] = 1;
        }
      }
      return mask;
    };
    const fill = await opaqueMask(fillLayerId);
    const stroke = await opaqueMask(strokeLayerId);
    const at = (m: Uint8Array, x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]!);
    const near = (m: Uint8Array, x: number, y: number) => {
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (at(m, x + ox, y + oy)) return true;
      return false;
    };
    const edge = new Uint8Array(w * h);
    let fillBoundary = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!at(fill, x, y)) continue;
        if (at(fill, x - 1, y) && at(fill, x + 1, y) && at(fill, x, y - 1) && at(fill, x, y + 1)) continue;
        edge[y * w + x] = 1;
        fillBoundary++;
      }
    }
    let strokeCount = 0;
    let strokeOnEdge = 0;
    let edgeCovered = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (at(stroke, x, y)) {
          strokeCount++;
          if (near(edge, x, y)) strokeOnEdge++;
        }
        if (at(edge, x, y) && near(stroke, x, y)) edgeCovered++;
      }
    }
    return {
      fillBoundary,
      stroke: strokeCount,
      strokeOnEdge: strokeCount ? strokeOnEdge / strokeCount : 0,
      edgeCovered: fillBoundary ? edgeCovered / fillBoundary : 0,
    };
  }, { fillLayerId, strokeLayerId, w: DOC_W, h: DOC_H });
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC_W, DOC_H, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

for (const { sides, radius } of [
  { sides: 5, radius: 0 },
  { sides: 5, radius: 20 },
  { sides: 6, radius: 25 },
]) {
  test(`a stroked Path-output polygon traces the Pixels-output polygon (sides ${sides}, radius ${radius})`, async ({ page }) => {
    await selectTool(page, 'shape');
    const toolbar = page.getByRole('toolbar', { name: 'Shape options' });
    await toolbar.locator('[aria-labelledby="shape-mode-label"]').selectOption({ label: 'Polygon' });
    await toolbar.locator('[aria-labelledby="shape-output-label"]').selectOption('pixels');
    await page.locator('#polygon-sides').fill(String(sides));
    await setToolOption(page, 'Corner Radius', radius);

    // 1. Paint the polygon on the first layer. The drag asks for a 300 × 160 box.
    const fillLayerId = await activeLayerId(page);
    await dragFromCentre(page);

    // 2. Same drag with Path output, then stroke the path onto a new layer.
    await page.locator('[aria-label="Add Layer"]').click();
    const strokeLayerId = await activeLayerId(page);
    expect(strokeLayerId).not.toBe(fillLayerId);
    await selectTool(page, 'shape');
    await toolbar.locator('[aria-labelledby="shape-output-label"]').selectOption('path');
    await dragFromCentre(page);

    const pathsList = page.locator('[role="listbox"][aria-label="Paths"]');
    if (!(await pathsList.isVisible().catch(() => false))) {
      await page.locator('[role="toolbar"][aria-label="Panel visibility"] button[aria-label="Paths"]').click();
    }
    await expect(pathsList.locator('[role="option"]')).toHaveCount(1);
    // The new path is selected on creation; clicking a selected row deselects it.
    const pathRow = pathsList.locator('[role="option"]').first();
    if ((await pathRow.getAttribute('aria-selected')) !== 'true') await pathRow.click();
    await expect(pathRow).toHaveAttribute('aria-selected', 'true');
    await page.locator('button[aria-label="Stroke Path"]').click();
    const dialog = page.getByRole('dialog', { name: 'Stroke Path' });
    await dialog.locator('input[type="number"]').fill('2');
    await dialog.getByRole('button', { name: 'Stroke' }).click();
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `e2e/screenshots/shape-polygon-path-vs-pixels-${sides}-${radius}.png` });

    const match = await compareOutlines(page, fillLayerId, strokeLayerId);
    console.log(`sides ${sides} radius ${radius}: ${JSON.stringify(match)}`);
    expect(match.fillBoundary).toBeGreaterThan(300);
    expect(match.stroke).toBeGreaterThan(300);
    // The 2px stroke rides on the painted edge all the way round.
    expect(match.strokeOnEdge).toBeGreaterThan(0.98);
    expect(match.edgeCovered).toBeGreaterThan(0.98);
  });
}
