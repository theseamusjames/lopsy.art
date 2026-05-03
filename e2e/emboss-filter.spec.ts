import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, getPixelAt, applyFilter } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

/**
 * Paint the full document with a sharp vertical edge: left half white, right half black.
 * Builds all pixel data in one evaluate call to avoid auto-crop issues.
 */
async function paintVerticalEdge(page: Page): Promise<void> {
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
    const w = state.document.width;
    const h = state.document.height;
    state.pushHistory('Paint edge');
    const data = new ImageData(w, h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const v = col < w / 2 ? 255 : 0;
        const idx = (row * w + col) * 4;
        data.data[idx] = v;
        data.data[idx + 1] = v;
        data.data[idx + 2] = v;
        data.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

/**
 * Paint the full document with a flat gray color.
 * Builds all pixel data in one evaluate call to avoid auto-crop issues.
 */
async function paintFlatGray(page: Page, grayValue: number): Promise<void> {
  await page.evaluate((v) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const w = state.document.width;
    const h = state.document.height;
    state.pushHistory('Paint flat');
    const data = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      data.data[i * 4] = v;
      data.data[i * 4 + 1] = v;
      data.data[i * 4 + 2] = v;
      data.data[i * 4 + 3] = 255;
    }
    state.updateLayerPixelData(id, data);
  }, grayValue);
}

test.describe('Emboss Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('emboss on flat color produces near-mid-gray output', async ({ page }) => {
    // A uniform gray field has zero gradient — the emboss kernel (which sums
    // to 0) produces no contrast, leaving every pixel at the 0.5 bias (~128).
    await createDocument(page, 50, 50, true);
    await paintFlatGray(page, 200);
    await fitToView(page);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    // Take screenshot before
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-flat-before.png') });

    await applyFilter(page, 'Emboss...', { 'Angle': 45, 'Amount': 3 });
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-flat-after.png') });

    // Centre of a flat image → mid-gray (~128). Allow ±30 for GPU float precision.
    const centre = await getPixelAt(page, 25, 25, state.activeLayerId);
    expect(centre.r).toBeGreaterThan(98);
    expect(centre.r).toBeLessThan(158);
    // Output is grayscale: r, g, b should be equal
    expect(Math.abs(centre.r - centre.g)).toBeLessThan(5);
    expect(Math.abs(centre.r - centre.b)).toBeLessThan(5);
    // Alpha is preserved
    expect(centre.a).toBe(255);
  });

  test('emboss on a sharp edge produces output that differs from input', async ({ page }) => {
    // A vertical edge (left half white, right half black) creates a strong
    // horizontal gradient. The emboss kernel amplifies this — pixels at the
    // edge boundary should be brighter or darker than the flat-field mid-gray.
    await createDocument(page, 60, 60, true);
    await paintVerticalEdge(page);
    await fitToView(page);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    // Read the edge pixel (centre of document horizontally) before the filter
    const before = await getPixelAt(page, 30, 30, state.activeLayerId);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-edge-before.png') });

    // Apply emboss with a notable amount
    await applyFilter(page, 'Emboss...', { 'Angle': 0, 'Amount': 5 });
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-edge-after.png') });

    // The filter should have changed the pixel values on the edge
    const after = await getPixelAt(page, 30, 30, state.activeLayerId);
    const delta = Math.abs(after.r - before.r) + Math.abs(after.g - before.g) + Math.abs(after.b - before.b);
    expect(delta).toBeGreaterThan(10);
  });

  test('emboss is undoable and restores original pixels', async ({ page }) => {
    await createDocument(page, 60, 60, true);
    await paintVerticalEdge(page);
    await fitToView(page);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    // Snapshot white side before filter
    const beforeLeft = await getPixelAt(page, 10, 30, state.activeLayerId);
    expect(beforeLeft.r).toBe(255);

    await applyFilter(page, 'Emboss...', { 'Angle': 45, 'Amount': 5 });
    await page.waitForTimeout(300);

    // After emboss, the left (previously white) area should no longer be white
    const afterLeft = await getPixelAt(page, 10, 30, state.activeLayerId);
    expect(afterLeft.r).toBeLessThan(220);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // The white left side should be restored
    const undoneLeft = await getPixelAt(page, 10, 30, state.activeLayerId);
    expect(undoneLeft.r).toBeGreaterThan(240);
  });

  test('emboss dialog UI is visible with angle and amount controls', async ({ page }) => {
    await createDocument(page, 100, 100, false);
    await fitToView(page);

    // Open the Filter menu and click Emboss
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Emboss...');
    await page.waitForTimeout(300);

    // Dialog heading should appear
    const dialogHeading = page.locator('h2:has-text("Emboss")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'emboss-dialog.png') });

    // Both sliders (Angle and Amount) should be present
    const modal = page.locator('h2:has-text("Emboss")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const sliders = modal.locator('input[type="range"]');
    await expect(sliders).toHaveCount(2);

    // Apply button must exist and close the dialog on click
    const applyButton = page.locator('button:has-text("Apply")');
    await expect(applyButton).toBeVisible();
    await applyButton.click();
    await page.waitForTimeout(300);
    await expect(dialogHeading).not.toBeVisible({ timeout: 3000 });
  });
});
