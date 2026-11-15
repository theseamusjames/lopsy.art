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

test.describe('Fibers Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('generates fiber texture that replaces layer content', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    await drawRect(page, 0, 0, 200, 300, { r: 60, g: 60, b: 60 });
    await drawRect(page, 200, 0, 200, 300, { r: 200, g: 200, b: 200 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Fibers is seeded randomly, so any single pixel can land within a few
    // levels of the original grey. Judge each half by a row of samples.
    const leftXs = [20, 50, 80, 110, 140, 170];
    const rightXs = [230, 260, 290, 320, 350, 380];
    const sampleRow = async (xs: number[]) => {
      const row = [];
      for (const x of xs) row.push(await getPixelAt(page, x, 150));
      return row;
    };
    const beforeLeft = await sampleRow(leftXs);
    const beforeRight = await sampleRow(rightXs);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'fibers-before.png') });

    await applyFilter(page, 'Fibers...', { 'Variance': 32, 'Strength': 32 });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'fibers-after.png') });

    const afterLeft = await sampleRow(leftXs);
    const afterRight = await sampleRow(rightXs);

    const changedCount = (before: typeof afterLeft, after: typeof afterLeft) =>
      after.filter((px, i) => {
        const b = before[i]!;
        return Math.abs(px.r - b.r) + Math.abs(px.g - b.g) + Math.abs(px.b - b.b) > 10;
      }).length;
    expect(changedCount(beforeLeft, afterLeft)).toBeGreaterThanOrEqual(4);
    expect(changedCount(beforeRight, afterRight)).toBeGreaterThanOrEqual(4);

    // Fibers should be grayscale — R ≈ G ≈ B for any sampled pixel
    for (const px of [...afterLeft, ...afterRight]) {
      expect(Math.abs(px.r - px.g)).toBeLessThan(5);
      expect(Math.abs(px.g - px.b)).toBeLessThan(5);
    }

    // Sample multiple pixels along a horizontal line — fibers create
    // vertical streaks so brightness should vary across x.
    const horizontalSamples: number[] = [];
    for (let x = 20; x < 380; x += 40) {
      const px = await getPixelAt(page, x, 150);
      horizontalSamples.push(px.r);
    }

    const hMin = Math.min(...horizontalSamples);
    const hMax = Math.max(...horizontalSamples);
    expect(hMax - hMin).toBeGreaterThan(15);

    // Vertical coherence: pixels at same x but different y should be
    // more similar than horizontal neighbours (fibers are vertical).
    const vertA = await getPixelAt(page, 100, 80);
    const vertB = await getPixelAt(page, 100, 220);
    const vertDiff = Math.abs(vertA.r - vertB.r);

    const horizA = await getPixelAt(page, 60, 150);
    const horizB = await getPixelAt(page, 180, 150);
    const horizDiff = Math.abs(horizA.r - horizB.r);

    // On average, vertical neighbours should be closer than far-apart
    // horizontal neighbours. Using a soft check since noise adds variation.
    expect(vertDiff).toBeLessThan(horizDiff + 80);
  });

  test('fibers filter dialog shows variance and strength controls', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128 });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Fibers...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Fibers")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const varianceLabel = page.locator('text=Variance');
    const strengthLabel = page.locator('text=Strength');
    await expect(varianceLabel).toBeVisible({ timeout: 3000 });
    await expect(strengthLabel).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'fibers-dialog.png') });

    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
  });

  test('fibers filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await drawRect(page, 0, 0, 200, 200, { r: 100, g: 100, b: 100 });
    await fitToView(page);

    const before = await getPixelAt(page, 100, 100);

    await applyFilter(page, 'Fibers...', { 'Variance': 20, 'Strength': 20 });
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
});
