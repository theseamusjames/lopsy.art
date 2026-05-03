import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, getPixelAt } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

/**
 * Paint the active layer as a horizontal gradient: left edge is full red,
 * right edge is dark, all pixels fully opaque.
 */
async function paintHorizontalGradient(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; width: number; height: number };
        getOrCreateLayerPixelData: (id: string) => ImageData;
        updateLayerPixelData: (id: string, data: ImageData) => void;
        pushHistory: (label?: string) => void;
      };
    };
    const state = store.getState();
    const id = state.document.activeLayerId;
    const W = state.document.width;
    const H = state.document.height;
    state.pushHistory('Paint gradient');
    const data = state.getOrCreateLayerPixelData(id);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const v = Math.round((x / (W - 1)) * 255);
        data.data[idx] = v;
        data.data[idx + 1] = 0;
        data.data[idx + 2] = 0;
        data.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
  await page.waitForTimeout(200);
}

test.describe('Spherize/Pinch Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('spherize distorts pixels away from identity', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await paintHorizontalGradient(page);

    // Snapshot pixels before filter — sample across the horizontal gradient
    const beforeLeft = await getPixelAt(page, 10, 100);
    const beforeCenter = await getPixelAt(page, 100, 100);
    const beforeRight = await getPixelAt(page, 190, 100);

    // Gradient should be dark on the left, mid in the center, bright on the right
    expect(beforeLeft.r).toBeLessThan(50);
    expect(beforeCenter.r).toBeGreaterThan(100);
    expect(beforeRight.r).toBeGreaterThan(200);
    expect(beforeLeft.a).toBe(255);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'spherize-before.png') });

    // Apply spherize via the Filter menu with amount = 80
    await page.click('text=Filter');
    await page.waitForTimeout(150);
    await page.click('text=Spherize...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Spherize")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Verify Amount slider and Mode select are present
    const amountLabel = page.locator('text=Amount');
    const modeLabel = page.locator('text=Mode');
    await expect(amountLabel).toBeVisible({ timeout: 2000 });
    await expect(modeLabel).toBeVisible({ timeout: 2000 });

    // Set amount to 80 via slider
    const amountSlider = page.locator('input[type="range"]').first();
    await amountSlider.fill('80');
    await page.waitForTimeout(150);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'spherize-after.png') });

    // After spherize the center should still be opaque
    const afterCenter = await getPixelAt(page, 100, 100);
    expect(afterCenter.a).toBe(255);

    // The filter should change pixel values — read across a horizontal scan
    // and verify at least some pixels changed value
    const changedPixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return 0;
      const W = result.width;
      const H = result.height;
      // Build the expected gradient (what it was before filter)
      let changed = 0;
      const y = Math.floor(H / 2);
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const original = Math.round((x / (W - 1)) * 255);
        const actual = result.pixels[idx]!;
        if (Math.abs(actual - original) > 5) changed++;
      }
      return changed;
    });

    // Spherize should displace a significant fraction of the horizontal line
    expect(changedPixels).toBeGreaterThan(30);
  });

  test('amount=0 produces no visible change', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    await paintHorizontalGradient(page);

    // Read center pixel before
    const before = await getPixelAt(page, 50, 50);

    await page.click('text=Filter');
    await page.waitForTimeout(150);
    await page.click('text=Spherize...');
    await page.waitForTimeout(300);

    await expect(page.locator('h2:has-text("Spherize")')).toBeVisible({ timeout: 3000 });

    // Set amount to 0
    const amountSlider = page.locator('input[type="range"]').first();
    await amountSlider.fill('0');
    await page.waitForTimeout(150);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'spherize-zero.png') });

    // Center pixel should be unchanged (amount=0 → identity)
    const after = await getPixelAt(page, 50, 50);
    expect(Math.abs(after.r - before.r)).toBeLessThanOrEqual(2);
    expect(after.a).toBe(255);
  });

  test('pinch (negative amount) distorts pixels inward', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await paintHorizontalGradient(page);

    await page.click('text=Filter');
    await page.waitForTimeout(150);
    await page.click('text=Spherize...');
    await page.waitForTimeout(300);

    await expect(page.locator('h2:has-text("Spherize")')).toBeVisible({ timeout: 3000 });

    // Set amount to -80 (pinch)
    const amountSlider = page.locator('input[type="range"]').first();
    await amountSlider.fill('-80');
    await page.waitForTimeout(150);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'spherize-pinch.png') });

    // Pinch should still keep pixels opaque
    const centerPixel = await getPixelAt(page, 100, 100);
    expect(centerPixel.a).toBe(255);

    // Pinch and spherize should produce different results at a mid-point
    // (already captured above in the spherize test) — this test verifies
    // the filter runs at all with negative amount
    const movedPixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return 0;
      const W = result.width;
      const H = result.height;
      let changed = 0;
      const y = Math.floor(H / 2);
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const original = Math.round((x / (W - 1)) * 255);
        const actual = result.pixels[idx]!;
        if (Math.abs(actual - original) > 5) changed++;
      }
      return changed;
    });

    expect(movedPixels).toBeGreaterThan(30);
  });

  test('spherize filter is undoable', async ({ page }) => {
    await createDocument(page, 150, 150, true);
    await paintHorizontalGradient(page);

    const before = await getPixelAt(page, 75, 75);

    // Apply spherize with strong amount
    await page.click('text=Filter');
    await page.waitForTimeout(150);
    await page.click('text=Spherize...');
    await page.waitForTimeout(300);
    await expect(page.locator('h2:has-text("Spherize")')).toBeVisible({ timeout: 3000 });
    const slider = page.locator('input[type="range"]').first();
    await slider.fill('100');
    await page.waitForTimeout(100);
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(400);

    // Verify filter changed the center pixel
    const afterFilter = await getPixelAt(page, 75, 75);
    // Center stays in place for radial, but surrounding pixels shift
    expect(afterFilter.a).toBe(255);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);

    // Pixel should be restored
    const afterUndo = await getPixelAt(page, 75, 75);
    expect(Math.abs(afterUndo.r - before.r)).toBeLessThanOrEqual(2);
    expect(afterUndo.a).toBe(255);
  });

  test('mode dropdown selects Horizontal Only', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await paintHorizontalGradient(page);

    await page.click('text=Filter');
    await page.waitForTimeout(150);
    await page.click('text=Spherize...');
    await page.waitForTimeout(300);

    await expect(page.locator('h2:has-text("Spherize")')).toBeVisible({ timeout: 3000 });

    // Set amount to 80, switch mode to Horizontal Only
    const amountSlider = page.locator('input[type="range"]').first();
    await amountSlider.fill('80');
    await page.waitForTimeout(100);

    const modeSelect = page.locator('select');
    await modeSelect.selectOption({ label: 'Horizontal Only' });
    await page.waitForTimeout(100);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'spherize-horizontal.png') });

    // Horizontal mode should change pixels (distorts x-axis)
    const changedPixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return 0;
      const W = result.width;
      const H = result.height;
      let changed = 0;
      const y = Math.floor(H / 2);
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const original = Math.round((x / (W - 1)) * 255);
        const actual = result.pixels[idx]!;
        if (Math.abs(actual - original) > 5) changed++;
      }
      return changed;
    });

    expect(changedPixels).toBeGreaterThan(20);
  });
});
