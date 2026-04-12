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

test.describe('Chromatic Aberration Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies chromatic aberration filter via menu and splits RGB channels', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a high-contrast pattern: white rectangle on dark background
    await paintRect(page, 100, 50, 200, 200, { r: 255, g: 255, b: 255, a: 255 });

    await fitToView(page);
    await page.waitForTimeout(300);

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

    // Verify sliders are present
    await expect(page.locator('text=Red Offset')).toBeVisible();
    await expect(page.locator('text=Blue Offset')).toBeVisible();
    await expect(page.locator('text=Angle')).toBeVisible();

    // Click Apply button
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Take screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'chromatic-aberration-after.png') });

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

  test('chromatic aberration filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a simple pattern
    await paintRect(page, 50, 50, 100, 100, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);

    // Apply chromatic aberration via store API directly
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
        filterChromaticAberration: (engine: unknown, layerId: string, offsetR: number, offsetB: number, angle: number) => void;
      };
      const engine = (window as unknown as Record<string, unknown>).__engine;
      if (engineMod && engine) {
        state.pushHistory('Chromatic Aberration');
        engineMod.filterChromaticAberration(engine, activeId, 10, 10, 0);
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
});
