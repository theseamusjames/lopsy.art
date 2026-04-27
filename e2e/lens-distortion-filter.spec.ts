import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 400, transparent = false) {
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

async function readPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ px, py }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (py * result.width + px) * 4;
      return {
        r: result.pixels[idx],
        g: result.pixels[idx + 1],
        b: result.pixels[idx + 2],
        a: result.pixels[idx + 3],
      };
    },
    { px: x, py: y },
  );
}

function paintSolidColor(page: Page, r: number, g: number, b: number) {
  return page.evaluate(
    ({ cr, cg, cb }) => {
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
        data.data[i] = cr;
        data.data[i + 1] = cg;
        data.data[i + 2] = cb;
        data.data[i + 3] = 255;
      }
      state.updateLayerPixelData(id, data);
    },
    { cr: r, cg: g, cb: b },
  );
}

test.describe('Lens Distortion Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('barrel distortion displaces corner pixels while preserving center', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintSolidColor(page, 200, 50, 50);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforeCenter = await readPixel(page, 200, 200);
    const beforeCorner = await readPixel(page, 5, 5);

    expect(beforeCenter.r).toBe(200);
    expect(beforeCenter.a).toBe(255);
    expect(beforeCorner.r).toBe(200);
    expect(beforeCorner.a).toBe(255);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'lens-distortion-before.png') });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Lens Distortion...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Lens Distortion")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const strengthLabel = page.locator('text=Strength');
    const zoomLabel = page.locator('text=Zoom');
    const fringingLabel = page.locator('text=Chromatic Fringing');
    await expect(strengthLabel).toBeVisible({ timeout: 2000 });
    await expect(zoomLabel).toBeVisible({ timeout: 2000 });
    await expect(fringingLabel).toBeVisible({ timeout: 2000 });

    // Set strength to 100 (strong barrel distortion)
    const strengthSlider = page.locator('input[type="range"]').first();
    await strengthSlider.fill('100');
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'lens-distortion-after.png') });

    // Center stays intact — barrel distortion has zero displacement at center
    const afterCenter = await readPixel(page, 200, 200);
    expect(afterCenter.r).toBe(200);
    expect(afterCenter.g).toBe(50);
    expect(afterCenter.b).toBe(50);
    expect(afterCenter.a).toBe(255);

    // Corner becomes transparent — barrel distortion maps corner pixels
    // to input coordinates beyond texture bounds (k=1, r²≈0.475 at corner)
    const afterCorner = await readPixel(page, 5, 5);
    expect(afterCorner.a).toBe(0);
  });

  test('chromatic fringing separates RGB channels at edges', async ({ page }) => {
    await createDocument(page, 400, 400, true);

    // Paint a white rectangle in the center on a black surround
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
      for (let i = 0; i < W * H * 4; i += 4) {
        data.data[i] = 0;
        data.data[i + 1] = 0;
        data.data[i + 2] = 0;
        data.data[i + 3] = 255;
      }
      for (let py = 100; py < 300; py++) {
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

    // Verify center of white rect is white before filter
    const beforeWhiteCenter = await readPixel(page, 200, 200);
    expect(beforeWhiteCenter.r).toBe(255);
    expect(beforeWhiteCenter.g).toBe(255);
    expect(beforeWhiteCenter.b).toBe(255);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'lens-distortion-fringing-before.png') });

    // Apply lens distortion with moderate barrel + strong fringing
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Lens Distortion...');
    await page.waitForTimeout(300);

    const sliders = page.locator('input[type="range"]');
    // Strength = 50 (moderate barrel)
    await sliders.nth(0).fill('50');
    await page.waitForTimeout(100);
    // Zoom = 100 (default)
    // Fringing = 100 (maximum)
    await sliders.nth(2).fill('100');
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'lens-distortion-fringing-after.png') });

    // Center of white rect should remain white — all channels overlap at center
    const afterWhiteCenter = await readPixel(page, 200, 200);
    expect(afterWhiteCenter.r).toBe(255);
    expect(afterWhiteCenter.g).toBe(255);
    expect(afterWhiteCenter.b).toBe(255);

    // At the white/black boundary, chromatic fringing causes R, G, B channels
    // to sample from slightly different positions. Read several pixels along
    // the right edge of the white rectangle to find color separation.
    const edgePixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return [];
      const pixels: { x: number; r: number; g: number; b: number; a: number }[] = [];
      const y = 200;
      for (let x = 280; x <= 320; x++) {
        const idx = (y * result.width + x) * 4;
        pixels.push({
          x,
          r: result.pixels[idx],
          g: result.pixels[idx + 1],
          b: result.pixels[idx + 2],
          a: result.pixels[idx + 3],
        });
      }
      return pixels;
    });

    // Somewhere along the edge, the channels should differ — this proves
    // chromatic fringing is working (R, G, B are distorted at different rates)
    const hasColorSeparation = edgePixels.some(
      (p) => p.a > 0 && (Math.abs(p.r - p.g) > 20 || Math.abs(p.g - p.b) > 20),
    );
    expect(hasColorSeparation).toBe(true);
  });
});
