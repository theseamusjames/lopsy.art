import { test, expect } from './fixtures';
import { waitForStore, createDocument } from './helpers';

test.describe('Zoom scroll behavior (#54)', () => {
  test('ctrl+scroll down does not cause extreme zoom out', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);

    const initialZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Simulate ctrl+scroll down (zoom out) - single notch
    const container = page.locator('[data-testid="canvas-container"]');
    await container.dispatchEvent('wheel', {
      deltaY: 120,
      ctrlKey: true,
      clientX: 640,
      clientY: 360,
    });

    await page.waitForTimeout(100);

    const afterZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // With the fix (exponential model), a single scroll should change zoom by ~27%
    // NOT by 120% (the old bug)
    const ratio = afterZoom / initialZoom;
    expect(ratio).toBeGreaterThan(0.5); // Should not zoom out more than 50%
    expect(ratio).toBeLessThan(1.0); // Should zoom out

    await page.screenshot({ path: 'test-results/screenshots/zoom-scroll-single-notch.png' });
  });

  test('zoom in and zoom out are symmetric', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300);

    const initialZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Zoom out
    const container = page.locator('[data-testid="canvas-container"]');
    await container.dispatchEvent('wheel', {
      deltaY: 120,
      ctrlKey: true,
      clientX: 640,
      clientY: 360,
    });
    await page.waitForTimeout(50);

    // Zoom back in
    await container.dispatchEvent('wheel', {
      deltaY: -120,
      ctrlKey: true,
      clientX: 640,
      clientY: 360,
    });
    await page.waitForTimeout(50);

    const finalZoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });

    // Should return to approximately the initial zoom (symmetric)
    expect(finalZoom).toBeCloseTo(initialZoom, 1);

    await page.screenshot({ path: 'test-results/screenshots/zoom-scroll-symmetric.png' });
  });
});
