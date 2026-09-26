/**
 * #900 — the ellipse stroke must be the same thickness all the way round.
 *
 * The shape shader's ellipse distance used to be a scaled-circle estimate,
 * exact on the minor axis but too small by the aspect ratio on the major
 * axis, so a Width-10 stroke on a 720x150 ellipse was ~10px at the top and
 * ~48px at the left/right tips, and overshot the bounding box.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, selectTool, setToolOption, docToScreen } from './helpers';

const DOC_W = 800;
const DOC_H = 600;
const CENTER = { x: 400, y: 300 };
const RX = 360;
const RY = 75;
const STROKE_WIDTH = 10;

interface Scan {
  thickness: number;
  first: number;
  last: number;
}

/**
 * Reads the active layer once and measures the stroke band along a doc-space
 * column (fixed x) and a doc-space row (fixed y). Thickness is the summed
 * coverage (alpha / 255), which equals the band width in px and is robust to
 * the anti-aliased edge pixels.
 */
async function scanStroke(
  page: Page,
  column: { x: number; y0: number; y1: number },
  row: { y: number; x0: number; x1: number },
): Promise<{ top: Scan; tip: Scan }> {
  return page.evaluate(
    async ({ column, row }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
        };
      };
      const doc = store.getState().document;
      const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const res = await readFn(doc.activeLayerId);
      const alphaAt = (x: number, y: number): number => {
        if (!res) return 0;
        const px = x - lx;
        const py = y - ly;
        if (px < 0 || py < 0 || px >= res.width || py >= res.height) return 0;
        return res.pixels[(py * res.width + px) * 4 + 3] ?? 0;
      };
      const measure = (samples: Array<[number, number, number]>) => {
        let thickness = 0;
        let first = -1;
        let last = -1;
        for (const [coord, x, y] of samples) {
          const a = alphaAt(x, y);
          thickness += a / 255;
          if (a > 127) {
            if (first < 0) first = coord;
            last = coord;
          }
        }
        return { thickness, first, last };
      };
      const colSamples: Array<[number, number, number]> = [];
      for (let y = column.y0; y <= column.y1; y++) colSamples.push([y, column.x, y]);
      const rowSamples: Array<[number, number, number]> = [];
      for (let x = row.x0; x <= row.x1; x++) rowSamples.push([x, x, row.y]);
      return { top: measure(colSamples), tip: measure(rowSamples) };
    },
    { column, row },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC_W, DOC_H);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

test('ellipse stroke is uniform thickness on an eccentric ellipse (#900)', async ({ page }) => {
  await selectTool(page, 'shape');
  const toolbar = page.getByRole('toolbar', { name: 'Shape options' });
  await toolbar.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
  await toolbar.locator('[aria-labelledby="shape-output-label"]').selectOption('pixels');

  // Remove the fill via its swatch popover (the only swatch before a stroke
  // is added).
  await expect(toolbar.locator('button[aria-label^="Color: "]')).toHaveCount(1);
  await toolbar.locator('button[aria-label^="Color: "]').click();
  await page.getByRole('button', { name: 'Remove fill' }).click();

  // Add a stroke — it starts black — then dismiss its popover.
  await toolbar.locator('[aria-label="Add stroke color"]').click();
  await page.getByRole('button', { name: 'Remove stroke' }).waitFor();
  await toolbar.getByText('Stroke', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove stroke' })).toHaveCount(0);
  await setToolOption(page, 'Width', STROKE_WIDTH);

  // The shape tool drags from the centre: (400,300)->(760,375) is 720x150.
  const start = await docToScreen(page, CENTER.x, CENTER.y);
  const end = await docToScreen(page, CENTER.x + RX, CENTER.y + RY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'e2e/screenshots/shape-ellipse-stroke-uniform.png' });

  // Top of the ellipse: boundary at y = 300 - 75 = 225, stroke band 220..230.
  // Left tip: boundary at x = 400 - 360 = 40, stroke band 35..45.
  const { top, tip } = await scanStroke(
    page,
    { x: CENTER.x, y0: CENTER.y - RY - 40, y1: CENTER.y - RY + 40 },
    { y: CENTER.y, x0: 0, x1: CENTER.x - RX + 60 },
  );
  console.log(`#900 stroke thickness: top=${top.thickness.toFixed(2)}px [${top.first}..${top.last}] ` +
    `tip=${tip.thickness.toFixed(2)}px [${tip.first}..${tip.last}]`);

  expect(top.thickness).toBeGreaterThan(STROKE_WIDTH - 2);
  expect(top.thickness).toBeLessThan(STROKE_WIDTH + 2);
  // The tip used to be ~48px (4.8x, the aspect ratio).
  expect(tip.thickness).toBeGreaterThan(STROKE_WIDTH - 2);
  expect(tip.thickness).toBeLessThan(STROKE_WIDTH + 2);

  // The band must sit centred on the requested boundary, not overshoot it.
  expect(top.first).toBeGreaterThanOrEqual(CENTER.y - RY - STROKE_WIDTH / 2 - 1);
  expect(top.last).toBeLessThanOrEqual(CENTER.y - RY + STROKE_WIDTH / 2 + 1);
  expect(tip.first).toBeGreaterThanOrEqual(CENTER.x - RX - STROKE_WIDTH / 2 - 1);
  expect(tip.last).toBeLessThanOrEqual(CENTER.x - RX + STROKE_WIDTH / 2 + 1);

  // The ellipse interior stays empty (fill was removed).
  const inner = await scanStroke(
    page,
    { x: CENTER.x, y0: CENTER.y - 20, y1: CENTER.y + 20 },
    { y: CENTER.y, x0: CENTER.x - 20, x1: CENTER.x + 20 },
  );
  expect(inner.top.thickness).toBe(0);
  expect(inner.tip.thickness).toBe(0);
});
