import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  docToScreen,
  setToolOption,
  setForegroundColor,
  getEditorState,
} from './helpers';

/**
 * #1009 — the Move tool's Flip / Rotate 90° buttons squared the alpha of
 * semi-transparent pixels (α → α²/255) on every click.
 *
 * Root cause: after each click `applyGpuTransform` re-selects from the
 * layer's alpha and schedules a prefloat. Lifting a float multiplied the
 * pixel's alpha by the (soft) mask and cleared the base wherever the mask
 * was non-zero, so a mask built from the layer's own alpha lifted α² and
 * left nothing behind. The lift now takes min(α, mask) and leaves the
 * remainder in the base, so a layer-alpha selection lifts pixels whole.
 */

interface LayerAlpha {
  histogram: number[];
  bboxW: number;
  bboxH: number;
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 20 });
  await page.mouse.up();
}

/** Whole composited WebGL canvas (screen space), as a flat RGBA array. */
async function readComposite(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const fn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    return (await fn()).pixels;
  });
}

/** Alpha histogram (non-zero bins) and content bbox of the active layer. */
async function readLayerAlpha(page: Page): Promise<LayerAlpha> {
  return page.evaluate(async () => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const r = await fn();
    const histogram = new Array<number>(256).fill(0);
    let minX = r.width, minY = r.height, maxX = -1, maxY = -1;
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const a = r.pixels[(y * r.width + x) * 4 + 3] ?? 0;
        if (a === 0) continue;
        histogram[a] = (histogram[a] ?? 0) + 1;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { histogram, bboxW: maxX - minX + 1, bboxH: maxY - minY + 1 };
  });
}

function maxDiff(a: number[], b: number[]): number {
  let m = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return m;
}

function partialCount(histogram: number[]): number {
  return histogram.slice(1, 255).reduce((sum, n) => sum + n, 0);
}

function histogramDistance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < 256; i++) d += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return d;
}

async function paintSoftStroke(page: Page): Promise<void> {
  await createDocument(page, 800, 600, false);
  await page.waitForTimeout(300);
  await selectTool(page, 'brush');
  await setToolOption(page, 'Size', 80);
  await setToolOption(page, 'Hardness', 0);
  await setForegroundColor(page, 0, 0, 0);
  await dragDoc(page, 150, 300, 650, 300);
  await page.waitForTimeout(200);
}

async function marqueeThenMove(page: Page): Promise<void> {
  await selectTool(page, 'marquee-rect');
  // 600×120 around (400, 300): even × even, so flips and 90° turns map
  // pixel centres onto pixel centres, and the stroke is fully inside.
  await dragDoc(page, 100, 240, 700, 360);
  await selectTool(page, 'move');
  await page.waitForTimeout(200);
}

test.describe('#1009 — quick transforms keep soft alpha intact', () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'options bar transform controls live in a sidebar');
    await page.goto('/');
    await waitForStore(page);
    await paintSoftStroke(page);
  });

  test('Flip Horizontal ×4 with a marquee returns the stroke unchanged', async ({ page }) => {
    const compositeBefore = await readComposite(page);
    const alphaBefore = await readLayerAlpha(page);
    // A size-80 hardness-0 stroke has a wide soft falloff band.
    expect(partialCount(alphaBefore.histogram)).toBeGreaterThan(5000);

    await marqueeThenMove(page);
    for (let i = 0; i < 4; i++) {
      await page.locator('button[aria-label="Flip Horizontal"]').click();
      // Let the post-flip prefloat (setTimeout 0) run.
      await page.waitForTimeout(250);
    }
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/transform-soft-alpha-flip4.png' });

    // Four flips is the identity. Before the fix the falloff collapsed to
    // a ~6px hard line: every partial pixel squared four times.
    const alphaAfter = await readLayerAlpha(page);
    expect(histogramDistance(alphaBefore.histogram, alphaAfter.histogram)).toBeLessThanOrEqual(8);
    expect(maxDiff(compositeBefore, await readComposite(page))).toBeLessThanOrEqual(1);
  });

  test('Rotate 90° CW with a marquee keeps every alpha value', async ({ page }) => {
    const before = await readLayerAlpha(page);
    expect(partialCount(before.histogram)).toBeGreaterThan(5000);
    expect(before.bboxW).toBeGreaterThan(before.bboxH * 4);

    await marqueeThenMove(page);
    await page.locator('button[aria-label="Rotate 90° CW"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/transform-soft-alpha-rot90.png' });

    const after = await readLayerAlpha(page);
    // The stroke turned vertical: the bbox swapped its sides.
    expect(after.bboxW).toBe(before.bboxH);
    expect(after.bboxH).toBe(before.bboxW);
    // A 90° turn only permutes pixels, so the alpha histogram is unchanged.
    // Squaring moved every partial pixel to round(a²/255).
    expect(histogramDistance(before.histogram, after.histogram)).toBeLessThanOrEqual(8);
  });

  test('Cmd-clicking the layer thumbnail does not change its pixels', async ({ page }) => {
    const before = await readLayerAlpha(page);
    const { document: doc } = await getEditorState(page);
    await page.locator(`[data-layer-id="${doc.activeLayerId}"]`).locator('canvas').first()
      .click({ modifiers: ['Meta'] });
    // Loading the alpha schedules a prefloat that lifts the pixels.
    await page.waitForTimeout(400);
    const after = await readLayerAlpha(page);
    expect(histogramDistance(before.histogram, after.histogram)).toBeLessThanOrEqual(8);
  });
});
