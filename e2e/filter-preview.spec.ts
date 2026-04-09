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

async function paintRect(
  page: Page,
  x: number, y: number, w: number, h: number,
  color: { r: number; g: number; b: number; a: number },
) {
  await page.evaluate(
    ({ x, y, w, h, color }) => {
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
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
          const idx = (py * data.width + px) * 4;
          data.data[idx] = color.r;
          data.data[idx + 1] = color.g;
          data.data[idx + 2] = color.b;
          data.data[idx + 3] = color.a;
        }
      }
      state.updateLayerPixelData(id, data);
    },
    { x, y, w, h, color },
  );
  await page.waitForTimeout(200);
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

async function getPixelAt(
  page: Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            layers: Array<{ id: string; x: number; y: number }>;
          };
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const layer = state.document.layers.find((l) => l.id === id);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const localX = x - lx;
      const localY = y - ly;
      if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (localY * result.width + localX) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { x, y },
  );
}

test.describe('Filter Preview Checkbox (Issue #139)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('preview checkbox appears and toggles in filter dialog', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-before.png') });

    // Open Filter > Pixelate dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Pixelate...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Pixelate")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Preview checkbox should exist and be unchecked initially
    const previewCheckbox = page.locator('input[type="checkbox"]');
    await expect(previewCheckbox).toBeVisible();
    await expect(previewCheckbox).not.toBeChecked();

    // Toggle preview on
    await previewCheckbox.check();
    await expect(previewCheckbox).toBeChecked();

    // Wait for debounced preview to apply
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-active.png') });

    // Click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-applied.png') });

    // Dialog should close
    await expect(dialogHeading).not.toBeVisible();
  });

  test('preview cancel restores original image', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);

    const beforePixel = await getPixelAt(page, 100, 100);

    // Open Filter > Brightness/Contrast dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Brightness/Contrast...');
    await page.waitForTimeout(300);

    const dialogHeading = page.locator('h2:has-text("Brightness")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Enable preview
    const previewCheckbox = page.locator('input[type="checkbox"]');
    await previewCheckbox.check();
    await page.waitForTimeout(500);

    // Cancel
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-cancelled.png') });

    // Pixel should be restored to original
    const afterPixel = await getPixelAt(page, 100, 100);
    expect(afterPixel.r).toBe(beforePixel.r);
    expect(afterPixel.g).toBe(beforePixel.g);
    expect(afterPixel.b).toBe(beforePixel.b);
  });
});
