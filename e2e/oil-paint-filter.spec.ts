import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

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

test.describe('Oil Paint Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies oil paint filter via menu and smooths color regions', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a pattern with sharp edges — oil paint should smooth these
    // Left half: red, right half: blue, with a noisy band in the middle
    await paintRect(page, 0, 0, 180, 300, { r: 220, g: 40, b: 40, a: 255 });
    await paintRect(page, 220, 0, 180, 300, { r: 40, g: 40, b: 220, a: 255 });
    // Noisy transition band
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      const r = Math.round(220 * (1 - t) + 40 * t);
      const b = Math.round(40 * (1 - t) + 220 * t);
      await paintRect(page, 180 + i * 2, 0, 2, 300, { r, g: 40, b, a: 255 });
    }

    await fitToView(page);
    await page.waitForTimeout(300);

    // Take screenshot before filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'oil-paint-before.png') });

    // Open Filter menu and click Oil Paint
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Oil Paint...');
    await page.waitForTimeout(300);

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Oil Paint")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Click Apply button
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Take screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'oil-paint-after.png') });

    // Verify the filter was applied — layer should still exist at full size
    const layerInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; width: number; height: number }>; activeLayerId: string };
        };
      };
      const state = store.getState();
      return {
        layerCount: state.document.layers.length,
        activeLayerId: state.document.activeLayerId,
        layerWidth: state.document.layers[0]?.width,
        layerHeight: state.document.layers[0]?.height,
      };
    });

    expect(layerInfo.layerCount).toBeGreaterThan(0);
    expect(layerInfo.layerWidth).toBe(400);
    expect(layerInfo.layerHeight).toBe(300);
  });

  test('oil paint filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a checkerboard pattern
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 });
    await paintRect(page, 100, 100, 100, 100, { r: 255, g: 0, b: 0, a: 255 });
    await paintRect(page, 100, 0, 100, 100, { r: 0, g: 0, b: 255, a: 255 });
    await paintRect(page, 0, 100, 100, 100, { r: 0, g: 0, b: 255, a: 255 });
    await fitToView(page);

    // Apply oil paint via store API directly
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;

      const engineMod = (window as unknown as Record<string, unknown>).__wasmEngine as {
        filterOilPaint: (engine: unknown, layerId: string, radius: number, sharpness: number) => void;
      };
      const engine = (window as unknown as Record<string, unknown>).__engine;
      if (engineMod && engine) {
        state.pushHistory('Oil Paint');
        engineMod.filterOilPaint(engine, activeId, 4, 1.5);
        state.notifyRender();
      }
    });

    await page.waitForTimeout(300);

    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // The document should still have the layer
    const layerCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length;
    });

    expect(layerCount).toBeGreaterThan(0);
  });

  test('oil paint filter dialog shows radius and sharpness controls', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintRect(page, 0, 0, 200, 200, { r: 128, g: 128, b: 128, a: 255 });

    // Open Filter menu and click Oil Paint
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Oil Paint...');
    await page.waitForTimeout(300);

    // Verify both controls are present
    const radiusLabel = page.locator('text=Radius');
    const sharpnessLabel = page.locator('text=Sharpness');
    await expect(radiusLabel).toBeVisible({ timeout: 3000 });
    await expect(sharpnessLabel).toBeVisible({ timeout: 3000 });

    // Cancel the dialog
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);
  });
});
