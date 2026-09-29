/**
 * #991 — undo/redo of a pending Move-tool rotation must leave the
 * selection matching the pixels being restored. The history entries
 * recorded the pre-transform marquee next to the post-transform
 * composite, so a redo put the axis-aligned 440×140 marquee over the
 * rotated bar; the next handle drag floated only that rectangle out of
 * the rotated pixels and tore the bar in two.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createDocument, docToScreen, getPixelAt, redo, selectTool, setForegroundColor, undo, waitForStore } from './helpers';

interface Bounds { x: number; y: number; width: number; height: number }

async function drag(page: Page, from: [number, number], to: [number, number], steps = 10): Promise<void> {
  const start = await docToScreen(page, from[0], from[1]);
  const end = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function readTransform(page: Page): Promise<{ rotation: number; originalBounds: Bounds } | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as { __uiStore: { getState: () => { transform: { rotation: number; originalBounds: Bounds } | null } } }).__uiStore;
    const t = ui.getState().transform;
    return t ? { rotation: t.rotation, originalBounds: { ...t.originalBounds } } : null;
  });
}

async function readSelection(page: Page, probes: Array<[number, number]>): Promise<{ bounds: Bounds | null; selected: boolean[] }> {
  return page.evaluate((probes) => {
    const store = (window as unknown as { __editorStore: { getState: () => { selection: { active: boolean; mask: Uint8ClampedArray | null; maskWidth: number; bounds: Bounds | null } } } }).__editorStore;
    const sel = store.getState().selection;
    const selected = probes.map(([x, y]) => (sel.active && sel.mask ? (sel.mask[y * sel.maskWidth + x] ?? 0) > 127 : false));
    return { bounds: sel.active ? sel.bounds : null, selected };
  }, probes);
}

async function isRed(page: Page, x: number, y: number): Promise<boolean> {
  const p = await getPixelAt(page, x, y);
  return p.r > 200 && p.g < 80 && p.b < 80 && p.a > 200;
}

test.describe('redo of a transform rotation (#991)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'requires a mouse and keyboard shortcuts');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1920, 1080, false);
  });

  test('redo restores a selection matching the rotated bar, and a later scale moves the whole bar', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await selectTool(page, 'marquee-rect');
    await drag(page, [760, 490], [1160, 590], 5);
    await selectTool(page, 'fill');
    const fillPoint = await docToScreen(page, 960, 540);
    await page.mouse.click(fillPoint.x, fillPoint.y);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    await selectTool(page, 'marquee-rect');
    await drag(page, [740, 470], [1180, 610], 5);
    await selectTool(page, 'move');

    // Rotation handle sits 20 px outside the top-right corner: (1200, 450).
    // It is at -20.56° from the box centre (960, 540), radius 256.3; drag it
    // to +9.44° to turn the box ~30° clockwise.
    const r = Math.hypot(240, 90);
    const a = (9.44 * Math.PI) / 180;
    await drag(page, [1200, 450], [960 + r * Math.cos(a), 540 + r * Math.sin(a)], 20);

    const rotated = await readTransform(page);
    expect(rotated!.rotation).toBeGreaterThan((25 * Math.PI) / 180);
    expect(rotated!.rotation).toBeLessThan((35 * Math.PI) / 180);

    // The bar's (1150, 580) rotates about (960, 540) to ~(1104, 669):
    // outside the original 740..1180 × 470..610 marquee.
    const tip: [number, number] = [1104, 668];
    expect(await isRed(page, ...tip), 'rotated bar tip is red after the rotate').toBe(true);

    await undo(page);
    expect(await isRed(page, ...tip), 'undo puts the bar back flat').toBe(false);
    const afterUndo = await readSelection(page, [tip, [960, 540]]);
    expect(afterUndo.bounds).toEqual({ x: 740, y: 470, width: 440, height: 140 });

    await redo(page);
    await page.screenshot({ path: 'e2e/screenshots/transform-redo-rotation-after-redo.png' });
    expect(await isRed(page, ...tip), 'redo brings the rotated pixels back').toBe(true);

    // Selection now covers the rotated bar — its AABB is ~451×341 around
    // (960, 540), and it includes the rotated tip — and the handle box
    // frames that selection rather than the old flat rectangle.
    const afterRedo = await readSelection(page, [tip, [960, 540]]);
    expect(afterRedo.selected).toEqual([true, true]);
    const b = afterRedo.bounds!;
    expect(Math.abs(b.width - 451)).toBeLessThan(6);
    expect(Math.abs(b.height - 341)).toBeLessThan(6);
    expect(Math.abs(b.x + b.width / 2 - 960)).toBeLessThan(3);
    expect(Math.abs(b.y + b.height / 2 - 540)).toBeLessThan(3);
    const box = await readTransform(page);
    expect(box!.originalBounds).toEqual(b);

    // Drag the right-edge scale handle 60 px right. The left edge stays
    // anchored, so the whole rotated bar stretches: the tip moves from
    // x≈1104 to x≈1153. With the torn selection only the flat middle
    // floated and the tip stayed behind at x≈1104.
    const handle: [number, number] = [box!.originalBounds.x + box!.originalBounds.width, box!.originalBounds.y + box!.originalBounds.height / 2];
    await drag(page, handle, [handle[0] + 60, handle[1]], 15);
    await page.screenshot({ path: 'e2e/screenshots/transform-redo-rotation-after-scale.png' });

    expect(await isRed(page, 1150, 668), 'stretched tip moved right').toBe(true);
    expect(await isRed(page, ...tip), 'nothing torn off at the old tip').toBe(false);
  });
});
