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
  // Wait for render cycle to sync selection mask to GPU
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

test.describe('Filter + Selection Mask (Issue #138)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('invert filter only affects selected area', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint the entire layer red
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });

    // Create a selection on the left half only (0,0 to 100,200)
    await createRectSelection(page, 0, 0, 100, 200);
    await fitToView(page);
    await page.waitForTimeout(300);

    // Screenshot before filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'filter-selection-before.png') });

    // Apply invert via the normal action path (handles history + JS cache clearing)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
          dirtyLayerIds: Set<string>;
        };
        setState: (partial: Record<string, unknown>) => void;
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        remove: (id: string) => void;
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      };
      const wasmBridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        filterInvert: (engine: unknown, layerId: string) => void;
      };
      const engine = engineState?.getEngine();
      if (wasmBridge && engine) {
        state.pushHistory('Invert');
        wasmBridge.filterInvert(engine, activeId);
        pixelData.remove(activeId);
        const dirtyIds = new Set(state.dirtyLayerIds);
        dirtyIds.add(activeId);
        store.setState({ dirtyLayerIds: dirtyIds });
        state.notifyRender();
      }
    });
    await page.waitForTimeout(500);

    // Screenshot after filter
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'filter-selection-after.png') });

    // Check: pixel inside selection (x=50) should be inverted (cyan: ~0,255,255)
    const insidePixel = await getPixelAt(page, 50, 100);
    // Check: pixel outside selection (x=150) should still be red
    const outsidePixel = await getPixelAt(page, 150, 100);

    // Inside selection: red inverted = cyan (0, 255, 255)
    expect(insidePixel.r).toBeLessThan(50);
    expect(insidePixel.g).toBeGreaterThan(200);
    expect(insidePixel.b).toBeGreaterThan(200);

    // Outside selection: should remain red
    expect(outsidePixel.r).toBeGreaterThan(200);
    expect(outsidePixel.g).toBeLessThan(50);
    expect(outsidePixel.b).toBeLessThan(50);
  });

  test('pixelate filter respects selection mask', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint a pattern: left half red, right half blue
    await paintRect(page, 0, 0, 100, 200, { r: 255, g: 0, b: 0, a: 255 });
    await paintRect(page, 100, 0, 100, 200, { r: 0, g: 0, b: 255, a: 255 });

    // Select only the left half
    await createRectSelection(page, 0, 0, 100, 200);
    await fitToView(page);
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixelate-selection-before.png') });

    // Apply pixelate to the selected area via store API
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
          dirtyLayerIds: Set<string>;
        };
        setState: (partial: Record<string, unknown>) => void;
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        remove: (id: string) => void;
      };
      const state = store.getState();
      const activeId = state.document.activeLayerId;
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      };
      const wasmBridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        filterPixelate: (engine: unknown, layerId: string, blockSize: number) => void;
      };
      const engine = engineState?.getEngine();
      if (wasmBridge && engine) {
        state.pushHistory('Pixelate');
        wasmBridge.filterPixelate(engine, activeId, 16);
        pixelData.remove(activeId);
        const dirtyIds = new Set(state.dirtyLayerIds);
        dirtyIds.add(activeId);
        store.setState({ dirtyLayerIds: dirtyIds });
        state.notifyRender();
      }
    });
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixelate-selection-after.png') });

    // Outside the selection (right half) should still be pure blue
    const outsidePixel = await getPixelAt(page, 150, 100);
    expect(outsidePixel.r).toBeLessThan(10);
    expect(outsidePixel.b).toBeGreaterThan(200);
  });
});

test.describe('Filter Preview Checkbox (Issue #139)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('preview checkbox appears and toggles in filter dialog', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint content so filter has something to work with
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);

    // Screenshot before opening dialog
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-before.png') });

    // Open Filter > Pixelate dialog
    await page.click('text=Filter');
    await page.waitForTimeout(200);
    await page.click('text=Pixelate...');
    await page.waitForTimeout(300);

    // The dialog should be visible
    const dialogHeading = page.locator('h2:has-text("Pixelate")');
    await expect(dialogHeading).toBeVisible({ timeout: 3000 });

    // The preview checkbox should exist
    const previewCheckbox = page.locator('input[type="checkbox"]');
    await expect(previewCheckbox).toBeVisible();

    // Initially unchecked
    await expect(previewCheckbox).not.toBeChecked();

    // Check the preview checkbox
    await previewCheckbox.check();
    await expect(previewCheckbox).toBeChecked();

    // Wait for debounced preview to apply
    await page.waitForTimeout(500);

    // Screenshot with preview active
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-active.png') });

    // Click Apply
    await page.locator('button:has-text("Apply")').click();
    await page.waitForTimeout(500);

    // Screenshot after applying
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-applied.png') });

    // Verify the dialog is closed
    await expect(dialogHeading).not.toBeVisible();
  });

  test('preview cancel restores original image', async ({ page }) => {
    await createDocument(page, 200, 200, false);

    // Paint solid red
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);

    // Read a pixel before filter
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

    // Cancel the dialog
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(500);

    // Screenshot after cancel
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'preview-cancelled.png') });

    // The pixel should be restored to original red
    const afterPixel = await getPixelAt(page, 100, 100);
    expect(afterPixel.r).toBe(beforePixel.r);
    expect(afterPixel.g).toBe(beforePixel.g);
    expect(afterPixel.b).toBe(beforePixel.b);
  });
});
