/**
 * #1000 — the rotation handles of a thin selection must be grabbable over
 * their whole drawn circle. The #222 handle-radius clamp (half the
 * selection's short side) exists so a click inside a tiny selection can't
 * grab a scale handle, but it also shrank the rotate handles, which sit
 * 20 doc px diagonally outside the corners and can't be confused with the
 * interior. A press a few screen px off a rotate circle's centre then
 * missed it and fell through to a plain Move drag.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { addLayer, createDocument, docToScreen, selectTool, waitForStore } from './helpers';

interface Bounds { x: number; y: number; width: number; height: number }

async function readTransform(page: Page): Promise<{ rotation: number; originalBounds: Bounds } | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as { __uiStore: { getState: () => { transform: { rotation: number; originalBounds: Bounds } | null } } }).__uiStore;
    const t = ui.getState().transform;
    return t ? { rotation: t.rotation, originalBounds: { ...t.originalBounds } } : null;
  });
}

async function readZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { viewport: { zoom: number } } } }).__editorStore;
    return store.getState().viewport.zoom;
  });
}

test.describe('rotate handles on a thin selection (#1000)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 1920, 1080, false);
  });

  test('a press inside the drawn rotate circle but off-centre rotates instead of moving', async ({ page }) => {
    await addLayer(page);

    await selectTool(page, 'marquee-rect');
    const selStart = await docToScreen(page, 800, 500);
    const selEnd = await docToScreen(page, 1000, 516);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y, { steps: 5 });
    await page.mouse.up();

    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(100);

    await selectTool(page, 'move');
    const before = await readTransform(page);
    expect(before?.originalBounds).toEqual({ x: 800, y: 500, width: 200, height: 16 });

    // The drawn rotate circle has a 5 screen px radius; 4 px right of its
    // centre is inside it. At this zoom the old clamp (16/2 * 0.8 = 6.4
    // doc px) is smaller than 4 screen px in doc space.
    const zoom = await readZoom(page);
    expect(4 / zoom).toBeGreaterThan(6.4);

    const rotCentre = await docToScreen(page, 1000 + 20, 500 - 20);
    const press = { x: rotCentre.x + 4, y: rotCentre.y };
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x, press.y + 60, { steps: 10 });
    await page.mouse.up();

    await page.screenshot({ path: 'e2e/screenshots/rotate-handle-thin-selection-after.png' });

    const after = await readTransform(page);
    // A rotate keeps the box where it was and turns it; the bug's Move
    // drag slid the bar down (originalBounds.y 500 -> ~603) unrotated.
    expect(after).not.toBeNull();
    expect(Math.abs(after!.rotation)).toBeGreaterThan(0.1);
    expect(after!.originalBounds.y).toBe(500);
    expect(after!.originalBounds.x).toBe(800);
  });
});
