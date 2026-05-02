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

async function readLayerPixels(page: Page, layerId?: string) {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, (id?: string) => Promise<{
      width: number; height: number; pixels: number[];
    }>>).__readLayerPixels;
    return read(id);
  }, layerId);
}

test.describe('Bloom Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies bloom filter and creates visible glow around bright areas', async ({ page }) => {
    await createDocument(page, 300, 300, true);

    // Paint a bright white square on a dark background
    // Dark background fills the whole canvas
    await drawRect(page, 0, 0, 300, 300, { r: 20, g: 20, b: 30 });
    // Bright white square in the center
    await drawRect(page, 100, 100, 100, 100, { r: 255, g: 255, b: 255 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixels before the filter to establish baseline
    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    const beforeEdge = await getPixelAt(page, 80, 150, state.activeLayerId);

    // Screenshot before
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bloom-before.png') });

    // Apply bloom filter via the menu
    await applyFilter(page, 'Bloom...', {
      'Threshold': 30,
      'Soft Knee': 50,
      'Radius': 20,
      'Intensity': 150,
    });
    await page.waitForTimeout(500);

    // Screenshot after
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bloom-after.png') });

    // The area adjacent to the bright square should now be brighter due to bloom
    const afterEdge = await getPixelAt(page, 80, 150, state.activeLayerId);

    // The dark area near the bright square should have increased brightness from the glow
    const edgeBrightnessIncrease =
      (afterEdge.r - beforeEdge.r) + (afterEdge.g - beforeEdge.g) + (afterEdge.b - beforeEdge.b);
    expect(edgeBrightnessIncrease).toBeGreaterThan(10);

    // The center of the bright square should still be very bright
    const centerAfter = await getPixelAt(page, 150, 150, state.activeLayerId);
    expect(centerAfter.r).toBeGreaterThan(200);
    expect(centerAfter.g).toBeGreaterThan(200);
    expect(centerAfter.b).toBeGreaterThan(200);

    // Far corner (0,0) should be nearly unchanged — bloom doesn't reach there
    const farCornerAfter = await getPixelAt(page, 5, 5, state.activeLayerId);
    expect(farCornerAfter.r).toBeLessThan(50);
  });

  test('bloom filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    // Dark background with a bright center — bloom will spread light into the dark area
    await drawRect(page, 0, 0, 200, 200, { r: 20, g: 20, b: 30 });
    await drawRect(page, 60, 60, 80, 80, { r: 255, g: 255, b: 255 });
    await fitToView(page);
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return { activeLayerId: store.getState().document.activeLayerId };
    });

    const beforePixel = await getPixelAt(page, 50, 100, state.activeLayerId);

    // Apply bloom — radius 30 to spread glow well beyond the bright square
    await applyFilter(page, 'Bloom...', {
      'Threshold': 30,
      'Radius': 30,
      'Intensity': 150,
    });
    await page.waitForTimeout(300);

    const afterPixel = await getPixelAt(page, 50, 100, state.activeLayerId);
    const changed = Math.abs(afterPixel.r - beforePixel.r) > 5 ||
                    Math.abs(afterPixel.g - beforePixel.g) > 5 ||
                    Math.abs(afterPixel.b - beforePixel.b) > 5;
    expect(changed).toBe(true);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const undonePixel = await getPixelAt(page, 50, 100, state.activeLayerId);
    expect(Math.abs(undonePixel.r - beforePixel.r)).toBeLessThan(3);
    expect(Math.abs(undonePixel.g - beforePixel.g)).toBeLessThan(3);
    expect(Math.abs(undonePixel.b - beforePixel.b)).toBeLessThan(3);
  });

  test('bloom filter dialog UI is visible and functional', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 200, g: 100, b: 50 });
    await fitToView(page);
    await page.waitForTimeout(200);

    // Open the filter dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Bloom...');
    await page.waitForTimeout(300);

    // The dialog should be visible with the correct title
    const dialogHeading = page.locator('h2:has-text("Bloom")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Screenshot the dialog UI
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'bloom-dialog.png') });

    // Apply button should exist
    const applyButton = page.locator('button:has-text("Apply")');
    await expect(applyButton).toBeVisible();

    // Click Apply
    await applyButton.click();
    await page.waitForTimeout(300);

    // Dialog should close
    await expect(dialogHeading).not.toBeVisible({ timeout: 3000 });
  });
});
