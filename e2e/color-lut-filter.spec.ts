import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, getPixelAt } from './helpers';

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

async function getActiveLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function openColorLutDialog(page: Page) {
  await page.click('text=Filter');
  await page.waitForTimeout(200);
  const item = page.getByText('Color LUT…', { exact: true }).or(page.getByText('Color LUT...', { exact: true }));
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await page.waitForTimeout(300);
}

test.describe('Color LUT Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies a color LUT preset and visibly changes pixel colors', async ({ page }) => {
    await createDocument(page, 300, 300, true);

    // Paint a colorful scene: red, green, blue blocks
    await drawRect(page, 0, 0, 100, 300, { r: 220, g: 50, b: 50 });
    await drawRect(page, 100, 0, 100, 300, { r: 50, g: 200, b: 50 });
    await drawRect(page, 200, 0, 100, 300, { r: 50, g: 50, b: 220 });

    await fitToView(page);
    await page.waitForTimeout(300);

    const layerId = await getActiveLayerId(page);

    // Read pixels before the filter
    const beforeRed = await getPixelAt(page, 50, 150, layerId);
    const beforeGreen = await getPixelAt(page, 150, 150, layerId);
    const beforeBlue = await getPixelAt(page, 250, 150, layerId);

    // Screenshot before
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'color-lut-before.png') });

    // Open the Color LUT dialog
    await openColorLutDialog(page);

    // The dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Color LUT")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Select the "Teal & Orange" preset (second preset button)
    const presetButtons = page.locator('button:has(canvas)');
    await presetButtons.nth(1).click();
    await page.waitForTimeout(200);

    // Click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Screenshot after
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'color-lut-after.png') });

    // Read pixels after the filter
    const afterRed = await getPixelAt(page, 50, 150, layerId);
    const afterGreen = await getPixelAt(page, 150, 150, layerId);
    const afterBlue = await getPixelAt(page, 250, 150, layerId);

    // The colors should have visibly shifted — at least one channel should
    // differ by more than 10 for each block
    const redDiff = Math.abs(afterRed.r - beforeRed.r) +
                    Math.abs(afterRed.g - beforeRed.g) +
                    Math.abs(afterRed.b - beforeRed.b);
    const greenDiff = Math.abs(afterGreen.r - beforeGreen.r) +
                      Math.abs(afterGreen.g - beforeGreen.g) +
                      Math.abs(afterGreen.b - beforeGreen.b);
    const blueDiff = Math.abs(afterBlue.r - beforeBlue.r) +
                     Math.abs(afterBlue.g - beforeBlue.g) +
                     Math.abs(afterBlue.b - beforeBlue.b);

    expect(redDiff).toBeGreaterThan(10);
    expect(greenDiff).toBeGreaterThan(10);
    expect(blueDiff).toBeGreaterThan(10);
  });

  test('color LUT filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, true);

    await drawRect(page, 0, 0, 200, 200, { r: 180, g: 120, b: 60 });
    await fitToView(page);
    await page.waitForTimeout(200);

    const layerId = await getActiveLayerId(page);
    const beforePixel = await getPixelAt(page, 100, 100, layerId);

    // Apply via menu
    await openColorLutDialog(page);
    await page.waitForTimeout(200);

    // Select the "Noir" preset (third preset)
    const presetButtons = page.locator('button:has(canvas)');
    await presetButtons.nth(2).click();
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    const afterPixel = await getPixelAt(page, 100, 100, layerId);
    const changed = Math.abs(afterPixel.r - beforePixel.r) > 5 ||
                    Math.abs(afterPixel.g - beforePixel.g) > 5 ||
                    Math.abs(afterPixel.b - beforePixel.b) > 5;
    expect(changed).toBe(true);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const undonePixel = await getPixelAt(page, 100, 100, layerId);
    expect(Math.abs(undonePixel.r - beforePixel.r)).toBeLessThan(3);
    expect(Math.abs(undonePixel.g - beforePixel.g)).toBeLessThan(3);
    expect(Math.abs(undonePixel.b - beforePixel.b)).toBeLessThan(3);
  });

  test('color LUT dialog shows preset grid and intensity slider', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 200, g: 100, b: 50 });
    await fitToView(page);
    await page.waitForTimeout(200);

    // Open the dialog
    await openColorLutDialog(page);

    // The dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Color LUT")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Should show preset buttons with canvas thumbnails
    const presetButtons = page.locator('button:has(canvas)');
    const count = await presetButtons.count();
    expect(count).toBeGreaterThanOrEqual(8);

    // Should have an intensity slider
    const intensityLabel = page.locator('text=Intensity');
    await expect(intensityLabel).toBeVisible();

    // Should have import button
    const importButton = page.locator('button:has-text("Import .cube")');
    await expect(importButton).toBeVisible();

    // Screenshot the dialog UI
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'color-lut-dialog.png') });

    // Cancel button should close the dialog
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
    await expect(dialogHeading).not.toBeVisible({ timeout: 3000 });
  });
});
