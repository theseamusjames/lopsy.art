import { test, expect, type Page } from '@playwright/test';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setForegroundColor,
  selectTool,
  setToolOption,
  getEditorState,
} from './helpers';

/**
 * #907 — painting a layer mask on a layer that has been moved corrupts
 * compositing.
 *
 * Variant A (nudge): the layer keeps a full-canvas texture offset to y=8.
 * Selecting the brush prewarms the stroke, which grows the layer to
 * 1200x608 — and the shared scratch textures with it. The compositor then
 * rendered every pass at the 1200x600 doc viewport but blitted the whole
 * 1200x608 scratch back, squashing the entire composite (every layer)
 * vertically with a transparent band at the bottom.
 *
 * Variant B (Move-tool drag): the layer is cropped to 400x90 at (650,340).
 * The mask was created at that cropped size, the brush prewarm re-origined
 * the layer to (0,0), and the mask brush / edit overlay used layer-local
 * coordinates while the compositor sampled raster masks at the document
 * origin — so the stroke drew near the top-left and the layer vanished once
 * it was cropped again on switch-away.
 */

type Rgba = { r: number; g: number; b: number; a: number };

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 8): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Marquee (rect or ellipse) + Edit > Fill with the foreground color. */
async function marqueeFill(page: Page, tool: 'marquee-rect' | 'marquee-ellipse', x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, tool);
  await dragDoc(page, x0, y0, x1, y1);
  await page.getByRole('button', { name: /^Edit$/ }).click();
  await page.getByRole('menuitem', { name: /^Fill$/ }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(150);
}

/** Composited RGBA at doc (x, y). The GL buffer is bottom-up. */
async function compositeAt(page: Page, docX: number, docY: number): Promise<Rgba> {
  const screen = await docToScreen(page, docX, docY);
  const px = await page.evaluate(async ({ sx, sy }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
    };
    const rect = document.querySelector('[data-testid="canvas-container"]')!.getBoundingClientRect();
    const comp = await w.__readCompositedPixels();
    const scale = comp.width / rect.width;
    const x = Math.round((sx - rect.left) * scale);
    const y = comp.height - 1 - Math.round((sy - rect.top) * scale);
    const i = (y * comp.width + x) * 4;
    return comp.pixels.slice(i, i + 4);
  }, { sx: screen.x, sy: screen.y });
  return { r: px[0]!, g: px[1]!, b: px[2]!, a: px[3]! };
}

const isWhite = (p: Rgba): boolean => p.a > 240 && p.r > 230 && p.g > 230 && p.b > 230;
const isRed = (p: Rgba): boolean => p.a > 240 && p.r > 180 && p.g < 80 && p.b < 80;
const isBlue = (p: Rgba): boolean => p.a > 240 && p.b > 150 && p.r < 90;

async function layerBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const state = await getEditorState(page);
  const layer = state.document.layers.find((l) => l.id === id) as unknown as { x: number; y: number; width: number; height: number };
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

/** 1200x600 white doc with a blue ellipse layer at (100,50)-(600,550). */
async function setupEllipse(page: Page): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 1200, 600, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(200);
  const ellipseLayer = await addLayer(page);
  await setForegroundColor(page, 20, 80, 220);
  await marqueeFill(page, 'marquee-ellipse', 100, 50, 600, 550);
  return ellipseLayer;
}

/** Add Mask on the active layer, enter mask edit, select a black 60px brush. */
async function addMaskAndPickBrush(page: Page): Promise<void> {
  await page.locator('[aria-label="Add Mask"]').click();
  await page.getByRole('button', { name: /Edit mask for/ }).click();
  await setForegroundColor(page, 0, 0, 0);
  await selectTool(page, 'brush');
  await setToolOption(page, 'Size', 60);
  await page.waitForTimeout(150);
}

test.describe('#907: layer mask painting on a moved layer', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('variant A: mask stroke on a nudged layer does not squash the composite', async ({ page }) => {
    test.setTimeout(120_000);
    const ellipseLayer = await setupEllipse(page);

    const strip = await addLayer(page);
    await setForegroundColor(page, 230, 20, 20);
    await marqueeFill(page, 'marquee-rect', 150, 460, 550, 550);

    await selectTool(page, 'move');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(200);
    // The nudge leaves a full-canvas texture offset below the doc origin —
    // the precondition for the prewarm to grow it past the doc height.
    expect(await layerBox(page, strip)).toEqual({ x: 0, y: 8, width: 1200, height: 600 });

    await addMaskAndPickBrush(page);
    // Strip now spans y 468..558. Stroke across it at y=510 (hides 480..540).
    await dragDoc(page, 200, 510, 500, 510, 20);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/mask-moved-layer-907-a-paint.png' });

    // Bottom rows hold only the white Background: a squashed composite
    // showed a transparent band here.
    expect(isWhite(await compositeAt(page, 900, 596))).toBe(true);
    expect(isWhite(await compositeAt(page, 100, 596))).toBe(true);

    // Leave mask edit by selecting the ellipse layer; the strip is cropped.
    await page.locator(`[data-layer-id="${ellipseLayer}"]`).click();
    await expect.poll(async () => (await layerBox(page, strip)).width, { timeout: 5_000 }).toBeLessThan(1200);

    await page.screenshot({ path: 'e2e/screenshots/mask-moved-layer-907-a-after.png' });

    expect(isWhite(await compositeAt(page, 900, 596))).toBe(true);
    expect(isWhite(await compositeAt(page, 100, 596))).toBe(true);
    // Unmasked strip below the stroke is still red, at its nudged position.
    expect(isRed(await compositeAt(page, 350, 553))).toBe(true);
    expect(isRed(await compositeAt(page, 530, 553))).toBe(true);
    // Under the stroke the strip is hidden and the ellipse shows through.
    expect(isBlue(await compositeAt(page, 350, 510))).toBe(true);
    // Ellipse top edge is where it was drawn (y=50), not shifted.
    expect(isBlue(await compositeAt(page, 350, 56))).toBe(true);
    expect(isWhite(await compositeAt(page, 350, 44))).toBe(true);
  });

  test('variant B: mask stroke on a dragged, cropped layer lands under the brush', async ({ page }) => {
    test.setTimeout(120_000);
    const ellipseLayer = await setupEllipse(page);

    const strip = await addLayer(page);
    await setForegroundColor(page, 230, 20, 20);
    await marqueeFill(page, 'marquee-rect', 650, 300, 1050, 390);

    await selectTool(page, 'move');
    await dragDoc(page, 850, 345, 850, 385);
    await page.waitForTimeout(200);
    // The drag leaves the texture cropped to the strip's content.
    expect(await layerBox(page, strip)).toEqual({ x: 650, y: 340, width: 400, height: 90 });

    await addMaskAndPickBrush(page);
    // Strip spans x 650..1050, y 340..430. Stroke across its left part.
    await dragDoc(page, 700, 385, 800, 385, 20);
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/mask-moved-layer-907-b-paint.png' });

    // Mask edit overlay tints the stroke blue where the brush went...
    const overlay = await compositeAt(page, 740, 385);
    expect(overlay.b).toBeGreaterThan(90);
    expect(isRed(await compositeAt(page, 950, 385))).toBe(true);
    // ...and not near the canvas's top-left corner.
    expect(isWhite(await compositeAt(page, 60, 30))).toBe(true);
    expect(isWhite(await compositeAt(page, 90, 20))).toBe(true);

    await page.locator(`[data-layer-id="${ellipseLayer}"]`).click();
    await expect.poll(async () => (await layerBox(page, strip)).x, { timeout: 5_000 }).toBe(650);

    await page.screenshot({ path: 'e2e/screenshots/mask-moved-layer-907-b-after.png' });

    // The strip is still composited: unmasked parts red...
    expect(isRed(await compositeAt(page, 950, 385))).toBe(true);
    expect(isRed(await compositeAt(page, 740, 425))).toBe(true);
    // ...and the stroke hides it, showing the white Background.
    expect(isWhite(await compositeAt(page, 740, 385))).toBe(true);
  });
});
