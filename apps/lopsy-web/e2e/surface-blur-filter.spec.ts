import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, getPixelAt } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

/**
 * Create a document and wait for `documentReady` to become true.
 * The helpers.ts `createDocument` uses `undoStack.length > 0` which never
 * becomes true because createDocument resets the undo stack. We wait for
 * `documentReady` instead, which the store sets to `true` after creation.
 */
async function setupDocument(page: Page, width: number, height: number, transparent: boolean): Promise<void> {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; documentReady: boolean };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.documentReady === true && s.document.layers.length > 0;
  }, undefined, { timeout: 15000 });
}

/**
 * Paint two side-by-side solid colour blocks in one updateLayerPixelData call.
 * Left half: white (255,255,255). Right half: black (0,0,0).
 * This gives a hard edge in the center that surface blur should preserve at
 * low threshold, and a uniform region on each side.
 */
async function paintTwoHalves(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      state.pushHistory('Paint two halves');
      const data = new ImageData(w, h);
      const half = Math.floor(w / 2);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const v = x < half ? 255 : 0;
          data.data[i] = v;
          data.data[i + 1] = v;
          data.data[i + 2] = v;
          data.data[i + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    },
    { w: width, h: height },
  );
}

test.describe('Surface Blur Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('dialog opens, has correct title, and can be applied', async ({ page }) => {
    await setupDocument(page, 100, 100, false);
    await paintTwoHalves(page, 100, 100);

    await page.click('text=Filter');
    await page.click('text=Surface Blur...');

    const heading = page.locator('h2:has-text("Surface Blur")');
    await expect(heading).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'surface-blur-dialog.png') });

    // Should have two sliders: Radius and Threshold
    const dialog = page.locator('h2:has-text("Surface Blur")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const sliders = dialog.locator('input[type="range"]');
    await expect(sliders).toHaveCount(2);

    const applyButton = page.locator('button:has-text("Apply")');
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    await expect(heading).not.toBeVisible({ timeout: 3000 });
  });

  test('blurs a uniform region — pixels stay close to their original value', async ({ page }) => {
    // 60×20 doc: left 30px = white, right 30px = black
    await setupDocument(page, 60, 20, true);
    await paintTwoHalves(page, 60, 20);

    // Verify the interior of the white region before
    const whiteBefore = await getPixelAt(page, 5, 10);
    expect(whiteBefore.r).toBe(255);

    // Apply surface blur with low threshold (15) so it only blurs within same-color areas
    await page.click('text=Filter');
    await page.click('text=Surface Blur...');
    await expect(page.locator('h2:has-text("Surface Blur")')).toBeVisible({ timeout: 3000 });

    const dialog = page.locator('h2:has-text("Surface Blur")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const sliders = dialog.locator('input[type="range"]');

    // Radius = 5, Threshold = 15
    await sliders.nth(0).fill('5');
    await sliders.nth(1).fill('15');

    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Surface Blur")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'surface-blur-after-uniform.png') });

    // Interior of the white region (far from edge) should remain bright (>200)
    const whiteAfter = await getPixelAt(page, 5, 10);
    expect(whiteAfter.r).toBeGreaterThan(200);
    expect(whiteAfter.g).toBeGreaterThan(200);
    expect(whiteAfter.b).toBeGreaterThan(200);

    // Interior of the black region (far from edge) should remain dark (<50)
    const blackAfter = await getPixelAt(page, 55, 10);
    expect(blackAfter.r).toBeLessThan(50);
    expect(blackAfter.g).toBeLessThan(50);
    expect(blackAfter.b).toBeLessThan(50);
  });

  test('preserves hard edge between two flat regions at low threshold', async ({ page }) => {
    // 60×20 doc: left 30px = white, right 30px = black
    await setupDocument(page, 60, 20, true);
    await paintTwoHalves(page, 60, 20);

    // Apply surface blur: radius=5, threshold=15 (15/255 ≈ 0.059)
    // The color distance at the edge is ~1.73 (normalized), far above threshold,
    // so cross-edge neighbors are excluded from the average.
    await page.click('text=Filter');
    await page.click('text=Surface Blur...');
    await expect(page.locator('h2:has-text("Surface Blur")')).toBeVisible({ timeout: 3000 });

    const dialog = page.locator('h2:has-text("Surface Blur")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const sliders = dialog.locator('input[type="range"]');
    await sliders.nth(0).fill('5');
    await sliders.nth(1).fill('15');

    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Surface Blur")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'surface-blur-edge-preserved.png') });

    // The pixel just left of edge center should remain bright (white side)
    const leftOfEdge = await getPixelAt(page, 26, 10);
    expect(leftOfEdge.r).toBeGreaterThan(150);

    // The pixel just right of edge center should remain dark (black side)
    const rightOfEdge = await getPixelAt(page, 33, 10);
    expect(rightOfEdge.r).toBeLessThan(100);

    // The contrast across the edge should be preserved (significant difference)
    const contrast = leftOfEdge.r - rightOfEdge.r;
    expect(contrast).toBeGreaterThan(100);
  });

  test('surface blur changes pixels — filter is not a no-op', async ({ page }) => {
    // Paint a horizontal gradient (0→255 across 60px) so adjacent pixels differ
    // by only ~4/255 per channel. Surface blur with any threshold will include
    // these neighbors, averaging them and shifting edge-region pixels noticeably.
    await setupDocument(page, 60, 20, true);
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      state.pushHistory('Paint gradient');
      const data = new ImageData(60, 20);
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 60; x++) {
          const i = (y * 60 + x) * 4;
          // Linear ramp: x=0 → value=0, x=59 → value=255
          const v = Math.round((x / 59) * 255);
          data.data[i] = v;
          data.data[i + 1] = v;
          data.data[i + 2] = v;
          data.data[i + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    });

    // Read pixel x=0 (value=0) — after blur it should be pulled up toward right neighbors.
    // The left side is clamped at black so only right-side neighbors (positive gradient)
    // contribute brightness above zero.
    const beforeEdge = await getPixelAt(page, 0, 10);

    // Apply surface blur with radius=5 and a permissive threshold (50/255≈0.196).
    // Adjacent gradient pixels differ by ~4/255≈0.016 per channel, well below threshold.
    await page.click('text=Filter');
    await page.click('text=Surface Blur...');
    await expect(page.locator('h2:has-text("Surface Blur")')).toBeVisible({ timeout: 3000 });

    const dialog = page.locator('h2:has-text("Surface Blur")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const sliders = dialog.locator('input[type="range"]');
    await sliders.nth(0).fill('5');
    await sliders.nth(1).fill('50');

    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Surface Blur")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'surface-blur-gradient.png') });

    const afterEdge = await getPixelAt(page, 0, 10);

    // x=0 starts at value=0. After blur with radius=5 the weighted average of the
    // spatial window includes pixels with values ~0–21, all of which are included
    // (color distance < threshold). The expected result is ~4, so any change > 1
    // confirms the GPU filter ran and modified pixel data.
    expect(afterEdge.r).toBeGreaterThan(beforeEdge.r + 1);
  });

  test('surface blur can be undone', async ({ page }) => {
    await setupDocument(page, 60, 20, true);
    await paintTwoHalves(page, 60, 20);

    const beforeInterior = await getPixelAt(page, 5, 10);
    expect(beforeInterior.r).toBe(255);

    // Apply with high threshold (200) to get visible blur
    await page.click('text=Filter');
    await page.click('text=Surface Blur...');
    await expect(page.locator('h2:has-text("Surface Blur")')).toBeVisible({ timeout: 3000 });

    const dialog = page.locator('h2:has-text("Surface Blur")')
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const sliders = dialog.locator('input[type="range"]');
    await sliders.nth(0).fill('5');
    await sliders.nth(1).fill('200');

    await page.locator('button:has-text("Apply")').click();
    await expect(page.locator('h2:has-text("Surface Blur")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    const afterUndo = await getPixelAt(page, 5, 10);
    expect(Math.abs(afterUndo.r - beforeInterior.r)).toBeLessThan(5);
    expect(Math.abs(afterUndo.g - beforeInterior.g)).toBeLessThan(5);
    expect(Math.abs(afterUndo.b - beforeInterior.b)).toBeLessThan(5);
  });
});
