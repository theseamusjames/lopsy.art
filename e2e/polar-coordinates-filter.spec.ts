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

async function readAllPixels(page: Page) {
  return page.evaluate(async () => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    return readFn();
  });
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

function paintFourQuadrants(page: Page) {
  return page.evaluate(() => {
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
    state.pushHistory('Paint quadrants');
    const data = state.getOrCreateLayerPixelData(id);
    const W = data.width;
    const H = data.height;
    const halfW = W / 2;
    const halfH = H / 2;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const idx = (py * W + px) * 4;
        if (px < halfW && py < halfH) {
          // Top-left: red
          data.data[idx] = 255; data.data[idx + 1] = 0; data.data[idx + 2] = 0;
        } else if (px >= halfW && py < halfH) {
          // Top-right: green
          data.data[idx] = 0; data.data[idx + 1] = 255; data.data[idx + 2] = 0;
        } else if (px < halfW && py >= halfH) {
          // Bottom-left: blue
          data.data[idx] = 0; data.data[idx + 1] = 0; data.data[idx + 2] = 255;
        } else {
          // Bottom-right: yellow
          data.data[idx] = 255; data.data[idx + 1] = 255; data.data[idx + 2] = 0;
        }
        data.data[idx + 3] = 255;
      }
    }
    state.updateLayerPixelData(id, data);
  });
}

test.describe('Polar Coordinates Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('rectangular to polar mode warps pixel layout', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintFourQuadrants(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    // Verify the four quadrants before the filter
    const beforeTL = await readPixel(page, 100, 100);
    const beforeTR = await readPixel(page, 300, 100);
    const beforeBL = await readPixel(page, 100, 300);
    const beforeBR = await readPixel(page, 300, 300);

    expect(beforeTL.r).toBe(255);
    expect(beforeTL.g).toBe(0);
    expect(beforeTR.g).toBe(255);
    expect(beforeTR.r).toBe(0);
    expect(beforeBL.b).toBe(255);
    expect(beforeBL.r).toBe(0);
    expect(beforeBR.r).toBe(255);
    expect(beforeBR.g).toBe(255);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polar-coordinates-before.png') });

    // Capture full pixel data before filter
    const beforeData = await readAllPixels(page);

    // Apply Polar Coordinates filter (mode=0, Rect to Polar)
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Polar Coordinates...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Polar Coordinates")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Mode slider should default to 0 (Rect to Polar)
    const modeSlider = page.locator('input[type="range"]').first();
    await expect(modeSlider).toBeVisible({ timeout: 2000 });
    await modeSlider.fill('0');
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polar-coordinates-rect-to-polar.png') });

    // After Rect→Polar, the pixel layout should be significantly different.
    // The top row of the source wraps around a full circle, so the center
    // of the output should reflect what was the top-left region of the input.
    const afterData = await readAllPixels(page);

    // Count how many pixels changed by comparing before and after
    let changedPixels = 0;
    const totalPixels = afterData.width * afterData.height;
    for (let i = 0; i < totalPixels * 4; i += 4) {
      const dr = Math.abs(beforeData.pixels[i] - afterData.pixels[i]);
      const dg = Math.abs(beforeData.pixels[i + 1] - afterData.pixels[i + 1]);
      const db = Math.abs(beforeData.pixels[i + 2] - afterData.pixels[i + 2]);
      const da = Math.abs(beforeData.pixels[i + 3] - afterData.pixels[i + 3]);
      if (dr > 10 || dg > 10 || db > 10 || da > 10) {
        changedPixels++;
      }
    }

    // At least 30% of pixels should have changed — polar warp is dramatic
    expect(changedPixels).toBeGreaterThan(totalPixels * 0.3);

    // In Rect→Polar, the bottom half of the image becomes transparent arcs
    // while the top half retains warped color bands. Check a pixel in the
    // upper region where content should still be visible.
    const afterUpper = await readPixel(page, 200, 50);
    expect(afterUpper.a).toBe(255);

    // The bottom-center should now be transparent (the polar mapping
    // creates arch shapes with gaps at the bottom)
    const afterBottomCenter = await readPixel(page, 200, 350);
    expect(afterBottomCenter.a).toBe(0);
  });

  test('polar to rectangular mode produces circular warping', async ({ page }) => {
    await createDocument(page, 400, 400, true);
    await paintFourQuadrants(page);
    await page.waitForTimeout(300);
    await fitToView(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polar-coordinates-p2r-before.png') });

    const beforeData = await readAllPixels(page);

    // Apply Polar Coordinates filter (mode=1, Polar to Rect)
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Polar Coordinates...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Polar Coordinates")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const modeSlider = page.locator('input[type="range"]').first();
    await modeSlider.fill('1');
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polar-coordinates-polar-to-rect.png') });

    const afterData = await readAllPixels(page);

    // Count changed pixels
    let changedPixels = 0;
    const totalPixels = afterData.width * afterData.height;
    for (let i = 0; i < totalPixels * 4; i += 4) {
      const dr = Math.abs(beforeData.pixels[i] - afterData.pixels[i]);
      const dg = Math.abs(beforeData.pixels[i + 1] - afterData.pixels[i + 1]);
      const db = Math.abs(beforeData.pixels[i + 2] - afterData.pixels[i + 2]);
      const da = Math.abs(beforeData.pixels[i + 3] - afterData.pixels[i + 3]);
      if (dr > 10 || dg > 10 || db > 10 || da > 10) {
        changedPixels++;
      }
    }

    // Polar to Rect should also change a significant portion of pixels
    expect(changedPixels).toBeGreaterThan(totalPixels * 0.3);

    // Corners should become transparent in Polar→Rect mode because the
    // circular mapping doesn't reach the corners (radius > 1 maps to transparent)
    const cornerPixel = await readPixel(page, 2, 2);
    expect(cornerPixel.a).toBe(0);
  });
});
