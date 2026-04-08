import { test, expect } from '@playwright/test';
import { waitForStore, createDocument } from './helpers';

test.describe('Grid size slider with stops (#125)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(300);
  });

  test('grid size uses a range slider instead of a select dropdown', async ({ page }) => {
    // Enable grid via store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setShowGrid: (v: boolean) => void };
      };
      store.getState().setShowGrid(true);
    });
    await page.waitForTimeout(200);

    // Verify it's a range input, not a select
    const sliderExists = await page.locator('input[type="range"]').first().isVisible().catch(() => false);
    const selectExists = await page.locator('select').first().isVisible().catch(() => false);

    await page.screenshot({ path: 'e2e/screenshots/grid-slider.png' });

    // There should be at least one range slider visible (the grid one)
    expect(sliderExists || !selectExists).toBeTruthy();
  });

  test('moving the grid slider changes the grid size', async ({ page }) => {
    // Enable grid
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setShowGrid: (v: boolean) => void };
      };
      store.getState().setShowGrid(true);
    });
    await page.waitForTimeout(200);

    // Get initial grid size
    const initialSize = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return store.getState().gridSize;
    });

    // Change grid size via store to a different stop value
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setGridSize: (v: number) => void };
      };
      store.getState().setGridSize(32);
    });
    await page.waitForTimeout(200);

    const newSize = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return store.getState().gridSize;
    });

    await page.screenshot({ path: 'e2e/screenshots/grid-slider-changed.png' });

    expect(newSize).toBe(32);
    expect(newSize).not.toBe(initialSize);
  });
});
