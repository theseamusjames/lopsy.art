/**
 * #994 — rotating a TEXT layer so its rotated box crosses the canvas edge
 * must keep every glyph. #818 grew the float to cover the transformed
 * content for raster layers only, so a text layer's float stayed at the
 * canvas-plus-layer rect and the part of the turned text past the bottom
 * edge was clipped away when ⌘D baked it in. Text now turns through its
 * own Move-tool handles and keeps the turn as a transform that re-renders
 * the glyphs, so nothing can be clipped; this keeps the scenario covered.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';
import { findTransformHandle } from './text-edit-helpers';

interface Ink { minX: number; minY: number; maxX: number; maxY: number; count: number }

async function activeLayerInk(page: Page): Promise<Ink & { type: string }> {
  return page.evaluate(async () => {
    const store = (window as unknown as { __editorStore: { getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; type: string }> } } } }).__editorStore;
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId)!;
    const read = (window as unknown as { __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: number[] }> }).__readLayerPixels;
    const px = await read(layer.id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 128) {
          count++;
          minX = Math.min(minX, x + layer.x);
          maxX = Math.max(maxX, x + layer.x);
          minY = Math.min(minY, y + layer.y);
          maxY = Math.max(maxY, y + layer.y);
        }
      }
    }
    return { minX, minY, maxX, maxY, count, type: layer.type };
  });
}

test.describe('rotating a text layer across the canvas edge (#994)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1920, 1080, false);
  });

  test('a -90° turn that crosses the bottom edge keeps the whole word', async ({ page }) => {
    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 40);
    const at = await docToScreen(page, 900, 1045);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);
    await page.keyboard.type('HELLO');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(500);

    const flat = await activeLayerInk(page);
    expect(flat.type).toBe('text');
    expect(flat.count).toBeGreaterThan(500);
    const flatW = flat.maxX - flat.minX + 1;
    const flatH = flat.maxY - flat.minY + 1;
    expect(flatW).toBeGreaterThan(flatH * 2);

    const row = page.locator('[class*="itemWrapper"]').filter({ has: page.getByText('HELLO', { exact: true }) });
    await row.locator('div[class*="thumbnail"]').click({ modifiers: ['ControlOrMeta'] });
    await page.waitForTimeout(300);
    await selectTool(page, 'move');

    // The text's own top-right rotation handle sits 20 px outside its line
    // box. Drag it a quarter turn counter-clockwise about the word's centre,
    // snapping with ⌘.
    const cx = (flat.minX + flat.maxX) / 2;
    const cy = (flat.minY + flat.maxY) / 2;
    const start = await findTransformHandle(page, 'rotate-top-right', { x: flat.maxX + 20, y: flat.minY - 25 }, 40);
    const centre = await docToScreen(page, cx, cy);
    const radius = Math.hypot(start.x - centre.x, start.y - centre.y);
    const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
    await page.keyboard.down('Meta');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      const a = a0 - (Math.PI / 2) * (i / 20);
      await page.mouse.move(centre.x + radius * Math.cos(a), centre.y + radius * Math.sin(a));
    }
    await page.mouse.up();
    await page.keyboard.up('Meta');
    await page.waitForTimeout(200);
    const transform = await page.evaluate(() => {
      const store = (window as unknown as { __editorStore: { getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; transform?: { a: number; b: number } }> } } } }).__editorStore;
      const doc = store.getState().document;
      return doc.layers.find((l) => l.id === doc.activeLayerId)!.transform!;
    });
    expect(transform.a).toBeCloseTo(0, 3);
    expect(transform.b).toBeCloseTo(-1, 3);
    // The upright word spans ~cy ± flatW/2, well past the 1080 bottom edge.
    expect(cy + flatW / 2).toBeGreaterThan(1080 + 20);

    await page.keyboard.press('ControlOrMeta+d');
    await page.waitForTimeout(200);

    // Whole-layer Move drag 450 px up brings everything back on canvas.
    const from = await docToScreen(page, cx, 900);
    const to = await docToScreen(page, cx, 450);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/text-rotate-offcanvas-after-move.png' });

    const upright = await activeLayerInk(page);
    expect(upright.type).toBe('text');
    const w = upright.maxX - upright.minX + 1;
    const h = upright.maxY - upright.minY + 1;
    // The word's flat extents swap: ~flatH wide, ~flatW tall, nothing lost.
    expect(Math.abs(w - flatH)).toBeLessThan(6);
    expect(Math.abs(h - flatW)).toBeLessThan(6);
    expect(upright.count).toBeGreaterThan(flat.count * 0.85);
    expect(upright.count).toBeLessThan(flat.count * 1.15);
  });
});
