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

async function readPixelAt(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ px, py }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (py * result.width + px) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { px: x, py: y },
  );
}

test.describe('Pixel Stretch Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies pixel stretch and displaces horizontal bands with RGB split', async ({ page }) => {
    await createDocument(page, 400, 300, false);

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
      for (let py = 50; py < 250; py++) {
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

    const beforePixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return [];
      return Array.from(result.pixels);
    });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixel-stretch-before.png') });

    await page.click('text=Filter');
    await page.waitForTimeout(200);
    const menuItem = page.locator('[role="menuitem"]:has-text("Pixel Stretch")');
    await menuItem.scrollIntoViewIfNeeded();
    await menuItem.click();
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Pixel Stretch")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    const amountLabel = page.locator('text=Amount');
    const bandsLabel = page.locator('text=Bands');
    const seedLabel = page.locator('text=Seed');
    const rgbSplitLabel = page.locator('text=RGB Split');
    await expect(amountLabel).toBeVisible({ timeout: 2000 });
    await expect(bandsLabel).toBeVisible({ timeout: 2000 });
    await expect(seedLabel).toBeVisible({ timeout: 2000 });
    await expect(rgbSplitLabel).toBeVisible({ timeout: 2000 });

    const sliders = page.locator('input[type="range"]');
    await sliders.nth(0).fill('80');
    await page.waitForTimeout(100);
    await sliders.nth(1).fill('15');
    await page.waitForTimeout(100);
    await sliders.nth(3).fill('0.8');
    await page.waitForTimeout(200);

    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixel-stretch-after.png') });

    const afterPixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
      const result = await readFn();
      if (!result || result.width === 0) return [];
      return Array.from(result.pixels);
    });

    let changedPixels = 0;
    for (let i = 0; i < beforePixels.length; i += 4) {
      const dr = Math.abs(beforePixels[i] - afterPixels[i]);
      const dg = Math.abs(beforePixels[i + 1] - afterPixels[i + 1]);
      const db = Math.abs(beforePixels[i + 2] - afterPixels[i + 2]);
      if (dr > 10 || dg > 10 || db > 10) changedPixels++;
    }
    expect(changedPixels).toBeGreaterThan(500);

    let rgbDiffPixels = 0;
    for (let i = 0; i < afterPixels.length; i += 4) {
      const r = afterPixels[i];
      const g = afterPixels[i + 1];
      const b = afterPixels[i + 2];
      const a = afterPixels[i + 3];
      if (a === 0) continue;
      if (Math.abs(r - g) > 30 || Math.abs(r - b) > 30 || Math.abs(g - b) > 30) {
        rgbDiffPixels++;
      }
    }
    expect(rgbDiffPixels).toBeGreaterThan(100);

    const centerPixel = await readPixelAt(page, 200, 150);
    expect(centerPixel.a).toBe(255);
  });
});
