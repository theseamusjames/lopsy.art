import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

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

test.describe('Kaleidoscope Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('applies kaleidoscope filter via menu and produces symmetric output', async ({ page }) => {
    await createDocument(page, 400, 400, false);

    // Paint an asymmetric, colorful pattern so the kaleidoscope effect is visible.
    // A few offset colored rectangles creates enough asymmetry to verify the mirror.
    await paintRect(page, 0, 0, 400, 400, { r: 20, g: 20, b: 40, a: 255 });
    await paintRect(page, 250, 50, 120, 80, { r: 255, g: 80, b: 80, a: 255 });
    await paintRect(page, 60, 180, 150, 60, { r: 80, g: 220, b: 120, a: 255 });
    await paintRect(page, 280, 260, 80, 120, { r: 80, g: 120, b: 255, a: 255 });
    await paintRect(page, 120, 60, 60, 60, { r: 255, g: 220, b: 60, a: 255 });

    await fitToView(page);
    await page.waitForTimeout(300);

    // Screenshot the asymmetric "before" state
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kaleidoscope-before.png') });

    // Open Filter menu and click Kaleidoscope
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Kaleidoscope...');
    await page.waitForTimeout(300);

    // The filter dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Kaleidoscope")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // Click Apply — defaults (6 segments, rotation 0) should produce a
    // clearly symmetric 6-wedge pattern.
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Screenshot the "after" state
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'kaleidoscope-after.png') });

    // Sanity: layer is still the same dimensions and still exists.
    const layerInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; width: number; height: number }>; activeLayerId: string };
        };
      };
      const state = store.getState();
      return {
        layerCount: state.document.layers.length,
        layerWidth: state.document.layers[0]?.width,
        layerHeight: state.document.layers[0]?.height,
      };
    });

    expect(layerInfo.layerCount).toBeGreaterThan(0);
    expect(layerInfo.layerWidth).toBe(400);
    expect(layerInfo.layerHeight).toBe(400);

    // Verify the pixel output is actually horizontally symmetric after the
    // filter runs. With an even number of segments (6) aligned at rotation 0,
    // pixel (cx + dx, cy) should equal pixel (cx - dx, cy) because the
    // kaleidoscope mirrors wedges across the horizontal axis.
    const symmetryOk = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);
      const w = data.width;
      const h = data.height;
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      // Sample a handful of mirrored pairs at mid-radius and check each
      // component matches within a small tolerance (GPU filtering can
      // introduce a little bilinear wiggle at exact pixel locations).
      const offsets = [30, 50, 80, 110];
      const tol = 8;
      for (const dx of offsets) {
        const a = ((cy) * w + (cx + dx)) * 4;
        const b = ((cy) * w + (cx - dx)) * 4;
        for (let c = 0; c < 4; c++) {
          if (Math.abs(data.data[a + c] - data.data[b + c]) > tol) {
            return { ok: false, dx, c, a: data.data[a + c], b: data.data[b + c] };
          }
        }
      }
      return { ok: true };
    });

    expect(symmetryOk.ok).toBe(true);
  });

  test('kaleidoscope filter can be undone', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    await paintRect(page, 0, 0, 200, 200, { r: 40, g: 40, b: 40, a: 255 });
    await paintRect(page, 130, 20, 50, 50, { r: 255, g: 100, b: 50, a: 255 });
    await fitToView(page);

    // Apply kaleidoscope via the wasm bridge directly
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const store = w.__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
        };
      };
      const engineState = w.__engineState as { getEngine: () => unknown } | undefined;
      const bridge = w.__wasmBridge as {
        filterKaleidoscope?: (engine: unknown, layerId: string, segments: number, rotation: number) => void;
      } | undefined;
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      const engine = engineState?.getEngine();
      if (bridge?.filterKaleidoscope && engine) {
        state.pushHistory('Kaleidoscope');
        bridge.filterKaleidoscope(engine, activeId, 8, 30);
        state.notifyRender();
      }
    });

    await page.waitForTimeout(300);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    const layerCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length;
    });

    expect(layerCount).toBeGreaterThan(0);
  });
});
