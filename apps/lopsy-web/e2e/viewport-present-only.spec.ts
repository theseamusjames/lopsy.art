import { test, expect, type Page } from './fixtures';
import {
  addLayer, closeEffectsPanel, configureEffect, createDocument, docToScreen, selectTool,
  setEffectColor, setForegroundColor, waitForStore,
} from './helpers';

// Panning and zooming only move the finished composite on screen, so the
// engine redraws just the final blit from the composite texture it already
// has instead of re-blending every layer. These tests read what is actually
// on screen (a page screenshot, not __readCompositedPixels, which forces a
// full recomposite) after a pan, so they see the re-presented frame.

type Rgb = { r: number; g: number; b: number };

interface CacheStats {
  hits: number;
  misses: number;
}

async function cacheLookups(page: Page): Promise<number> {
  const stats = await page.evaluate(() => {
    const fn = (window as unknown as { __effectCacheStats?: () => CacheStats | null }).__effectCacheStats;
    return fn ? fn() : null;
  });
  expect(stats).not.toBeNull();
  return stats!.hits + stats!.misses;
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
}

/** Screen colour at doc points, from a screenshot of the page. */
async function screenAt(page: Page, points: Array<[number, number]>): Promise<Rgb[]> {
  const screen = await Promise.all(points.map(([x, y]) => docToScreen(page, x + 0.5, y + 0.5)));
  const png = await page.screenshot();
  return page.evaluate(async ({ bytes, pts }) => {
    const img = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), { colorSpaceConversion: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const scale = img.width / window.innerWidth;
    return pts.map(({ x, y }) => {
      const d = ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data;
      return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! };
    });
  }, { bytes: Array.from(png), pts: screen });
}

async function wheelPan(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(dx, dy);
  await page.waitForTimeout(100);
  await nextFrames(page);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

const isRed = (p: Rgb): boolean => p.r > 180 && p.g < 90 && p.b < 90;
const isBlack = (p: Rgb): boolean => p.r < 60 && p.g < 60 && p.b < 60;
const isWhite = (p: Rgb): boolean => p.r > 235 && p.g > 235 && p.b > 235;
const isBlueTint = (p: Rgb): boolean => p.b > 200 && p.r < 170;

test.describe('Pan and zoom re-present the composite', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  });

  test('panning and zooming move the picture without recompositing layers', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await addLayer(page);
    await setForegroundColor(page, 220, 30, 30);
    await selectTool(page, 'marquee-rect');
    await dragDoc(page, 100, 80, 220, 180);
    await page.getByRole('button', { name: /^Edit$/ }).click();
    await page.getByRole('menuitem', { name: /^Fill$/ }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await configureEffect(page, 'Drop Shadow', { 'Offset X': 30, 'Offset Y': 30, Blur: 0, Opacity: 100 });
    await setEffectColor(page, 'Shadow color', 0, 0, 0);
    await closeEffectsPanel(page);
    await nextFrames(page);

    const probes: Array<[number, number]> = [[150, 120], [240, 200], [300, 60]];
    const before = await screenAt(page, probes);
    expect(isRed(before[0]!)).toBe(true);
    expect(isBlack(before[1]!)).toBe(true);
    expect(isWhite(before[2]!)).toBe(true);

    // Every full composite looks up the styled layer's cached effects once;
    // re-presenting the composite looks up nothing.
    const lookups = await cacheLookups(page);
    await wheelPan(page, 60, 40);
    await wheelPan(page, -25, 15);
    const box = (await page.locator('[data-testid="canvas-container"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    await nextFrames(page);
    expect(await cacheLookups(page), 'pan and zoom did not recomposite').toBe(lookups);

    const vp = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number; panX: number; panY: number } };
      };
      return store.getState().viewport;
    });
    expect(vp.panX !== 0 || vp.panY !== 0).toBe(true);
    expect(vp.zoom).toBeGreaterThan(1);

    // The same document points, at their new screen positions, show the same
    // content: the re-presented frame follows the viewport.
    await page.screenshot({ path: 'e2e/screenshots/viewport-present-only-pan.png' });
    const after = await screenAt(page, probes);
    expect(isRed(after[0]!)).toBe(true);
    expect(isBlack(after[1]!)).toBe(true);
    expect(isWhite(after[2]!)).toBe(true);
  });

  test('an export does not leave its render on screen for the next pan', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Quick Mask tints the live composite; the export render has no tint.
    await page.keyboard.press('q');
    await nextFrames(page);
    expect(isBlueTint((await screenAt(page, [[200, 150]]))[0]!)).toBe(true);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(150);
    await page.getByRole('menuitem', { name: 'Quick Export PNG' }).click();
    await downloadPromise;
    await page.waitForTimeout(150);

    await wheelPan(page, 40, 30);
    await page.screenshot({ path: 'e2e/screenshots/viewport-present-only-after-export.png' });
    expect(isBlueTint((await screenAt(page, [[200, 150]]))[0]!), 'the quick-mask tint is still on screen').toBe(true);
  });
});
