/**
 * #1279: above a 10 px half-width the Stroke effect switched from a
 * per-pixel distance search to a separable max-dilation — a square kernel,
 * so the band was measured in Chebyshev distance and came out √2 too thick
 * on a 45° edge (Width 16 → 22.6 px perpendicular) while axis-aligned edges
 * stayed right, and Width 10 → 11 jumped from 10 px to 15.6 px.
 *
 * The test fills a 45° diamond and an axis-aligned square on one layer,
 * applies a black Inside stroke, bakes it with Rasterize Layer Style and
 * measures the band on the layer's own pixels: along a row, the dark run
 * from the diamond's edge is the perpendicular width × √2.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  selectTool,
  docToScreen,
  setForegroundColor,
  configureEffect,
  setEffectColor,
  closeEffectsPanel,
} from './helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// Diamond |x − 180| + |y − 200| ≤ 140; its upper-left edge crosses row y at x = 40 + |y − 200|.
const DIAMOND = { cx: 180, cy: 200, r: 140 };
// Rows on the upper-left edge, well clear of the vertices.
const DIAMOND_ROWS = [120, 125, 130, 135, 140, 145, 150, 155, 160];
// Axis-aligned square: x 400..560, y 80..320.
const SQUARE = { x0: 400, y0: 80, x1: 560, y1: 320 };
const SQUARE_ROWS = [180, 200, 220];

interface LayerPixels { width: number; height: number; pixels: number[]; x: number; y: number }

async function menu(page: Page, top: string, item: string): Promise<void> {
  await page.getByRole('button', { name: top, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

async function drag(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  const screen: Array<{ x: number; y: number }> = [];
  for (const p of points) screen.push(await docToScreen(page, p.x, p.y));
  await page.mouse.move(screen[0]!.x, screen[0]!.y);
  await page.mouse.down();
  for (const s of screen.slice(1)) await page.mouse.move(s.x, s.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function fillShapes(page: Page): Promise<void> {
  await setForegroundColor(page, 255, 0, 0);
  const { cx, cy, r } = DIAMOND;
  await selectTool(page, 'lasso');
  await drag(page, [
    { x: cx, y: cy - r }, { x: cx + r, y: cy }, { x: cx, y: cy + r }, { x: cx - r, y: cy }, { x: cx, y: cy - r },
  ]);
  await menu(page, 'Edit', 'Fill');
  await page.keyboard.press(`${mod}+d`);
  await page.waitForTimeout(100);

  await selectTool(page, 'marquee-rect');
  await drag(page, [{ x: SQUARE.x0, y: SQUARE.y0 }, { x: SQUARE.x1, y: SQUARE.y1 }]);
  await menu(page, 'Edit', 'Fill');
  await page.keyboard.press(`${mod}+d`);
  await page.waitForTimeout(100);
}

async function readLayer(page: Page, layerId: string): Promise<LayerPixels> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    };
    const px = await w.__readLayerPixels(id);
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === id);
    return { width: px?.width ?? 0, height: px?.height ?? 0, pixels: px?.pixels ?? [], x: layer?.x ?? 0, y: layer?.y ?? 0 };
  }, layerId);
}

/** Length of the black run that starts at the first opaque pixel at or after `fromX` on row `y`. */
function darkRun(px: LayerPixels, y: number, fromX: number): number {
  const ly = y - px.y;
  let x = fromX - px.x;
  const at = (lx: number): number[] => {
    const i = (ly * px.width + lx) * 4;
    return [px.pixels[i] ?? 0, px.pixels[i + 3] ?? 0];
  };
  while (x < px.width && at(x)[1]! < 128) x++;
  let run = 0;
  while (x < px.width) {
    const [r, a] = at(x);
    if (a! < 128 || r! > 128) break;
    run++;
    x++;
  }
  return run;
}

function diamondBandWidth(px: LayerPixels): number {
  const runs = DIAMOND_ROWS.map((y) => darkRun(px, y, DIAMOND.cx - DIAMOND.r - 5));
  return runs.reduce((a, b) => a + b, 0) / runs.length / Math.SQRT2;
}

function squareBandWidth(px: LayerPixels): number {
  const runs = SQUARE_ROWS.map((y) => darkRun(px, y, SQUARE.x0 - 5));
  return runs.reduce((a, b) => a + b, 0) / runs.length;
}

async function strokeAndRasterize(page: Page, layerId: string, width: number): Promise<LayerPixels> {
  await configureEffect(page, 'Stroke', { Width: width });
  await page.locator('[aria-label="Stroke position: inside"]').click();
  await setEffectColor(page, 'Stroke color', 0, 0, 0);
  await page.waitForTimeout(150);
  await page.getByTestId('effects-drawer').getByRole('button', { name: 'Rasterize Layer Style' }).click();
  await page.waitForTimeout(200);
  return readLayer(page, layerId);
}

test.describe('Stroke effect width on diagonal edges (#1279)', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('wide inside stroke is the set width perpendicular to a 45° edge', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    const layerId = await addLayer(page);
    await fillShapes(page);

    const at10 = await strokeAndRasterize(page, layerId, 10);
    const diamond10 = diamondBandWidth(at10);
    await page.keyboard.press(`${mod}+z`);
    await page.waitForTimeout(200);

    const at11 = await strokeAndRasterize(page, layerId, 11);
    const diamond11 = diamondBandWidth(at11);
    await page.keyboard.press(`${mod}+z`);
    await page.waitForTimeout(200);

    const at16 = await strokeAndRasterize(page, layerId, 16);
    await closeEffectsPanel(page);
    await page.screenshot({ path: 'e2e/screenshots/stroke-effect-diagonal-1279.png' });
    const diamond16 = diamondBandWidth(at16);
    const square16 = squareBandWidth(at16);
    console.log(`#1279 diamond perpendicular: W10=${diamond10.toFixed(2)} W11=${diamond11.toFixed(2)} W16=${diamond16.toFixed(2)}; square W16=${square16.toFixed(2)}`);

    // Axis-aligned control: exactly the width.
    expect(Math.abs(square16 - 16)).toBeLessThanOrEqual(1);
    // 45° edge: the width perpendicular to the edge, not √2 × width (22.6).
    expect(Math.abs(diamond16 - 16)).toBeLessThanOrEqual(1.5);
    // No jump where the engine changes algorithm: 10 → 11 adds ~1 px.
    expect(Math.abs(diamond10 - 10)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(diamond11 - 11)).toBeLessThanOrEqual(1.5);
    expect(diamond11 - diamond10).toBeGreaterThan(0.2);
    expect(diamond11 - diamond10).toBeLessThan(2);
  });
});
