import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect, applyFilter } from './helpers';

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

async function readPixelAt(page: Page, x: number, y: number) {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const result = await readFn();
    if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const idx = (y * result.width + x) * 4;
    return {
      r: result.pixels[idx],
      g: result.pixels[idx + 1],
      b: result.pixels[idx + 2],
      a: result.pixels[idx + 3],
    };
  }, { x, y });
}

test.describe('Channel Mixer Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('swaps red and blue channels via channel mixer', async ({ page }) => {
    await createDocument(page, 300, 200, false);

    // Paint a pure red rectangle on the left, pure blue on the right
    await drawRect(page, 0, 0, 150, 200, { r: 255, g: 0, b: 0 });
    await drawRect(page, 150, 0, 150, 200, { r: 0, g: 0, b: 255 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixels before — center of red region and center of blue region
    const beforeRed = await readPixelAt(page, 75, 100);
    const beforeBlue = await readPixelAt(page, 225, 100);

    expect(beforeRed.r).toBe(255);
    expect(beforeRed.b).toBe(0);
    expect(beforeBlue.r).toBe(0);
    expect(beforeBlue.b).toBe(255);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'channel-mixer-before.png') });

    // Apply channel mixer: swap R and B channels
    // Red output = 0%R + 0%G + 100%B (take blue)
    // Green output = 0%R + 100%G + 0%B (keep green)
    // Blue output = 100%R + 0%G + 0%B (take red)
    await applyFilter(page, 'Channel Mixer...', {
      'Red → Red': 0,
      'Blue → Red': 100,
      'Red → Blue': 100,
      'Blue → Blue': 0,
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'channel-mixer-after.png') });

    // After swap: the formerly red region should now be blue, and vice versa
    const afterRed = await readPixelAt(page, 75, 100);
    const afterBlue = await readPixelAt(page, 225, 100);

    // Left region was (255,0,0) → should now be (0,0,255)
    expect(afterRed.r).toBe(0);
    expect(afterRed.g).toBe(0);
    expect(afterRed.b).toBe(255);

    // Right region was (0,0,255) → should now be (255,0,0)
    expect(afterBlue.r).toBe(255);
    expect(afterBlue.g).toBe(0);
    expect(afterBlue.b).toBe(0);
  });

  test('creates monochrome B&W conversion with custom weights', async ({ page }) => {
    await createDocument(page, 300, 200, false);

    // Paint three color strips: red, green, blue
    await drawRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0 });
    await drawRect(page, 100, 0, 100, 200, { r: 0, g: 255, b: 0 });
    await drawRect(page, 200, 0, 100, 200, { r: 0, g: 0, b: 255 });

    await fitToView(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'channel-mixer-bw-before.png') });

    // Convert to monochrome by sending all channels through the same mix
    // Luminance weights: R=30%, G=59%, B=11%
    await applyFilter(page, 'Channel Mixer...', {
      'Red → Red': 30,
      'Green → Red': 59,
      'Blue → Red': 11,
      'Red → Green': 30,
      'Green → Green': 59,
      'Blue → Green': 11,
      'Red → Blue': 30,
      'Green → Blue': 59,
      'Blue → Blue': 11,
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'channel-mixer-bw-after.png') });

    // Each color strip should now be a shade of gray (R ≈ G ≈ B)
    const redStrip = await readPixelAt(page, 50, 100);
    const greenStrip = await readPixelAt(page, 150, 100);
    const blueStrip = await readPixelAt(page, 250, 100);

    // Red strip: 255*0.30 ≈ 76 for all channels
    expect(Math.abs(redStrip.r - redStrip.g)).toBeLessThan(3);
    expect(Math.abs(redStrip.r - redStrip.b)).toBeLessThan(3);
    expect(redStrip.r).toBeGreaterThan(70);
    expect(redStrip.r).toBeLessThan(85);

    // Green strip: 255*0.59 ≈ 150 for all channels
    expect(Math.abs(greenStrip.r - greenStrip.g)).toBeLessThan(3);
    expect(Math.abs(greenStrip.r - greenStrip.b)).toBeLessThan(3);
    expect(greenStrip.r).toBeGreaterThan(145);
    expect(greenStrip.r).toBeLessThan(160);

    // Blue strip: 255*0.11 ≈ 28 for all channels
    expect(Math.abs(blueStrip.r - blueStrip.g)).toBeLessThan(3);
    expect(Math.abs(blueStrip.r - blueStrip.b)).toBeLessThan(3);
    expect(blueStrip.r).toBeGreaterThan(23);
    expect(blueStrip.r).toBeLessThan(35);
  });

  test('channel mixer can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    await drawRect(page, 0, 0, 200, 200, { r: 200, g: 100, b: 50 });
    await fitToView(page);
    await page.waitForTimeout(300);

    const before = await readPixelAt(page, 100, 100);

    // Apply channel mixer with some adjustment
    await applyFilter(page, 'Channel Mixer...', {
      'Red → Red': 50,
      'Green → Red': 50,
    });
    await page.waitForTimeout(300);

    // Verify it changed
    const after = await readPixelAt(page, 100, 100);
    expect(after.r).not.toBe(before.r);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    const afterUndo = await readPixelAt(page, 100, 100);
    expect(afterUndo.r).toBe(before.r);
    expect(afterUndo.g).toBe(before.g);
    expect(afterUndo.b).toBe(before.b);
  });
});
