import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument, drawRect, setAdjustment } from './helpers';

async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

test.describe('Color Temperature & Tint adjustments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);
    await page.waitForTimeout(300);
  });

  test('warm temperature shifts pixels toward orange (more red, less blue)', async ({ page }) => {
    await drawRect(page, 40, 40, 120, 120, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/temperature-tint-before.png' });

    expect(before.a).toBeGreaterThan(200);

    await setAdjustment(page, 'Temperature', 80);
    await page.waitForTimeout(300);

    const after = await readCompositedAtDoc(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/temperature-warm.png' });

    expect(after.r).toBeGreaterThan(before.r);
    expect(after.b).toBeLessThan(before.b);
    expect(after.a).toBeGreaterThan(200);
  });

  test('cool temperature shifts pixels toward blue (less red, more blue)', async ({ page }) => {
    await drawRect(page, 40, 40, 120, 120, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 100, 100);

    await setAdjustment(page, 'Temperature', -80);
    await page.waitForTimeout(300);

    const after = await readCompositedAtDoc(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/temperature-cool.png' });

    expect(after.r).toBeLessThan(before.r);
    expect(after.b).toBeGreaterThan(before.b);
  });

  test('positive tint shifts pixels toward green', async ({ page }) => {
    await drawRect(page, 40, 40, 120, 120, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 100, 100);

    await setAdjustment(page, 'Tint', 80);
    await page.waitForTimeout(300);

    const after = await readCompositedAtDoc(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/tint-green.png' });

    expect(after.g).toBeGreaterThan(before.g);
  });

  test('negative tint shifts pixels toward magenta (less green)', async ({ page }) => {
    await drawRect(page, 40, 40, 120, 120, { r: 128, g: 128, b: 128 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 100, 100);

    await setAdjustment(page, 'Tint', -80);
    await page.waitForTimeout(300);

    const after = await readCompositedAtDoc(page, 100, 100);
    await page.screenshot({ path: 'e2e/screenshots/tint-magenta.png' });

    expect(after.g).toBeLessThan(before.g);
  });

  test('temperature and tint UI sliders are visible in Colors tab', async ({ page }) => {
    const rootGroupId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { rootGroupId: string } };
      };
      return store.getState().document.rootGroupId;
    });
    await page.locator(`[data-layer-id="${rootGroupId}"] button[aria-label*="effects"]`).click();
    await page.waitForTimeout(200);

    const colorsTab = page.locator('role=tab[name="Colors"]');
    if (await colorsTab.isVisible({ timeout: 500 }).catch(() => false)) {
      await colorsTab.click();
      await page.waitForTimeout(100);
    }

    const tempInput = page.locator('[aria-label="Temperature value"]');
    const tintInput = page.locator('[aria-label="Tint value"]');
    await expect(tempInput).toBeVisible();
    await expect(tintInput).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/temperature-tint-ui.png' });
  });
});
