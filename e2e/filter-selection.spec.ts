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

async function createRectSelection(page: Page, x: number, y: number, w: number, h: number) {
  await page.evaluate(
    ({ x, y, w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            maskWidth: number,
            maskHeight: number,
          ) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const docW = state.document.width;
      const docH = state.document.height;
      const mask = new Uint8ClampedArray(docW * docH);
      for (let py = y; py < y + h && py < docH; py++) {
        for (let px = x; px < x + w && px < docW; px++) {
          if (px >= 0 && py >= 0) {
            mask[py * docW + px] = 255;
          }
        }
      }
      state.setSelection({ x, y, width: w, height: h }, mask, docW, docH);
      state.notifyRender();
    },
    { x, y, w, h },
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

/** Apply a filter via the wasm bridge and clear JS pixel caches. */
async function applyFilter(
  page: Page,
  filterFn: string,
  args: unknown[] = [],
) {
  await page.evaluate(
    ({ filterFn, args }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
          layerPixelData: Map<string, unknown>;
          sparseLayerData: Map<string, unknown>;
          dirtyLayerIds: Set<string>;
        };
        setState: (partial: Record<string, unknown>) => void;
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      };
      const wasmBridge = (window as unknown as Record<string, unknown>).__wasmBridge as Record<string, (...a: unknown[]) => void>;
      const engine = engineState?.getEngine();
      if (!wasmBridge || !engine) return;

      state.pushHistory(filterFn);
      wasmBridge[filterFn](engine, activeId, ...args);

      // Clear JS pixel caches so reads go to GPU
      const pixelDataMap = new Map(state.layerPixelData);
      pixelDataMap.delete(activeId);
      const sparseMap = new Map(state.sparseLayerData);
      sparseMap.delete(activeId);
      const dirtyIds = new Set(state.dirtyLayerIds);
      dirtyIds.add(activeId);
      store.setState({ layerPixelData: pixelDataMap, sparseLayerData: sparseMap, dirtyLayerIds: dirtyIds });
      state.notifyRender();
    },
    { filterFn, args },
  );
  await page.waitForTimeout(500);
}

test.describe('Filter + Selection Mask (Issue #138)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('invert filter only affects selected area', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await createRectSelection(page, 0, 0, 100, 200);
    await fitToView(page);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'filter-selection-before.png') });

    await applyFilter(page, 'filterInvert');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'filter-selection-after.png') });

    // Inside selection (x=50): red inverted → cyan
    const insidePixel = await getPixelAt(page, 50, 100);
    expect(insidePixel.r).toBeLessThan(50);
    expect(insidePixel.g).toBeGreaterThan(200);
    expect(insidePixel.b).toBeGreaterThan(200);

    // Outside selection (x=150): still red
    const outsidePixel = await getPixelAt(page, 150, 100);
    expect(outsidePixel.r).toBeGreaterThan(200);
    expect(outsidePixel.g).toBeLessThan(50);
    expect(outsidePixel.b).toBeLessThan(50);
  });

  test('pixelate filter respects selection mask', async ({ page }) => {
    await createDocument(page, 200, 200, false);
    await paintRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0, a: 255 });
    await paintRect(page, 100, 0, 100, 200, { r: 0, g: 0, b: 255, a: 255 });
    await createRectSelection(page, 0, 0, 100, 200);
    await fitToView(page);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixelate-selection-before.png') });

    await applyFilter(page, 'filterPixelate', [16]);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixelate-selection-after.png') });

    // Outside selection (right half): still pure blue
    const outsidePixel = await getPixelAt(page, 150, 100);
    expect(outsidePixel.r).toBeLessThan(10);
    expect(outsidePixel.b).toBeGreaterThan(200);
  });
});
