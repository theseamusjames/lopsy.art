/**
 * #1640: on NVIDIA under ANGLE/Vulkan, the Stroke effect drew nothing at
 * Width 1–10 — the widths that went through a single-pass brute-force
 * search (stroke_edt.glsl) — while Width 11+ (the two-pass separable band)
 * drew correctly. Every width now goes through the band. This checks the
 * narrow widths at each position still draw a ring of the set width, so a
 * path that silently draws nothing (on any GPU) fails here.
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
const SQUARE = { x0: 100, y0: 60, x1: 220, y1: 160 };
const ROWS = [100, 110, 120];
const WIDTHS = [2, 4, 8, 10, 11];
const POSITIONS = ['outside', 'center', 'inside'] as const;

interface LayerPixels { width: number; height: number; pixels: number[]; x: number; y: number }

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

/** Length of the black run starting at the first opaque pixel at or after `fromX` on row `y`. */
function darkRun(px: LayerPixels, y: number, fromX: number): number {
  const ly = y - px.y;
  let x = Math.max(0, fromX - px.x);
  const at = (lx: number): [number, number] => {
    const i = (ly * px.width + lx) * 4;
    return [px.pixels[i] ?? 0, px.pixels[i + 3] ?? 0];
  };
  while (x < px.width && at(x)[1] < 128) x++;
  let run = 0;
  while (x < px.width) {
    const [r, a] = at(x);
    if (a < 128 || r > 128) break;
    run++;
    x++;
  }
  return run;
}

async function fillSquare(page: Page): Promise<void> {
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'marquee-rect');
  const a = await docToScreen(page, SQUARE.x0, SQUARE.y0);
  const b = await docToScreen(page, SQUARE.x1, SQUARE.y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press(`${mod}+d`);
  await page.waitForTimeout(100);
}

test.describe('Stroke effect at narrow widths (#1640)', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires the sidebar');
  });

  test('every narrow width draws a ring of that width at each position', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 320, 220, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    const layerId = await addLayer(page);
    await fillSquare(page);

    const results: string[] = [];
    const failures: string[] = [];
    for (const position of POSITIONS) {
      for (const width of WIDTHS) {
        await configureEffect(page, 'Stroke', { Width: width });
        await page.locator(`[aria-label="Stroke position: ${position}"]`).click();
        await setEffectColor(page, 'Stroke color', 0, 0, 0);
        await page.waitForTimeout(150);
        await page.getByTestId('effects-drawer').getByRole('button', { name: 'Rasterize Layer Style' }).click();
        await page.waitForTimeout(200);

        const px = await readLayer(page, layerId);
        const runs = ROWS.map((y) => darkRun(px, y, SQUARE.x0 - width - 6));
        const mean = runs.reduce((s, r) => s + r, 0) / runs.length;
        results.push(`${position} W${width}=${mean.toFixed(1)}`);
        if (Math.abs(mean - width) > 1) failures.push(`${position} W${width}: ring ${mean.toFixed(1)} px`);

        await page.keyboard.press(`${mod}+z`);
        await page.waitForTimeout(200);
      }
    }
    await closeEffectsPanel(page);
    console.log(`#1640 ring widths: ${results.join(', ')}`);
    expect(failures).toEqual([]);
  });
});
