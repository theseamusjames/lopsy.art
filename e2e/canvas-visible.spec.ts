import { test, expect } from './fixtures';
import { waitForStore, createDocument, drawRect, getPixelAt } from './helpers';

test.describe('Canvas renders visibly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('white document produces non-zero composited pixels', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(1000);

    // Use the composited pixels helper which does sync+render+readPixels
    // in a single rAF (avoids preserveDrawingBuffer timing issues)
    const result = await page.evaluate(() => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      return readFn();
    });

    expect(errors.filter((e) => e.includes('null pointer'))).toHaveLength(0);
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);

    // Count non-zero pixels — a white document should fill the canvas area
    let nonZero = 0;
    for (const v of result!.pixels) {
      if (v !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(1000);
  });

  test('painted red rectangle is readable from GPU', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await createDocument(page, 400, 300, true);
    await drawRect(page, 100, 100, 50, 50, { r: 255, g: 0, b: 0 });
    await page.waitForTimeout(500);

    const pixel = await getPixelAt(page, 125, 125);

    expect(errors.filter((e) => e.includes('null pointer'))).toHaveLength(0);
    expect(pixel.r).toBeGreaterThan(200);
    expect(pixel.a).toBeGreaterThan(200);
  });
});
