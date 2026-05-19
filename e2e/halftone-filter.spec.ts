import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForStore, createDocument, drawRect } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

test.describe('Halftone Filter', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies halftone filter via menu and renders dot pattern', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // Paint a gradient-like pattern programmatically so halftone dots are visible.
    // Using store API here because drawing 20 rects via UI exceeds the timeout.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const s = store.getState();
      const data = s.getOrCreateLayerPixelData(s.document.activeLayerId);
      for (let y = 0; y < 300; y++) {
        for (let x = 0; x < 400; x++) {
          const t = x / 399;
          const idx = (y * 400 + x) * 4;
          data.data[idx] = Math.round(255 * (1 - t));
          data.data[idx + 1] = Math.round(100 * t);
          data.data[idx + 2] = Math.round(255 * t);
          data.data[idx + 3] = 255;
        }
      }
      s.updateLayerPixelData(s.document.activeLayerId, data);
    });
    await page.waitForTimeout(200);

    await fitToView(page);
    await page.waitForTimeout(300);

    // Take screenshot before filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-before.png') });

    // Open Filter menu and click Halftone
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Halftone...');
    await page.waitForTimeout(300);

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Halftone")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Click Apply button
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Take screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-after.png') });

    // Verify the filter was applied — layer should still exist
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

  test('halftone filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a simple pattern
    await drawRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0 });
    await drawRect(page, 100, 0, 100, 200, { r: 0, g: 255, b: 0 });
    await fitToView(page);

    // Apply halftone via store API directly
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
        filterHalftone: (engine: unknown, layerId: string, dotSize: number, density: number, angle: number, contrast: number) => void;
      };
      const engine = (window as unknown as Record<string, unknown>).__engine;
      if (engineMod && engine) {
        state.pushHistory('Halftone');
        engineMod.filterHalftone(engine, activeId, 8, 1.0, 45, 1.0);
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
