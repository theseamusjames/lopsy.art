// #986 — Elliptical Marquee and Lasso selections must be anti-aliased so
// fills and deletes through them come out with smooth edges, while a
// rectangular marquee on whole-pixel coordinates stays crisp.
import { test, expect, type Page } from '@playwright/test';
import {
  addLayer,
  createDocument,
  docToScreen,
  drawRect,
  getEditorState,
  selectTool,
  setActiveLayer,
  setForegroundColor,
  setToolOption,
  waitForStore,
} from './helpers';

interface AlphaStats {
  opaque: number;
  partial: number;
}

async function alphaStats(page: Page, layerId: string): Promise<AlphaStats> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { pixels } = await read(id);
    let opaque = 0;
    let partial = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const a = pixels[i]!;
      if (a === 255) opaque++;
      else if (a > 0) partial++;
    }
    return { opaque, partial };
  }, layerId);
}

async function dragMarquee(
  page: Page,
  tool: 'marquee-ellipse' | 'marquee-rect',
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await selectTool(page, tool);
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function traceLasso(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  await selectTool(page, 'lasso');
  const screen: Array<{ x: number; y: number }> = [];
  for (const p of points) screen.push(await docToScreen(page, p.x, p.y));
  await page.mouse.move(screen[0]!.x, screen[0]!.y);
  await page.mouse.down();
  for (const sp of screen.slice(1)) {
    await page.mouse.move(sp.x, sp.y, { steps: 10 });
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function bucketAt(page: Page, x: number, y: number): Promise<void> {
  await selectTool(page, 'fill');
  await setToolOption(page, 'Tolerance', 255);
  const click = await docToScreen(page, x, y);
  await page.mouse.click(click.x, click.y);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function freshLayer(page: Page): Promise<string> {
  await addLayer(page);
  await page.waitForTimeout(50);
  const state = await getEditorState(page);
  return state.document.activeLayerId;
}

test.describe('Anti-aliased selections (#986)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await setForegroundColor(page, 0, 0, 0);
  });

  test('elliptical marquee bucket fill has partial-alpha edge pixels', async ({ page }) => {
    const layerId = await freshLayer(page);
    await setForegroundColor(page, 0, 0, 0);
    await dragMarquee(page, 'marquee-ellipse', { x: 50, y: 50 }, { x: 150, y: 150 });
    await bucketAt(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/selection-antialias-ellipse.png' });

    const stats = await alphaStats(page, layerId);
    // A 100 px circle covers ~7,850 px; its ~300 boundary pixels must carry
    // fractional coverage instead of snapping to 0 / 255.
    expect(stats.partial).toBeGreaterThan(150);
    expect(stats.opaque + stats.partial).toBeGreaterThan(7500);
    expect(stats.opaque + stats.partial).toBeLessThan(8300);
  });

  test('lasso bucket fill has partial-alpha edge pixels', async ({ page }) => {
    const layerId = await freshLayer(page);
    await setForegroundColor(page, 0, 0, 0);
    await traceLasso(page, [
      { x: 250, y: 50 },
      { x: 350, y: 90 },
      { x: 260, y: 150 },
      { x: 250, y: 50 },
    ]);
    await bucketAt(page, 285, 90);
    await page.screenshot({ path: 'e2e/screenshots/selection-antialias-lasso.png' });

    const stats = await alphaStats(page, layerId);
    // Triangle area = 4,800 px; every slanted edge crosses pixels partially.
    expect(stats.partial).toBeGreaterThan(100);
    expect(stats.opaque + stats.partial).toBeGreaterThan(4500);
    expect(stats.opaque + stats.partial).toBeLessThan(5200);
  });

  test('elliptical marquee fill on a layer with content keeps smooth edges', async ({ page }) => {
    const layerId = await freshLayer(page);
    // Put unrelated content on the layer so the bucket takes the contiguous
    // flood-fill route instead of the empty-layer fast path.
    await drawRect(page, 300, 200, 40, 40, { r: 255, g: 0, b: 0 });
    await setActiveLayer(page, layerId);
    const before = await alphaStats(page, layerId);
    await setForegroundColor(page, 0, 0, 0);
    await dragMarquee(page, 'marquee-ellipse', { x: 50, y: 50 }, { x: 150, y: 150 });
    await bucketAt(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/selection-antialias-ellipse-content.png' });

    const after = await alphaStats(page, layerId);
    expect(after.partial - before.partial).toBeGreaterThan(150);
  });

  test('delete through an elliptical marquee leaves a smooth hole', async ({ page }) => {
    const layerId = await freshLayer(page);
    await drawRect(page, 0, 0, 400, 300, { r: 0, g: 0, b: 255 });
    await setActiveLayer(page, layerId);
    expect((await alphaStats(page, layerId)).partial).toBe(0);

    await dragMarquee(page, 'marquee-ellipse', { x: 100, y: 50 }, { x: 300, y: 250 });
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'e2e/screenshots/selection-antialias-delete.png' });

    const stats = await alphaStats(page, layerId);
    expect(stats.partial).toBeGreaterThan(300);
  });

  test('Edit > Fill through a lasso selection has smooth edges', async ({ page }) => {
    const layerId = await freshLayer(page);
    await setForegroundColor(page, 0, 0, 0);
    await traceLasso(page, [
      { x: 250, y: 50 },
      { x: 350, y: 90 },
      { x: 260, y: 150 },
      { x: 250, y: 50 },
    ]);
    await page.click('button:has-text("Edit")');
    await page.locator('button[role="menuitem"]').filter({ hasText: /^Fill(?! with)/ }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'e2e/screenshots/selection-antialias-edit-fill.png' });

    const stats = await alphaStats(page, layerId);
    expect(stats.partial).toBeGreaterThan(100);
    expect(stats.opaque + stats.partial).toBeGreaterThan(4500);
    expect(stats.opaque + stats.partial).toBeLessThan(5200);
  });

  test('rectangular marquee on whole pixels stays crisp', async ({ page }) => {
    const layerId = await freshLayer(page);
    await setForegroundColor(page, 0, 0, 0);
    await dragMarquee(page, 'marquee-rect', { x: 50, y: 50 }, { x: 150, y: 130 });
    await bucketAt(page, 100, 90);

    const stats = await alphaStats(page, layerId);
    expect(stats.partial).toBe(0);
    expect(stats.opaque).toBeGreaterThan(7000);
  });

  test('elliptical marquee still draws marching ants', async ({ page }) => {
    const countOverlayInk = (): Promise<number> => page.evaluate(() => {
      const canvas = Array.from(document.querySelectorAll('canvas'))
        .find((c) => /overlayCanvas/.test(c.className));
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return -1;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count++;
      return count;
    });
    const before = await countOverlayInk();
    await dragMarquee(page, 'marquee-ellipse', { x: 50, y: 50 }, { x: 150, y: 150 });
    await page.waitForTimeout(100);
    const after = await countOverlayInk();
    // The 50 % contour of a 100 px circle is ~314 px long.
    expect(after - before).toBeGreaterThan(250);
  });
});
