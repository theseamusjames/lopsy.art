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

test.describe('Film Grain Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('adds luminance-aware grain that modifies midtones more than extremes', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint three vertical bands: dark (left), midtone (center), bright (right)
    await drawRect(page, 0, 0, 133, 300, { r: 30, g: 30, b: 30 });
    await drawRect(page, 133, 0, 134, 300, { r: 128, g: 128, b: 128 });
    await drawRect(page, 267, 0, 133, 300, { r: 230, g: 230, b: 230 });

    await fitToView(page);
    await page.waitForTimeout(300);

    const darkBefore = await getPixelAt(page, 66, 150);
    const midBefore = await getPixelAt(page, 200, 150);
    const brightBefore = await getPixelAt(page, 333, 150);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'film-grain-before.png') });

    await applyFilter(page, 'Film Grain...', { 'Amount': 80, 'Grain Size': 1, 'Roughness': 50 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'film-grain-after.png') });

    // Sample multiple pixels in each band to measure variance (grain effect)
    const sampleVariance = async (startX: number, endX: number, y: number) => {
      const samples: number[] = [];
      for (let x = startX + 5; x < endX - 5; x += 10) {
        const px = await getPixelAt(page, x, y);
        samples.push(px.r);
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      return samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / samples.length;
    };

    const darkVariance = await sampleVariance(0, 133, 150);
    const midVariance = await sampleVariance(133, 267, 150);
    const brightVariance = await sampleVariance(267, 400, 150);

    // Midtone band should have the most grain variance (luminance-aware response)
    expect(midVariance).toBeGreaterThan(darkVariance);
    expect(midVariance).toBeGreaterThan(brightVariance);

    // At least some change should have occurred in the midtone band
    const midDiff = Math.abs(midBefore.r - (await getPixelAt(page, 200, 150)).r)
      + Math.abs(midBefore.g - (await getPixelAt(page, 200, 150)).g)
      + Math.abs(midBefore.b - (await getPixelAt(page, 200, 150)).b);
    expect(midDiff).toBeGreaterThan(0);
  });

  test('film grain dialog shows Amount, Grain Size, and Roughness controls', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Film Grain...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Film Grain")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    await expect(page.locator('text=Amount')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Grain Size')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Roughness')).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'film-grain-dialog.png') });

    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
  });

  test('film grain can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });
    await fitToView(page);

    const before = await getPixelAt(page, 100, 100);

    await applyFilter(page, 'Film Grain...', { 'Amount': 60, 'Grain Size': 1, 'Roughness': 50 });
    await page.waitForTimeout(300);

    const afterFilter = await getPixelAt(page, 100, 100);
    const diff = Math.abs(afterFilter.r - before.r)
      + Math.abs(afterFilter.g - before.g)
      + Math.abs(afterFilter.b - before.b);
    expect(diff).toBeGreaterThan(0);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const afterUndo = await getPixelAt(page, 100, 100);
    expect(afterUndo.r).toBe(before.r);
    expect(afterUndo.g).toBe(before.g);
    expect(afterUndo.b).toBe(before.b);
  });

  test('monochrome variant produces grayscale grain', async ({ page }) => {
    await createDocument(page, 300, 200, false);
    await drawRect(page, 0, 0, 300, 200, { r: 128, g: 128, b: 128 });
    await fitToView(page);

    await applyFilter(page, 'Film Grain (Mono)...', { 'Amount': 80, 'Grain Size': 1, 'Roughness': 50 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'film-grain-mono-after.png') });

    // With monochrome grain on a neutral gray base, R ≈ G ≈ B should hold
    for (let x = 20; x < 280; x += 40) {
      const px = await getPixelAt(page, x, 100);
      expect(Math.abs(px.r - px.g)).toBeLessThan(3);
      expect(Math.abs(px.g - px.b)).toBeLessThan(3);
    }
  });
});
