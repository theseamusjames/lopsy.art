import { test, expect, type Page } from './fixtures';
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
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
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

test.describe('Chromatic Aberration Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies chromatic aberration and splits RGB channels at edges', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a pattern with sharp color boundaries: a bright white rectangle
    // on a black background. Chromatic aberration will create visible
    // red/blue fringing at the left and right edges of the white region.
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
      // Black background
      for (let i = 0; i < W * H * 4; i += 4) {
        data.data[i] = 0;
        data.data[i + 1] = 0;
        data.data[i + 2] = 0;
        data.data[i + 3] = 255;
      }
      // White rectangle in the center
      for (let py = 75; py < 225; py++) {
        for (let px = 100; px < 300; px++) {
          const idx = (py * W + px) * 4;
          data.data[idx] = 255;
          data.data[idx + 1] = 255;
          data.data[idx + 2] = 255;
          data.data[idx + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    await fitToView(page);
    await page.waitForTimeout(300);

    // Read pixels before filter — at the right edge of the white rectangle,
    // the pixel should be pure white
    const beforeEdge = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      // Sample at (300, 150) — right edge of white rect
      const idx = (150 * result.width + 300) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    });

    // Right at edge boundary: this pixel is the first black pixel outside
    expect(beforeEdge.r).toBe(0);
    expect(beforeEdge.g).toBe(0);
    expect(beforeEdge.b).toBe(0);

    // Take screenshot before filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'chromatic-aberration-before.png') });

    // Open Filter menu and click Chromatic Aberration
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Chromatic Aberration...');
    await page.waitForTimeout(300);

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Chromatic Aberration")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Verify both controls are present
    const amountLabel = page.locator('text=Amount');
    const directionLabel = page.locator('text=Direction');
    await expect(amountLabel).toBeVisible({ timeout: 2000 });
    await expect(directionLabel).toBeVisible({ timeout: 2000 });

    // Set amount to a strong value (20px) for clear visibility
    const amountSlider = page.locator('input[type="range"]').first();
    await amountSlider.fill('20');
    await page.waitForTimeout(200);

    // Click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Take screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'chromatic-aberration-after.png') });

    // Read pixels after filter — at the right edge, the R channel should
    // have shifted right (red fringing visible outside white rect) while
    // B channel shifted left (blue fringing inside white rect)
    const afterEdge = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      // Sample at (300, 150) — was black before, should now have red
      // channel bleeding from the white rect shifting right
      const idx = (150 * result.width + 300) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    });

    // After chromatic aberration at direction=0, the R channel reads from
    // v_uv + offset (further right = black), while B reads from v_uv - offset
    // (further left = inside white rect). So the right edge gets BLUE fringing.
    expect(afterEdge.r).toBe(0);
    expect(afterEdge.g).toBe(0);
    expect(afterEdge.b).toBeGreaterThan(200);

    // Also verify that inside the white rect, pixels remain mostly white
    // in the center (all channels still overlap at center)
    const afterCenter = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      // Center of white rect: (200, 150)
      const idx = (150 * result.width + 200) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    });

    // Center should still be white — all channels overlap
    expect(afterCenter.r).toBe(255);
    expect(afterCenter.g).toBe(255);
    expect(afterCenter.b).toBe(255);

    // Verify left edge has blue fringing (B shifted left = blue outside)
    const afterLeftEdge = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      // Pixel at (99, 150) — just outside left edge of white rect
      const idx = (150 * result.width + 99) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    });

    // Left edge: R channel reads from v_uv + offset (further right = inside
    // white rect), so pixel (99, 150) picks up RED from the white rect.
    expect(afterLeftEdge.r).toBeGreaterThan(200);
    expect(afterLeftEdge.g).toBe(0);
    expect(afterLeftEdge.b).toBe(0);
  });

  test('chromatic aberration filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a simple pattern
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
        data.data[i] = 200;
        data.data[i + 1] = 100;
        data.data[i + 2] = 50;
        data.data[i + 3] = 255;
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    // Read a pixel before filter
    const before = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (100 * result.width + 100) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    });

    // Apply filter via menu
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Chromatic Aberration...');
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);

    // Read the same pixel — should match the original
    const afterUndo = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (100 * result.width + 100) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    });

    expect(afterUndo.r).toBe(before.r);
    expect(afterUndo.g).toBe(before.g);
    expect(afterUndo.b).toBe(before.b);
  });
});
