/**
 * #871 — undoing a Move-tool drag must resync the transform-handle overlay
 * (`uiStore.transform.originalBounds`) with the reverted selection, not
 * leave it pointing at the moved-to position. A stale pivot makes the next
 * handle drag scale the real (reverted) content around the wrong point.
 *
 * Drives the real UI end to end: marquee select, move, undo, then a handle
 * drag, and reads pixels back from the GPU layer texture to prove the scale
 * grew the content from its correct (reverted) top-left anchor rather than
 * translating the untouched content — the exact failure mode described in
 * the issue.
 */
import { test, expect } from './fixtures';
import { createDocument, waitForStore, docToScreen, getPixelAt, selectTool, setForegroundColor, undo } from './helpers';

test.describe('transform handle overlay stays in sync with selection after undo (#871)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('undo restores the handle pivot so a follow-up scale grows from the reverted bounds', async ({ page }) => {
    // Marquee-select (60,60)-(140,120) and fill it red. Keep the marquee.
    await setForegroundColor(page, 255, 0, 0);
    await selectTool(page, 'marquee-rect');
    const selStart = await docToScreen(page, 60, 60);
    const selEnd = await docToScreen(page, 140, 120);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y, { steps: 5 });
    await page.mouse.up();
    await selectTool(page, 'fill');
    const fillPoint = await docToScreen(page, 100, 90);
    await page.mouse.click(fillPoint.x, fillPoint.y);

    // Move tool: drag (100,90) -> (200,150), moving the block to (160,120).
    await selectTool(page, 'move');
    const moveStart = await docToScreen(page, 100, 90);
    const moveEnd = await docToScreen(page, 200, 150);
    await page.mouse.move(moveStart.x, moveStart.y);
    await page.mouse.down();
    await page.mouse.move(moveEnd.x, moveEnd.y, { steps: 10 });
    await page.mouse.up();

    const movedInside = await getPixelAt(page, 170, 140);
    const movedOriginalSpot = await getPixelAt(page, 70, 70);
    expect(movedInside.a, 'moved block should cover (170,140)').toBeGreaterThan(0);
    expect(movedOriginalSpot.a, 'original spot should be empty after the move').toBe(0);

    // Undo the move. Pixels, selection AND the transform handle overlay
    // must all revert to (60,60)-(140,120).
    await undo(page);

    const revertedOriginalSpot = await getPixelAt(page, 70, 70);
    const revertedMovedSpot = await getPixelAt(page, 170, 140);
    expect(revertedOriginalSpot.a, 'content should be back at the original spot after undo').toBeGreaterThan(0);
    expect(revertedMovedSpot.a, 'moved-to spot should be empty after undo').toBe(0);

    const transformAfterUndo = await page.evaluate(() => {
      const ui = (window as unknown as { __uiStore: { getState: () => { transform: { originalBounds: { x: number; y: number; width: number; height: number } } | null } } }).__uiStore;
      return ui.getState().transform?.originalBounds ?? null;
    });
    expect(transformAfterUndo).toEqual({ x: 60, y: 60, width: 80, height: 60 });

    // Drag the bottom-right handle at its correct, reverted position
    // (140,120) out to (180,150). Growing from a bottom-right handle keeps
    // the top-left corner anchored, so if the pivot is correct the content
    // near (65,65) stays opaque. If the overlay were still anchored at the
    // stale moved bounds, this click would miss every handle and register
    // as a plain Move drag instead, sliding the block away from (65,65).
    const handleStart = await docToScreen(page, 140, 120);
    const handleEnd = await docToScreen(page, 180, 150);
    await page.mouse.move(handleStart.x, handleStart.y);
    await page.mouse.down();
    await page.mouse.move(handleEnd.x, handleEnd.y, { steps: 10 });
    await page.mouse.up();

    await page.screenshot({ path: 'e2e/screenshots/transform-handle-undo-sync-after-scale.png' });

    const nearAnchor = await getPixelAt(page, 65, 65);
    expect(nearAnchor.a, 'scaling from the reverted bounds keeps the top-left corner anchored').toBeGreaterThan(0);
    expect(nearAnchor.r).toBeGreaterThan(150);
  });
});
