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

test.describe('High Pass Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('extracts edge detail and shifts flat regions to mid-gray', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Create a pattern with sharp edges: dark block next to bright block.
    // High Pass should turn flat interiors to ~128 gray and emphasize edges.
    await drawRect(page, 0, 0, 200, 300, { r: 40, g: 40, b: 40 });
    await drawRect(page, 200, 0, 200, 300, { r: 220, g: 220, b: 220 });
    await drawRect(page, 150, 100, 100, 100, { r: 255, g: 0, b: 0 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Sample well inside each block (away from canvas edges to avoid blur boundary effects)
    const beforeDarkInterior = await getPixelAt(page, 100, 150);
    const beforeBrightInterior = await getPixelAt(page, 300, 150);
    const beforeEdge = await getPixelAt(page, 200, 50);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'high-pass-before.png') });

    await applyFilter(page, 'High Pass...', { 'Radius': 10, 'Strength': 1 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'high-pass-after.png') });

    const afterDarkInterior = await getPixelAt(page, 100, 150);
    const afterBrightInterior = await getPixelAt(page, 300, 150);
    const afterEdge = await getPixelAt(page, 200, 50);

    // Both flat interiors should have moved toward mid-gray.
    // Dark block (was 40) should increase, bright block (was 220) should decrease.
    expect(afterDarkInterior.r).toBeGreaterThan(beforeDarkInterior.r);
    expect(afterBrightInterior.r).toBeLessThan(beforeBrightInterior.r);

    // Both should be closer to each other than before (converging toward gray).
    const beforeSpread = Math.abs(beforeBrightInterior.r - beforeDarkInterior.r);
    const afterSpread = Math.abs(afterBrightInterior.r - afterDarkInterior.r);
    expect(afterSpread).toBeLessThan(beforeSpread);

    // Edge pixel should deviate from 128 more than interior pixels,
    // because edges carry the high-frequency detail.
    const edgeDeviationFromGray = Math.abs(afterEdge.r - 128)
      + Math.abs(afterEdge.g - 128)
      + Math.abs(afterEdge.b - 128);
    const interiorDeviationFromGray = Math.abs(afterDarkInterior.r - 128)
      + Math.abs(afterDarkInterior.g - 128)
      + Math.abs(afterDarkInterior.b - 128);
    expect(edgeDeviationFromGray).toBeGreaterThan(interiorDeviationFromGray);
  });

  test('higher strength amplifies the edge detail', async ({ page }) => {
    await createDocument(page, 300, 200, false);

    await drawRect(page, 0, 0, 150, 200, { r: 60, g: 60, b: 60 });
    await drawRect(page, 150, 0, 150, 200, { r: 200, g: 200, b: 200 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Apply with low strength first
    await applyFilter(page, 'High Pass...', { 'Radius': 8, 'Strength': 1 });
    await page.waitForTimeout(300);

    const lowStrengthEdge = await getPixelAt(page, 150, 100);

    // Undo and apply with high strength
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    await applyFilter(page, 'High Pass...', { 'Radius': 8, 'Strength': 3 });
    await page.waitForTimeout(300);

    const highStrengthEdge = await getPixelAt(page, 150, 100);

    // Higher strength should produce a more extreme deviation from mid-gray at edges.
    const lowDev = Math.abs(lowStrengthEdge.r - 128)
      + Math.abs(lowStrengthEdge.g - 128)
      + Math.abs(lowStrengthEdge.b - 128);
    const highDev = Math.abs(highStrengthEdge.r - 128)
      + Math.abs(highStrengthEdge.g - 128)
      + Math.abs(highStrengthEdge.b - 128);
    expect(highDev).toBeGreaterThan(lowDev);
  });

  test('high pass filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    await drawRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0 });
    await drawRect(page, 100, 0, 100, 200, { r: 0, g: 0, b: 255 });
    await fitToView(page);

    const beforePixel = await getPixelAt(page, 50, 100);

    await applyFilter(page, 'High Pass...', { 'Radius': 15, 'Strength': 1 });
    await page.waitForTimeout(300);

    const afterFilter = await getPixelAt(page, 50, 100);
    const diff = Math.abs(afterFilter.r - beforePixel.r)
      + Math.abs(afterFilter.g - beforePixel.g)
      + Math.abs(afterFilter.b - beforePixel.b);
    expect(diff).toBeGreaterThan(50);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const afterUndo = await getPixelAt(page, 50, 100);
    expect(afterUndo.r).toBe(beforePixel.r);
    expect(afterUndo.g).toBe(beforePixel.g);
    expect(afterUndo.b).toBe(beforePixel.b);
  });

  test('filter dialog shows radius and strength controls', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=High Pass...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("High Pass")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const radiusLabel = page.locator('text=Radius');
    const strengthLabel = page.locator('text=Strength');
    await expect(radiusLabel).toBeVisible({ timeout: 3000 });
    await expect(strengthLabel).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'high-pass-dialog.png') });

    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
  });
});
