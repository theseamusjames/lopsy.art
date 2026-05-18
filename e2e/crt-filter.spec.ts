import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, getPixelAt, applyFilter } from './helpers';

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

test.describe('CRT / Scanline Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies CRT filter and produces visible scanlines and vignette', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a bright gradient so scanlines and vignette are clearly visible
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      const v = Math.round(50 + 205 * t);
      await drawRect(page, i * 20, 0, 20, 300, { r: v, g: v, b: v });
    }

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixels before filter at center and edge
    const beforeCenter = await getPixelAt(page, 200, 150);
    const beforeCorner = await getPixelAt(page, 10, 10);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'crt-before.png') });

    // Apply CRT filter via menu with moderate settings
    await applyFilter(page, 'CRT / Scanline...', {
      'Scanline Intensity': 70,
      'Scanline Spacing': 3,
      'Curvature': 30,
      'Phosphor Glow': 40,
      'Vignette': 60,
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'crt-after.png') });

    // Read pixels after — scanlines darken some rows, vignette darkens corners
    const afterCenter = await getPixelAt(page, 200, 150);
    const afterCorner = await getPixelAt(page, 10, 10);

    // Center pixel should be affected by scanlines (either darker or same depending
    // on which phase of the scanline pattern it falls on), but the overall image
    // should be visibly modified.
    const centerDiff = Math.abs(afterCenter.r - beforeCenter.r)
      + Math.abs(afterCenter.g - beforeCenter.g)
      + Math.abs(afterCenter.b - beforeCenter.b);

    // The corner should be noticeably darker due to vignette + possible scanlines
    const cornerDiff = Math.abs(afterCorner.r - beforeCorner.r)
      + Math.abs(afterCorner.g - beforeCorner.g)
      + Math.abs(afterCorner.b - beforeCorner.b);

    // At least one of center or corner should show visible change from the filter
    expect(centerDiff + cornerDiff).toBeGreaterThan(10);

    // Vignette should make the corner darker relative to its original value
    const cornerBrightnessBefore = beforeCorner.r + beforeCorner.g + beforeCorner.b;
    const cornerBrightnessAfter = afterCorner.r + afterCorner.g + afterCorner.b;
    if (cornerBrightnessBefore > 30) {
      expect(cornerBrightnessAfter).toBeLessThan(cornerBrightnessBefore);
    }

    // Layer should still exist with original dimensions
    const layerInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; width: number; height: number }>; activeLayerId: string };
        };
      };
      const state = store.getState();
      return {
        layerCount: state.document.layers.length,
        layerWidth: state.document.layers[0]?.width,
        layerHeight: state.document.layers[0]?.height,
      };
    });

    expect(layerInfo.layerCount).toBeGreaterThan(0);
    expect(layerInfo.layerWidth).toBe(400);
    expect(layerInfo.layerHeight).toBe(300);
  });

  test('CRT filter dialog shows all five controls', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=CRT / Scanline...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("CRT / Scanline")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    await expect(page.locator('text=Scanline Intensity')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Scanline Spacing')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Curvature')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Phosphor Glow')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Vignette')).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'crt-dialog.png') });

    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
  });

  test('CRT filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    await drawRect(page, 0, 0, 200, 200, { r: 200, g: 200, b: 200 });
    await fitToView(page);

    const beforePixel = await getPixelAt(page, 100, 100);

    await applyFilter(page, 'CRT / Scanline...', {
      'Scanline Intensity': 80,
      'Scanline Spacing': 2,
      'Curvature': 0,
      'Phosphor Glow': 0,
      'Vignette': 50,
    });
    await page.waitForTimeout(300);

    const afterFilter = await getPixelAt(page, 100, 100);
    const filterDiff = Math.abs(afterFilter.r - beforePixel.r)
      + Math.abs(afterFilter.g - beforePixel.g)
      + Math.abs(afterFilter.b - beforePixel.b);
    expect(filterDiff).toBeGreaterThan(0);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const afterUndo = await getPixelAt(page, 100, 100);
    expect(afterUndo.r).toBe(beforePixel.r);
    expect(afterUndo.g).toBe(beforePixel.g);
    expect(afterUndo.b).toBe(beforePixel.b);
  });

  test('scanlines create alternating bright/dark rows', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Fill with uniform bright color so scanline modulation is the only variable
    await drawRect(page, 0, 0, 200, 200, { r: 200, g: 200, b: 200 });
    await fitToView(page);

    // Apply with high scanline intensity, no curvature/vignette/phosphor
    await applyFilter(page, 'CRT / Scanline...', {
      'Scanline Intensity': 90,
      'Scanline Spacing': 4,
      'Curvature': 0,
      'Phosphor Glow': 0,
      'Vignette': 0,
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'crt-scanlines-only.png') });

    // Sample a column of pixels to verify scanline modulation creates variation
    const pixelValues: number[] = [];
    for (let y = 40; y < 160; y += 2) {
      const px = await getPixelAt(page, 100, y);
      pixelValues.push(px.r);
    }

    // With scanline spacing 4 and high intensity, there should be meaningful
    // brightness variation across rows (some bright, some darkened)
    const minVal = Math.min(...pixelValues);
    const maxVal = Math.max(...pixelValues);
    expect(maxVal - minVal).toBeGreaterThan(20);
  });
});
