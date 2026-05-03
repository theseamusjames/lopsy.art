import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

test.describe('Navigator Panel', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('Navigator panel can be toggled via the toolbar button', async ({ page }) => {
    const toggleBtn = page.locator('button[title="Navigator"]');
    await expect(toggleBtn).toBeVisible();

    // Panel is not visible by default
    const minimap = page.locator('[data-testid="navigator-minimap-container"]');
    await expect(minimap).not.toBeVisible();

    // Click to show
    await toggleBtn.click();
    await expect(minimap).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/navigator-panel-open.png' });

    // Click again to hide
    await toggleBtn.click();
    await expect(minimap).not.toBeVisible();
  });

  test('Navigator panel shows thumbnail canvas and viewport indicator', async ({ page }) => {
    await page.locator('button[title="Navigator"]').click();

    const thumbnail = page.locator('[data-testid="navigator-thumbnail"]');
    await expect(thumbnail).toBeVisible();

    const indicator = page.locator('[data-testid="navigator-viewport-indicator"]');
    await expect(indicator).toBeVisible();

    // The indicator should be non-zero size
    const box = await indicator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(2);
    expect(box!.height).toBeGreaterThan(2);

    await page.screenshot({ path: 'e2e/screenshots/navigator-panel-thumbnail.png' });
  });

  test('viewport indicator shrinks when zooming in', async ({ page }) => {
    await page.locator('button[title="Navigator"]').click();

    const indicator = page.locator('[data-testid="navigator-viewport-indicator"]');
    await expect(indicator).toBeVisible();

    // Record indicator size at default zoom
    const boxBefore = await indicator.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Zoom in using keyboard shortcut (Cmd/Ctrl +=)
    const container = page.locator('[data-testid="canvas-container"]');
    await container.click();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');

    // Wait for zoom state to propagate
    await page.waitForTimeout(100);

    const boxAfter = await indicator.boundingBox();
    expect(boxAfter).not.toBeNull();

    // After zooming in, viewport indicator should be smaller
    expect(boxAfter!.width).toBeLessThan(boxBefore!.width);
    expect(boxAfter!.height).toBeLessThan(boxBefore!.height);

    await page.screenshot({ path: 'e2e/screenshots/navigator-panel-zoomed-in.png' });
  });

  test('viewport indicator moves when panning the canvas', async ({ page }) => {
    await page.locator('button[title="Navigator"]').click();

    // Zoom in first so there's room to pan
    const container = page.locator('[data-testid="canvas-container"]');
    await container.click();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(100);

    const indicator = page.locator('[data-testid="navigator-viewport-indicator"]');
    const boxBefore = await indicator.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Set pan via store — no UI path for programmatic pan by a known amount
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setPan: (x: number, y: number) => void };
      };
      store.getState().setPan(150, 100);
    });

    await page.waitForTimeout(100);

    const boxAfter = await indicator.boundingBox();
    expect(boxAfter).not.toBeNull();

    // Indicator position should have moved
    const movedX = Math.abs(boxAfter!.x - boxBefore!.x);
    const movedY = Math.abs(boxAfter!.y - boxBefore!.y);
    expect(movedX + movedY).toBeGreaterThan(2);

    await page.screenshot({ path: 'e2e/screenshots/navigator-panel-panned.png' });
  });

  test('clicking the minimap centres the viewport on that point', async ({ page }) => {
    await page.locator('button[title="Navigator"]').click();

    // Zoom in so we can see panning
    const container = page.locator('[data-testid="canvas-container"]');
    await container.click();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(100);

    // Record viewport pan before clicking
    const panBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { panX: number; panY: number } };
      };
      return store.getState().viewport;
    });

    // Click on a corner of the minimap to pan there
    const minimap = page.locator('[data-testid="navigator-minimap-container"]');
    const minimapBox = await minimap.boundingBox();
    expect(minimapBox).not.toBeNull();

    // Click on the top-left area of the minimap
    await page.mouse.click(
      minimapBox!.x + minimapBox!.width * 0.15,
      minimapBox!.y + minimapBox!.height * 0.15,
    );

    await page.waitForTimeout(100);

    const panAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { panX: number; panY: number } };
      };
      return store.getState().viewport;
    });

    // Pan should have changed after clicking minimap
    const panDelta = Math.abs(panAfter.panX - panBefore.panX) + Math.abs(panAfter.panY - panBefore.panY);
    expect(panDelta).toBeGreaterThan(1);

    await page.screenshot({ path: 'e2e/screenshots/navigator-panel-click-pan.png' });
  });

  test('zoom display shows the current zoom percentage', async ({ page }) => {
    await page.locator('button[title="Navigator"]').click();

    const zoomDisplay = page.locator('[data-testid="navigator-zoom-value"]');
    await expect(zoomDisplay).toBeVisible();

    // At default zoom (1x), should show 100%
    const initialText = await zoomDisplay.textContent();
    expect(initialText).toContain('100');

    // Zoom in
    const container = page.locator('[data-testid="canvas-container"]');
    await container.click();
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(100);

    // Zoom display should update
    const afterZoomText = await zoomDisplay.textContent();
    // Value should be larger than 100 after zooming in
    const afterZoomPercent = parseInt(afterZoomText ?? '0', 10);
    expect(afterZoomPercent).toBeGreaterThan(100);

    await page.screenshot({ path: 'e2e/screenshots/navigator-panel-zoom-display.png' });
  });
});
