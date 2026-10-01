/**
 * #794 — the Shape tool draws rectangles of any aspect.
 *
 * Before the Rectangle shape existed the only four-sided shape was Polygon
 * with Sides 4, which fits a *regular* polygon in the drag box: Pixels output
 * painted a min(w, h) square and Path output a stretched diamond. Rectangle
 * fills the whole drag box (or the typed Width × Height), rounds its corners
 * with Corner Radius, and takes a fill, a stroke, or both, in either output.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, selectTool, setToolOption, docToScreen, getPixelAt } from './helpers';

const DOC_W = 600;
const DOC_H = 400;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Doc-space bounding box of the active layer's pixels with alpha > 127. */
async function opaqueBounds(page: Page): Promise<Bounds | null> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const res = await readFn(doc.activeLayerId);
    if (!res || res.width === 0 || !layer) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < res.height; y++) {
      for (let x = 0; x < res.width; x++) {
        if ((res.pixels[(y * res.width + x) * 4 + 3] ?? 0) <= 127) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (minX === Infinity) return null;
    return { minX: minX + layer.x, minY: minY + layer.y, maxX: maxX + layer.x, maxY: maxY + layer.y };
  });
}

function expectBounds(actual: Bounds | null, expected: Bounds, slack = 2): void {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.minX - expected.minX)).toBeLessThanOrEqual(slack);
  expect(Math.abs(actual!.minY - expected.minY)).toBeLessThanOrEqual(slack);
  expect(Math.abs(actual!.maxX - expected.maxX)).toBeLessThanOrEqual(slack);
  expect(Math.abs(actual!.maxY - expected.maxY)).toBeLessThanOrEqual(slack);
}

function shapeToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Shape options' });
}

async function chooseRectangle(page: Page, output: 'pixels' | 'path' = 'pixels') {
  await selectTool(page, 'shape');
  const toolbar = shapeToolbar(page);
  await toolbar.locator('[aria-labelledby="shape-mode-label"]').selectOption({ label: 'Rectangle' });
  await toolbar.locator('[aria-labelledby="shape-output-label"]').selectOption(output);
}

/** Shape drags run from the centre out to a corner. */
async function dragFromCentre(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC_W, DOC_H, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

test('dragging a Rectangle fills the whole 300 × 100 drag box (#794)', async ({ page }) => {
  await chooseRectangle(page);
  // Centre (300,200) to corner (450,250) asks for 300 × 100.
  await dragFromCentre(page, { x: 300, y: 200 }, { x: 450, y: 250 });
  await page.screenshot({ path: 'e2e/screenshots/shape-rectangle-drag.png' });

  // Polygon 4 used to give a 100 × 100 square at (250,150)-(349,249).
  expectBounds(await opaqueBounds(page), { minX: 150, minY: 150, maxX: 449, maxY: 249 });
  // Square corners: the pixel just inside each corner is filled.
  expect((await getPixelAt(page, 152, 152)).a).toBe(255);
  expect((await getPixelAt(page, 447, 247)).a).toBe(255);
  expect((await getPixelAt(page, 300, 200)).a).toBe(255);
  expect((await getPixelAt(page, 300, 140)).a).toBe(0);
});

test('Corner Radius rounds a non-square Rectangle without squaring it (#794)', async ({ page }) => {
  await chooseRectangle(page);
  await setToolOption(page, 'Corner Radius', 40);
  await dragFromCentre(page, { x: 300, y: 200 }, { x: 450, y: 250 });
  await page.screenshot({ path: 'e2e/screenshots/shape-rectangle-rounded.png' });

  // The box is still 300 × 100 — Polygon 4 + radius gave a rounded 100 × 100 square.
  expectBounds(await opaqueBounds(page), { minX: 150, minY: 150, maxX: 449, maxY: 249 });
  // A 40px corner arc: the box corner is cut away...
  expect((await getPixelAt(page, 153, 153)).a).toBe(0);
  expect((await getPixelAt(page, 446, 246)).a).toBe(0);
  // ...but the straight edges either side of it are filled.
  expect((await getPixelAt(page, 195, 152)).a).toBe(255);
  expect((await getPixelAt(page, 152, 195)).a).toBe(255);
  expect((await getPixelAt(page, 404, 247)).a).toBe(255);
});

test('a stroke-only Rectangle outlines the full box with an even stroke (#794)', async ({ page }) => {
  await chooseRectangle(page);
  const toolbar = shapeToolbar(page);
  await toolbar.locator('button[aria-label^="Color: "]').click();
  await page.getByRole('button', { name: 'Remove fill' }).click();
  await toolbar.locator('[aria-label="Add stroke color"]').click();
  await page.getByRole('button', { name: 'Remove stroke' }).waitFor();
  await toolbar.getByText('Stroke', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove stroke' })).toHaveCount(0);
  await setToolOption(page, 'Width', 10);

  await dragFromCentre(page, { x: 300, y: 200 }, { x: 450, y: 250 });
  await page.screenshot({ path: 'e2e/screenshots/shape-rectangle-stroke.png' });

  // The 10px stroke is centred on the box edge: 5px outside, 5px inside.
  expectBounds(await opaqueBounds(page), { minX: 145, minY: 145, maxX: 454, maxY: 254 });
  for (const [x, y] of [[300, 150], [300, 249], [150, 200], [449, 200]] as const) {
    expect((await getPixelAt(page, x, y)).a).toBe(255);
  }
  expect((await getPixelAt(page, 300, 200)).a).toBe(0);
  expect((await getPixelAt(page, 200, 170)).a).toBe(0);
});

test('Path output gives a rectangle path on the drag box, not a diamond (#794)', async ({ page }) => {
  await chooseRectangle(page, 'path');
  await dragFromCentre(page, { x: 300, y: 200 }, { x: 450, y: 250 });
  await page.screenshot({ path: 'e2e/screenshots/shape-rectangle-path.png' });

  const paths = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        paths: Array<{ closed: boolean; anchors: Array<{ point: { x: number; y: number } }> }>;
      };
    };
    return store.getState().paths.map((p) => ({ closed: p.closed, points: p.anchors.map((a) => a.point) }));
  });
  expect(paths).toHaveLength(1);
  expect(paths[0]!.closed).toBe(true);
  const expected = [
    { x: 150, y: 150 },
    { x: 450, y: 150 },
    { x: 450, y: 250 },
    { x: 150, y: 250 },
  ];
  expect(paths[0]!.points).toHaveLength(4);
  paths[0]!.points.forEach((p, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThanOrEqual(2);
  });
  // Path output leaves no pixels behind.
  expect(await opaqueBounds(page)).toBeNull();
});

test('clicking with Rectangle and typing 240 × 80 makes that rectangle (#794)', async ({ page }) => {
  await chooseRectangle(page);
  const click = await docToScreen(page, 300, 200);
  await page.mouse.move(click.x, click.y);
  await page.mouse.down();
  await page.mouse.up();

  const heading = page.locator('h2:has-text("Shape Size")');
  await expect(heading).toBeVisible({ timeout: 3000 });
  const modal = heading.locator('xpath=ancestor::*[contains(@class,"modal")][1]');
  const inputs = modal.locator('input[type="number"]');
  await inputs.nth(0).fill('240');
  await inputs.nth(1).fill('80');
  await inputs.nth(1).press('Enter');
  await expect(heading).toHaveCount(0, { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/screenshots/shape-rectangle-typed.png' });

  expectBounds(await opaqueBounds(page), { minX: 180, minY: 160, maxX: 419, maxY: 239 });
  expect((await getPixelAt(page, 182, 162)).a).toBe(255);
});
