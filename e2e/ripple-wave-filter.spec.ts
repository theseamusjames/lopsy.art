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

function paintVerticalStripes(page: Page) {
  return page.evaluate(() => {
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
    state.pushHistory('Paint');
    const data = state.getOrCreateLayerPixelData(id);
    const W = data.width;
    const H = data.height;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        if (px < W / 2) {
          data.data[idx] = 220;
          data.data[idx + 1] = 50;
          data.data[idx + 2] = 50;
        } else {
          data.data[idx] = 50;
          data.data[idx + 1] = 50;
          data.data[idx + 2] = 220;
        }
        data.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

test.describe('Ripple / Wave Distortion Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('horizontal ripple displaces vertical boundary between two colors', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintVerticalStripes(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforeMid = await readPixel(page, 200, 200);
    expect(beforeMid.b).toBeGreaterThan(180);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ripple-wave-before.png') });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Ripple / Wave...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Ripple / Wave")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const amplitudeLabel = page.locator('text=Amplitude');
    const wavelengthLabel = page.locator('text=Wavelength');
    const directionLabel = page.locator('text=Direction');
    const phaseLabel = page.locator('text=Phase');
    await expect(amplitudeLabel).toBeVisible({ timeout: 2000 });
    await expect(wavelengthLabel).toBeVisible({ timeout: 2000 });
    await expect(directionLabel).toBeVisible({ timeout: 2000 });
    await expect(phaseLabel).toBeVisible({ timeout: 2000 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ripple-wave-ui.png') });

    const sliders = page.locator('input[type="range"]');
    await sliders.nth(0).fill('40');
    await page.waitForTimeout(100);
    await sliders.nth(1).fill('80');
    await page.waitForTimeout(100);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ripple-wave-after.png') });

    const scanResults = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { redInBlue: 0, blueInRed: 0, transparent: 0 };

      let redInBlue = 0;
      let blueInRed = 0;
      let transparent = 0;
      const W = result.width;
      const midX = W / 2;

      for (let y = 0; y < result.height; y++) {
        for (let x = Math.floor(midX - 60); x < Math.floor(midX + 60); x++) {
          const idx = (y * W + x) * 4;
          const r = result.pixels[idx];
          const b = result.pixels[idx + 2];
          const a = result.pixels[idx + 3];

          if (a === 0) {
            transparent++;
            continue;
          }

          if (x >= midX && r > 150 && b < 100) {
            redInBlue++;
          }
          if (x < midX && b > 150 && r < 100) {
            blueInRed++;
          }
        }
      }

      return { redInBlue, blueInRed, transparent };
    });

    expect(scanResults.redInBlue + scanResults.blueInRed + scanResults.transparent).toBeGreaterThan(200);
  });

  test('ripple creates transparent regions at edges with large amplitude', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintVerticalStripes(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforeEdge = await readPixel(page, 5, 200);
    expect(beforeEdge.a).toBe(255);

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Ripple / Wave...');
    await page.waitForTimeout(300);

    const sliders = page.locator('input[type="range"]');
    await sliders.nth(0).fill('80');
    await page.waitForTimeout(100);
    await sliders.nth(1).fill('100');
    await page.waitForTimeout(100);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ripple-wave-large-amplitude.png') });

    const edgeScan = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { transparentEdgePixels: 0 };

      let transparentEdgePixels = 0;
      const W = result.width;
      const H = result.height;

      for (let y = 0; y < H; y++) {
        for (const x of [0, 1, 2, 3, 4, W - 5, W - 4, W - 3, W - 2, W - 1]) {
          const idx = (y * W + x) * 4;
          if (result.pixels[idx + 3] === 0) {
            transparentEdgePixels++;
          }
        }
      }

      return { transparentEdgePixels };
    });

    expect(edgeScan.transparentEdgePixels).toBeGreaterThan(100);
  });

  test('undo restores original pixels after ripple', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await paintVerticalStripes(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    const beforeCenter = await readPixel(page, 100, 100);

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Ripple / Wave...');
    await page.waitForTimeout(300);

    const sliders = page.locator('input[type="range"]');
    await sliders.nth(0).fill('50');
    await page.waitForTimeout(100);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      };
      store.getState().undo();
    });
    await page.waitForTimeout(500);

    const afterUndo = await readPixel(page, 100, 100);
    expect(afterUndo.r).toBe(beforeCenter.r);
    expect(afterUndo.g).toBe(beforeCenter.g);
    expect(afterUndo.b).toBe(beforeCenter.b);
    expect(afterUndo.a).toBe(beforeCenter.a);
  });
});
