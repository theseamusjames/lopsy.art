import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument, getPixelAt } from './helpers';

/**
 * Paint a test image with a high-contrast vertical stripe in the center
 * surrounded by low-energy (uniform) regions that seam carving should
 * preferentially remove.
 *
 * Layout (100×60):
 *   x=[0,29]   → solid red (low energy — uniform)
 *   x=[30,39]  → alternating bright white/black checkerboard (HIGH energy)
 *   x=[40,69]  → solid green (low energy — uniform)
 *   x=[70,99]  → solid blue  (low energy — uniform)
 */
async function paintTestImage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    state.pushHistory('Paint test image');
    const w = state.document.width;
    const h = state.document.height;
    const data = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x < 30) {
          data.data[i] = 200; data.data[i + 1] = 50; data.data[i + 2] = 50;
        } else if (x < 40) {
          const checker = ((x + y) % 2 === 0) ? 255 : 0;
          data.data[i] = checker; data.data[i + 1] = checker; data.data[i + 2] = checker;
        } else if (x < 70) {
          data.data[i] = 50; data.data[i + 1] = 200; data.data[i + 2] = 50;
        } else {
          data.data[i] = 50; data.data[i + 1] = 50; data.data[i + 2] = 200;
        }
        data.data[i + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

async function openImageSizeDialog(page: Page): Promise<void> {
  const menuBar = page.locator('nav[aria-label="Application menu"]');
  await menuBar.locator('button', { hasText: /^Image$/ }).click();
  await page.locator('[role="menuitem"]', { hasText: 'Image Size...' }).click();
}

test.describe('Content-Aware Scale (Seam Carving)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('reduces image width while preserving high-energy content', async ({ page }) => {
    await createDocument(page, 100, 60, false);
    await paintTestImage(page);

    // Take before screenshot
    await page.screenshot({ path: 'e2e/screenshots/content-aware-scale-before.png' });

    // Verify the test image was painted correctly
    const redPixel = await getPixelAt(page, 10, 30);
    expect(redPixel.r).toBeGreaterThan(150);
    expect(redPixel.a).toBe(255);

    const greenPixel = await getPixelAt(page, 55, 30);
    expect(greenPixel.g).toBeGreaterThan(150);

    const bluePixel = await getPixelAt(page, 85, 30);
    expect(bluePixel.b).toBeGreaterThan(150);

    // Open Image > Image Size dialog
    await openImageSizeDialog(page);

    // Verify dialog opened
    const modal = page.locator('[role="dialog"][aria-label="Image Size"]');
    await expect(modal).toBeVisible();

    // Uncheck "Constrain proportions" so we can change width independently
    const constrainCheckbox = modal.locator('input[type="checkbox"]').first();
    await constrainCheckbox.uncheck();

    // Check "Content-Aware"
    const contentAwareCheckbox = modal.locator('input[type="checkbox"]').nth(1);
    await contentAwareCheckbox.check();

    // Change width from 100 to 70 (remove 30 px of width)
    const widthInput = modal.locator('input[type="number"]').first();
    await widthInput.click({ clickCount: 3 });
    await widthInput.fill('70');

    // Click Apply
    await modal.locator('button', { hasText: 'Apply' }).click();

    // Wait for dialog to close
    await expect(modal).not.toBeVisible();

    // Give the engine a moment to re-render
    await page.waitForTimeout(500);

    // Take after screenshot
    await page.screenshot({ path: 'e2e/screenshots/content-aware-scale-after.png' });

    // Verify document dimensions changed
    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
        };
      };
      return store.getState().document;
    });
    expect(state.width).toBe(70);
    expect(state.height).toBe(60);

    // Read pixel data from the resized layer to verify content preservation.
    const pixels = await page.evaluate(async () => {
      const readPixels = (window as unknown as Record<string, (...args: unknown[]) => Promise<{
        width: number; height: number; pixels: number[];
      }>>).__readLayerPixels;
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
        };
      };
      const layerId = store.getState().document.activeLayerId;
      return readPixels(layerId);
    });

    expect(pixels.width).toBe(70);
    expect(pixels.height).toBe(60);

    // Scan across the middle row to find the checkerboard pattern.
    // The checkerboard alternates between 255 and 0, creating high variance.
    const midY = 30;
    let highContrastTransitions = 0;
    for (let x = 1; x < 70; x++) {
      const idx0 = ((midY * 70 + (x - 1)) * 4);
      const idx1 = ((midY * 70 + x) * 4);
      const lum0 = pixels.pixels[idx0] * 0.299 + pixels.pixels[idx0 + 1] * 0.587 + pixels.pixels[idx0 + 2] * 0.114;
      const lum1 = pixels.pixels[idx1] * 0.299 + pixels.pixels[idx1 + 1] * 0.587 + pixels.pixels[idx1 + 2] * 0.114;
      if (Math.abs(lum1 - lum0) > 100) {
        highContrastTransitions++;
      }
    }
    // The checkerboard should produce at least several high-contrast
    // transitions, proving the algorithm preserved it
    expect(highContrastTransitions).toBeGreaterThan(3);

    // Also verify that at least two of the three color regions survived
    let hasRed = false;
    let hasGreen = false;
    let hasBlue = false;
    for (let x = 0; x < 70; x++) {
      const idx = ((midY * 70 + x) * 4);
      const r = pixels.pixels[idx];
      const g = pixels.pixels[idx + 1];
      const b = pixels.pixels[idx + 2];
      if (r > 150 && g < 100 && b < 100) hasRed = true;
      if (g > 150 && r < 100 && b < 100) hasGreen = true;
      if (b > 150 && r < 100 && g < 100) hasBlue = true;
    }
    const survivingRegions = [hasRed, hasGreen, hasBlue].filter(Boolean).length;
    expect(survivingRegions).toBeGreaterThanOrEqual(2);
  });

  test('content-aware checkbox appears in Image Size dialog', async ({ page }) => {
    await createDocument(page, 100, 100, false);

    // Open Image Size dialog
    await openImageSizeDialog(page);

    const modal = page.locator('[role="dialog"][aria-label="Image Size"]');
    await expect(modal).toBeVisible();

    // Verify the Content-Aware checkbox is present
    const contentAwareLabel = modal.locator('text=Content-Aware');
    await expect(contentAwareLabel).toBeVisible();

    // Take a screenshot showing the dialog with the checkbox
    await page.screenshot({ path: 'e2e/screenshots/content-aware-scale-dialog.png' });

    // Close dialog
    await modal.locator('button', { hasText: 'Cancel' }).click();
  });
});
