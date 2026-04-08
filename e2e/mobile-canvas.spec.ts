import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Mobile canvas', () => {
  test.use({
    ...({ isMobile: true } as Record<string, unknown>),
    viewport: { width: 390, height: 844 },
  });

  test('canvas container fills viewport when toolbox and sidebar are hidden', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const container = page.getByTestId('canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    // Canvas should occupy at least 90% of the viewport width —
    // toolbox (44px) and sidebar (260px) are hidden on mobile.
    expect(box!.width).toBeGreaterThan(390 * 0.9);
    // Canvas should have meaningful height (not squished)
    expect(box!.height).toBeGreaterThan(844 * 0.5);
  });

  test('fitToView produces a visible zoom level on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const zoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Zoom should be > 0.1 so the canvas isn't microscopic
    expect(zoom).toBeGreaterThan(0.1);
    // Zoom should be <= 1 (fitToView caps at 1)
    expect(zoom).toBeLessThanOrEqual(1);
  });

  test('pinch-to-zoom changes the zoom level', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600);
    await page.waitForTimeout(300);

    const initialZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Simulate a pinch-out (zoom in) gesture using CDP touch events.
    // Two fingers start close together and spread apart.
    const container = page.getByTestId('canvas-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const cdp = await page.context().newCDPSession(page);

    // Start two touches close together
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 30, y: cy, id: 0 },
        { x: cx + 30, y: cy, id: 1 },
      ],
    });

    // Move fingers apart in steps (pinch out = zoom in)
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - 30 - i * 20, y: cy, id: 0 },
          { x: cx + 30 + i * 20, y: cy, id: 1 },
        ],
      });
    }

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    await page.waitForTimeout(100);

    const finalZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // After pinching outward, zoom should have increased
    expect(finalZoom).toBeGreaterThan(initialZoom);
  });
});
