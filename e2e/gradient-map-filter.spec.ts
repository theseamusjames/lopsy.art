import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForTimeout(500);
}

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

test.describe('Gradient Map Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies gradient map and remaps luminance to sepia tones', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a gradient from black to white horizontally so that the
    // gradient map has a full range of luminance values to remap.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      state.pushHistory('Paint');
      const data = state.getOrCreateLayerPixelData(id);
      const W = data.width;
      const H = data.height;
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const idx = (py * W + px) * 4;
          const v = Math.round((px / (W - 1)) * 255);
          data.data[idx] = v;
          data.data[idx + 1] = v;
          data.data[idx + 2] = v;
          data.data[idx + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixel at left edge (dark) and right edge (bright) before filter
    const beforeLeft = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (150 * result.width + 10) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    const beforeRight = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (150 * result.width + 390) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    // Before: left should be nearly black, right should be nearly white
    expect(beforeLeft.r).toBeLessThan(20);
    expect(beforeLeft.g).toBeLessThan(20);
    expect(beforeLeft.b).toBeLessThan(20);
    expect(beforeRight.r).toBeGreaterThan(240);
    expect(beforeRight.g).toBeGreaterThan(240);
    expect(beforeRight.b).toBeGreaterThan(240);

    // Take screenshot before filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'gradient-map-before.png') });

    // Open Filter menu and click Gradient Map
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Gradient Map...');
    await page.waitForTimeout(300);

    // The Gradient Map dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Gradient Map")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Verify preset grid is visible — look for "Sepia" preset button
    const sepiaPreset = page.locator('button[title="Sepia"]');
    await expect(sepiaPreset).toBeVisible({ timeout: 2000 });

    // Sepia is already selected (index 0), just click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Take screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'gradient-map-after.png') });

    // Read pixels after filter — the sepia gradient maps dark to brown and
    // bright to cream. The key check is that the channels are no longer equal
    // (R > G > B for sepia tones).
    const afterLeft = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (150 * result.width + 10) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    const afterRight = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (150 * result.width + 390) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    const afterMid = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (150 * result.width + 200) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    // Left edge (dark region): sepia dark is brownish (R > G > B)
    // Sepia stop 0 is {r: 0.12, g: 0.07, b: 0.03} → approx {30, 18, 8}
    expect(afterLeft.r).toBeGreaterThan(afterLeft.g);
    expect(afterLeft.g).toBeGreaterThan(afterLeft.b);

    // Right edge (bright region): sepia bright is cream (R > G > B)
    // Sepia stop 1.0 is {r: 1.0, g: 0.95, b: 0.85} → approx {255, 242, 217}
    expect(afterRight.r).toBeGreaterThan(240);
    expect(afterRight.g).toBeGreaterThan(220);
    expect(afterRight.b).toBeGreaterThan(200);
    expect(afterRight.r).toBeGreaterThan(afterRight.b);

    // Middle: sepia midtone is warm brown
    // Sepia stop 0.5 is {r: 0.65, g: 0.45, b: 0.25} → approx {166, 115, 64}
    expect(afterMid.r).toBeGreaterThan(afterMid.g);
    expect(afterMid.g).toBeGreaterThan(afterMid.b);
    expect(afterMid.r).toBeGreaterThan(100);
    expect(afterMid.b).toBeLessThan(150);

    // The result is clearly NOT grayscale — channels differ
    expect(afterMid.r - afterMid.b).toBeGreaterThan(30);
  });

  test('gradient map filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a uniform gray
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      state.pushHistory('Paint');
      const data = state.getOrCreateLayerPixelData(id);
      for (let i = 0; i < data.width * data.height * 4; i += 4) {
        data.data[i] = 128;
        data.data[i + 1] = 128;
        data.data[i + 2] = 128;
        data.data[i + 3] = 255;
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    // Read center pixel before filter
    const before = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (100 * result.width + 100) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    expect(before.r).toBe(128);
    expect(before.g).toBe(128);
    expect(before.b).toBe(128);

    // Apply gradient map
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Gradient Map...');
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Read again — should match original
    const afterUndo = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (100 * result.width + 100) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    });

    expect(afterUndo.r).toBe(before.r);
    expect(afterUndo.g).toBe(before.g);
    expect(afterUndo.b).toBe(before.b);
  });
});
