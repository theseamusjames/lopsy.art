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
    const slider = page.locator('input[type="range"]').first();
    await expect(slider).toBeVisible();

    const selectExists = await page.locator('select').first().isVisible().catch(() => false);
    expect(selectExists).toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/grid-slider.png' });
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

    // Get initial grid size from the store
    const initialSize = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return store.getState().gridSize;
    });

    // Find the grid slider and read its current value
    const slider = page.locator('input[type="range"]').first();
    await expect(slider).toBeVisible();
    const initialSliderValue = await slider.inputValue();

    // Move the slider to a different stop by setting its value via fill()
    const maxAttr = await slider.getAttribute('max');
    const maxIndex = Number(maxAttr ?? '0');
    // Pick a different index than the current one
    const currentIndex = Number(initialSliderValue);
    const targetIndex = currentIndex < maxIndex ? currentIndex + 1 : currentIndex - 1;
    await slider.fill(String(targetIndex));
    await page.waitForTimeout(200);

    // Read back the grid size from the store — it should have changed
    const newSize = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { gridSize: number };
      };
      return store.getState().gridSize;
    });

    await page.screenshot({ path: 'e2e/screenshots/grid-slider-changed.png' });

    expect(newSize).not.toBe(initialSize);
  });
});
