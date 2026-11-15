/**
 * #1453 — while a Move-tool scale is pending, the rotation handles must stay
 * 20 doc px diagonally outside each corner. They were offset in the
 * original bounds and then scaled with the content, so a 10x stretch flung
 * them ~200 px away and a 10x shrink parked them on the corner squares,
 * where a press rotated instead of continuing the scale.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addLayer, createDocument, docToScreen, selectTool, waitForStore } from './helpers';

interface TransformReadout { rotation: number; scaleX: number; scaleY: number }

async function readTransform(page: Page): Promise<TransformReadout | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as {
      __uiStore: { getState: () => { transform: { rotation: number; scaleX: number; scaleY: number } | null } };
    }).__uiStore;
    const t = ui.getState().transform;
    return t ? { rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY } : null;
  });
}

async function marqueeAndFill(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(100);
}

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test.describe('rotate handles under a pending scale (#1453)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 800, false);
    await addLayer(page);
  });

  test('after a 10x stretch the rotate handle sits 20 px outside the corner', async ({ page }) => {
    await marqueeAndFill(page, 200, 390, 600, 410);
    await selectTool(page, 'move');

    await dragDoc(page, { x: 400, y: 410 }, { x: 400, y: 590 });
    const stretched = await readTransform(page);
    expect(stretched!.scaleY).toBeGreaterThan(8);
    expect(stretched!.rotation).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/rotate-handle-pending-scale-stretch.png' });

    // The top edge is pinned at y 390, so the top-right rotate handle is at
    // (620, 370). Before the fix it sat near (620, 190) and this was a move.
    await dragDoc(page, { x: 620, y: 370 }, { x: 680, y: 420 });
    const after = await readTransform(page);
    expect(Math.abs(after!.rotation)).toBeGreaterThan(0.1);
    expect(after!.scaleY).toBeCloseTo(stretched!.scaleY, 3);
  });

  test('after a 10x shrink the corner square still scales', async ({ page }) => {
    await marqueeAndFill(page, 200, 200, 600, 600);
    await selectTool(page, 'move');

    await dragDoc(page, { x: 600, y: 600 }, { x: 240, y: 240 });
    const shrunk = await readTransform(page);
    expect(shrunk!.scaleX).toBeLessThan(0.15);
    expect(shrunk!.scaleY).toBeLessThan(0.15);

    await page.screenshot({ path: 'e2e/screenshots/rotate-handle-pending-scale-shrink.png' });

    // Before the fix the rotate handle collapsed onto this corner and the
    // press rotated the box.
    await dragDoc(page, { x: 240, y: 240 }, { x: 320, y: 320 });
    const after = await readTransform(page);
    expect(after!.rotation).toBe(0);
    expect(after!.scaleX).toBeGreaterThan(shrunk!.scaleX + 0.1);
  });
});
