import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, getPixelAt, drawRect, setActiveLayer, getEditorState } from './helpers';

test.describe('Pattern Fill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('define pattern and fill a layer with tiled pattern', async ({ page }) => {
    // Create a small 100x100 transparent document
    await createDocument(page, 100, 100, true);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Paint a distinctive 4-quadrant pattern:
    // Top-left: red, Top-right: green, Bottom-left: blue, Bottom-right: yellow
    await page.evaluate(
      ({ lid }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { activeLayerId: string; width: number; height: number; layers: Array<{ id: string; width: number; height: number }> };
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const s = store.getState();
        s.pushHistory('Paint Pattern');
        const data = new ImageData(100, 100);
        for (let y = 0; y < 100; y++) {
          for (let x = 0; x < 100; x++) {
            const idx = (y * 100 + x) * 4;
            if (x < 50 && y < 50) {
              // Red
              data.data[idx] = 255; data.data[idx + 1] = 0; data.data[idx + 2] = 0; data.data[idx + 3] = 255;
            } else if (x >= 50 && y < 50) {
              // Green
              data.data[idx] = 0; data.data[idx + 1] = 255; data.data[idx + 2] = 0; data.data[idx + 3] = 255;
            } else if (x < 50 && y >= 50) {
              // Blue
              data.data[idx] = 0; data.data[idx + 1] = 0; data.data[idx + 2] = 255; data.data[idx + 3] = 255;
            } else {
              // Yellow
              data.data[idx] = 255; data.data[idx + 1] = 255; data.data[idx + 2] = 0; data.data[idx + 3] = 255;
            }
          }
        }
        s.updateLayerPixelData(lid, data);
      },
      { lid: layerId },
    );

    // Take before screenshot — shows 4 colored quadrants
    await page.screenshot({ path: 'e2e/screenshots/pattern-fill-before.png' });

    // Define pattern from the current layer via the Edit menu
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Define Pattern")');

    // Verify pattern was defined
    const patternCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__patternStore as {
        getState: () => { patterns: Array<{ id: string; width: number; height: number }> };
      };
      return store.getState().patterns.length;
    });
    expect(patternCount).toBe(1);

    // Create a new larger document (200x200) to fill with the pattern
    await createDocument(page, 200, 200, true);

    // Fill the new layer with white first so we have something to see tiling against
    const newState = await getEditorState(page);
    const newLayerId = newState.document.activeLayerId;
    await setActiveLayer(page, newLayerId);
    await drawRect(page, 0, 0, 200, 200, { r: 255, g: 255, b: 255 });

    // Apply pattern fill via WASM bridge directly (programmatic, not via dialog)
    await page.evaluate(async () => {
      const patternStore = (window as unknown as Record<string, unknown>).__patternStore as {
        getState: () => { patterns: Array<{ id: string; data: Uint8Array; width: number; height: number }> };
      };
      const editorStore = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          pushHistory: (label?: string) => void;
          notifyRender: () => void;
        };
      };

      const patterns = patternStore.getState().patterns;
      const pattern = patterns[0];
      if (!pattern) throw new Error('No pattern defined');

      const state = editorStore.getState();
      const activeId = state.document.activeLayerId;
      if (!activeId) throw new Error('No active layer');

      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      };
      const wasmBridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        filterPatternFill: (engine: unknown, layerId: string, data: Uint8Array, w: number, h: number, scale: number, ox: number, oy: number) => void;
      };

      const engine = engineState.getEngine();
      if (!engine) throw new Error('No engine');

      state.pushHistory('Pattern Fill');
      wasmBridge.filterPatternFill(engine, activeId, pattern.data, pattern.width, pattern.height, 1.0, 0, 0);
      state.notifyRender();
    });

    // Wait a frame for render
    await page.waitForTimeout(200);

    // Take after screenshot — should show a tiled 2x2 repeat of the 4-quadrant pattern
    await page.screenshot({ path: 'e2e/screenshots/pattern-fill-after.png' });

    // Verify tiling: the 100x100 pattern at 100% scale on a 200x200 canvas should tile 2x2
    // Top-left quadrant of tile 1 (0-49, 0-49) should be red
    const topLeftRed = await getPixelAt(page, 25, 25, newLayerId);
    expect(topLeftRed.r).toBeGreaterThan(200);
    expect(topLeftRed.g).toBeLessThan(50);
    expect(topLeftRed.b).toBeLessThan(50);

    // Top-right quadrant of tile 1 (50-99, 0-49) should be green
    const topRightGreen = await getPixelAt(page, 75, 25, newLayerId);
    expect(topRightGreen.r).toBeLessThan(50);
    expect(topRightGreen.g).toBeGreaterThan(200);
    expect(topRightGreen.b).toBeLessThan(50);

    // Second tile starts at x=100 — top-left of tile 2 (100-149, 0-49) should be red again
    const tile2Red = await getPixelAt(page, 125, 25, newLayerId);
    expect(tile2Red.r).toBeGreaterThan(200);
    expect(tile2Red.g).toBeLessThan(50);
    expect(tile2Red.b).toBeLessThan(50);

    // Bottom-left of tile 1 (0-49, 50-99) should be blue
    const bottomLeftBlue = await getPixelAt(page, 25, 75, newLayerId);
    expect(bottomLeftBlue.r).toBeLessThan(50);
    expect(bottomLeftBlue.g).toBeLessThan(50);
    expect(bottomLeftBlue.b).toBeGreaterThan(200);

    // Bottom-right of tile 2 (150-199, 150-199) should be yellow
    const tile2Yellow = await getPixelAt(page, 175, 175, newLayerId);
    expect(tile2Yellow.r).toBeGreaterThan(200);
    expect(tile2Yellow.g).toBeGreaterThan(200);
    expect(tile2Yellow.b).toBeLessThan(50);
  });

  test('pattern fill dialog shows pattern swatches', async ({ page }) => {
    await createDocument(page, 50, 50, true);

    // Paint a checkerboard pattern source
    const state = await getEditorState(page);
    await page.evaluate(
      ({ lid }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { activeLayerId: string };
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const s = store.getState();
        s.pushHistory('Paint');
        const data = new ImageData(50, 50);
        for (let y = 0; y < 50; y++) {
          for (let x = 0; x < 50; x++) {
            const idx = (y * 50 + x) * 4;
            const isWhite = ((Math.floor(x / 10) + Math.floor(y / 10)) % 2) === 0;
            const v = isWhite ? 255 : 80;
            data.data[idx] = v; data.data[idx + 1] = v; data.data[idx + 2] = v; data.data[idx + 3] = 255;
          }
        }
        s.updateLayerPixelData(lid, data);
      },
      { lid: state.document.activeLayerId },
    );

    // Define pattern
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Define Pattern")');

    // Open Edit > Fill with Pattern... — should show the pattern swatch
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Fill with Pattern")');

    const dialog = page.locator('[role="dialog"][aria-label="Pattern Fill"]');
    await expect(dialog).toBeVisible();

    // Should show pattern swatch (not the empty message)
    const swatch = dialog.locator('button[class*="patternSwatch"]');
    await expect(swatch).toBeVisible();

    // Take screenshot of the dialog with pattern loaded
    await page.screenshot({ path: 'e2e/screenshots/pattern-fill-dialog.png' });

    // Cancel
    await dialog.locator('button:has-text("Cancel")').click();
    await expect(dialog).not.toBeVisible();
  });
});
