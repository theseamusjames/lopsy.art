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

test.describe('Duotone Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies duotone filter and maps luminance to two colors', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a dark block on the left and a bright block on the right
    await drawRect(page, 0, 0, 200, 300, { r: 40, g: 40, b: 40 });
    await drawRect(page, 200, 0, 200, 300, { r: 220, g: 220, b: 220 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixels before filter
    const darkBefore = await getPixelAt(page, 50, 150);
    const brightBefore = await getPixelAt(page, 350, 150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'duotone-before.png') });

    // Open Filter menu and click Duotone
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Duotone...');
    await page.waitForTimeout(300);

    // The duotone dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Duotone")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Click Apply with default preset (Midnight Gold: dark blue shadows, golden highlights)
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'duotone-after.png') });

    // Read pixels after the filter
    const darkAfter = await getPixelAt(page, 50, 150);
    const brightAfter = await getPixelAt(page, 350, 150);

    // The dark region should now have the shadow color (dark blue-ish, not gray)
    // Default shadow color: r=10, g=15, b=50
    expect(darkAfter.a).toBeGreaterThan(200);
    expect(darkAfter.b).toBeGreaterThan(darkAfter.r);

    // The bright region should have the highlight color (golden/warm, not gray)
    // Default highlight color: r=255, g=200, b=50
    expect(brightAfter.a).toBeGreaterThan(200);
    expect(brightAfter.r).toBeGreaterThan(brightAfter.b);

    // Both regions should differ from the original grayscale
    const darkChanged =
      Math.abs(darkAfter.r - darkBefore.r) > 5 ||
      Math.abs(darkAfter.g - darkBefore.g) > 5 ||
      Math.abs(darkAfter.b - darkBefore.b) > 5;
    expect(darkChanged).toBe(true);

    const brightChanged =
      Math.abs(brightAfter.r - brightBefore.r) > 5 ||
      Math.abs(brightAfter.g - brightBefore.g) > 5 ||
      Math.abs(brightAfter.b - brightBefore.b) > 5;
    expect(brightChanged).toBe(true);
  });

  test('preset swatches change the duotone colors', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint half dark, half bright
    await drawRect(page, 0, 0, 200, 300, { r: 30, g: 30, b: 30 });
    await drawRect(page, 200, 0, 200, 300, { r: 230, g: 230, b: 230 });
    await fitToView(page);
    await page.waitForTimeout(300);

    // Open Duotone dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Duotone...');
    await page.waitForTimeout(300);

    // Click the "Infrared" preset swatch (6th preset button — dark purple shadows, red highlights)
    const presetButtons = page.locator('div[role="dialog"] button[title]');
    const infraredPreset = presetButtons.nth(5);
    await infraredPreset.click();
    await page.waitForTimeout(200);

    // Click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'duotone-infrared.png') });

    // Bright region should be reddish (Infrared highlight is r=255, g=60, b=60)
    const brightPixel = await getPixelAt(page, 350, 150);
    expect(brightPixel.r).toBeGreaterThan(150);
    expect(brightPixel.r).toBeGreaterThan(brightPixel.g);
    expect(brightPixel.r).toBeGreaterThan(brightPixel.b);
  });

  test('duotone filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a simple grayscale block
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });
    await fitToView(page);
    await page.waitForTimeout(300);

    const before = await getPixelAt(page, 100, 100);

    // Apply duotone
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Duotone...');
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    const afterFilter = await getPixelAt(page, 100, 100);
    const changed =
      Math.abs(afterFilter.r - before.r) > 5 ||
      Math.abs(afterFilter.g - before.g) > 5 ||
      Math.abs(afterFilter.b - before.b) > 5;
    expect(changed).toBe(true);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const afterUndo = await getPixelAt(page, 100, 100);
    expect(Math.abs(afterUndo.r - before.r)).toBeLessThan(10);
    expect(Math.abs(afterUndo.g - before.g)).toBeLessThan(10);
    expect(Math.abs(afterUndo.b - before.b)).toBeLessThan(10);
  });
});
