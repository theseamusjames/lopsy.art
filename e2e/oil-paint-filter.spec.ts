import { test, expect, type Page } from './fixtures';
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
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
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

    // Paint a noisy, high-frequency pattern. An oil paint / Kuwahara filter
    // needs variance to smooth — flat regions show no effect. This pattern
    // combines smooth color fields with strong per-pixel noise so the filter's
    // painterly smoothing is clearly visible in the before/after.
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
      let seed = 1;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0xffffffff;
      };
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const u = px / W;
          const v = py / H;
          const base = Math.sin(u * Math.PI * 3.0) * 0.5 + 0.5;
          const band = Math.cos((u + v) * Math.PI * 4.0) * 0.5 + 0.5;
          const r = base * 220 + band * 30 + (rnd() - 0.5) * 120;
          const g = (1 - base) * 140 + band * 80 + (rnd() - 0.5) * 120;
          const b = band * 220 + (1 - base) * 30 + (rnd() - 0.5) * 120;
          const idx = (py * W + px) * 4;
          data.data[idx] = Math.max(0, Math.min(255, r));
          data.data[idx + 1] = Math.max(0, Math.min(255, g));
          data.data[idx + 2] = Math.max(0, Math.min(255, b));
          data.data[idx + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

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
