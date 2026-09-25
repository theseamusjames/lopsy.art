import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, getPixelAt, drawRect, addLayer, setActiveLayer, getEditorState, docToScreen } from './helpers';

/** Draw a rectangular selection (marquee-rect drag, no fill) at document coordinates. */
async function selectRect(page: Page, docX: number, docY: number, docW: number, docH: number): Promise<void> {
  await page.keyboard.press('m');
  await page.waitForTimeout(100);
  const start = await docToScreen(page, docX, docY);
  const end = await docToScreen(page, docX + docW, docY + docH);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test.describe('Pattern Fill', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
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

  // #848: a layer's GPU texture stays a lazy 1x1 placeholder until it's
  // painted on at least once. Fill with Pattern on such a layer must expand
  // it to full size *before* reading its dimensions for the tile math, or
  // every fragment samples the pattern's top-left texel and the fill comes
  // out as a solid block instead of tiling.
  test('fills a never-painted layer with a tiled pattern, not a solid block', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    // createDocument(transparentBg: false) creates an opaque white
    // "Background" layer plus an empty, transparent "Layer 1" which becomes
    // active — Layer 1's GPU texture is not yet allocated.
    const initial = await getEditorState(page);
    const layer1 = initial.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');

    // Paint a 48x2 black bar onto Layer 1 at (20,20) — this is the source
    // content for the pattern (paints Layer 1 for the first time).
    await drawRect(page, 20, 20, 48, 2, { r: 0, g: 0, b: 0 });

    // Select a 48x7 region (2 black rows + 5 transparent rows) and define it
    // as a pattern.
    await selectRect(page, 20, 20, 48, 7);
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Define Pattern")');
    const patternCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__patternStore as {
        getState: () => { patterns: Array<{ id: string }> };
      };
      return store.getState().patterns.length;
    });
    expect(patternCount).toBe(1);
    await page.keyboard.press('Control+d');

    // Add a brand new, never-painted layer and hide Layer 1 so only the new
    // layer (and the white background) are visible.
    const layer2Id = await addLayer(page);
    await page.locator(`[data-layer-id="${layer1.id}"]`)
      .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
      .click();

    // Select a region on the new layer and fill it with the pattern via the
    // dialog, with "Preview" left unchecked (the default apply path).
    await selectRect(page, 100, 80, 200, 140);
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Fill with Pattern")');
    const dialog = page.locator('[role="dialog"][aria-label="Pattern Fill"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('button:has-text("Apply")').click();
    await expect(dialog).not.toBeVisible();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/pattern-fill-never-painted-after.png' });

    // The pattern tiles vertically with period 7: rows where doc-y % 7 is 0
    // or 1 are opaque black (from the 2-row bar); every other row is fully
    // transparent. Probe several cycles inside the marquee (y in [80, 220)).
    const opaqueRows = [84, 85, 91, 92, 98, 99];
    const transparentRows = [87, 90, 94, 97];
    for (const y of opaqueRows) {
      expect(y % 7).toBeLessThanOrEqual(1);
      const px = await getPixelAt(page, 150, y, layer2Id);
      expect(px.a).toBeGreaterThan(200);
      expect(px.r).toBeLessThan(50);
      expect(px.g).toBeLessThan(50);
      expect(px.b).toBeLessThan(50);
    }
    for (const y of transparentRows) {
      expect(y % 7).toBeGreaterThan(1);
      const px = await getPixelAt(page, 150, y, layer2Id);
      // Under the bug, u_layerSize=(1,1) makes every fragment sample the
      // pattern's first texel (opaque black), so alpha is 255 everywhere.
      expect(px.a).toBeLessThan(50);
    }
  });

  test('fills an already-painted layer with a tiled pattern (control)', async ({ page }) => {
    await createDocument(page, 400, 300, false);

    const initial = await getEditorState(page);
    const layer1 = initial.document.layers.find((l) => l.name === 'Layer 1');
    if (!layer1) throw new Error('Layer 1 not found');

    await drawRect(page, 20, 20, 48, 2, { r: 0, g: 0, b: 0 });
    await selectRect(page, 20, 20, 48, 7);
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Define Pattern")');
    await page.keyboard.press('Control+d');

    // Add a new layer, but this time paint it (full-layer white fill) before
    // filling with the pattern — its GPU texture is already full document
    // size, unlike the never-painted case above.
    const layer2Id = await addLayer(page);
    await page.locator(`[data-layer-id="${layer1.id}"]`)
      .locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]')
      .click();
    await setActiveLayer(page, layer2Id);
    await drawRect(page, 0, 0, 400, 300, { r: 255, g: 255, b: 255 });

    await selectRect(page, 100, 80, 200, 140);
    await page.click('button:has-text("Edit")');
    await page.click('button[role="menuitem"]:has-text("Fill with Pattern")');
    const dialog = page.locator('[role="dialog"][aria-label="Pattern Fill"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('button:has-text("Apply")').click();
    await expect(dialog).not.toBeVisible();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/pattern-fill-already-painted-after.png' });

    const opaqueRows = [84, 85, 91, 92];
    const transparentRows = [87, 90];
    for (const y of opaqueRows) {
      const px = await getPixelAt(page, 150, y, layer2Id);
      expect(px.a).toBeGreaterThan(200);
      expect(px.r).toBeLessThan(50);
      expect(px.g).toBeLessThan(50);
      expect(px.b).toBeLessThan(50);
    }
    for (const y of transparentRows) {
      // The selection mask blend hard-selects the filtered (pattern) result
      // inside the marquee (mix(original, filtered, mask) with mask=1), so
      // the transparent pattern rows come out transparent here too, not the
      // pre-existing white fill showing through.
      const px = await getPixelAt(page, 150, y, layer2Id);
      expect(px.a).toBeLessThan(50);
    }
  });
});
