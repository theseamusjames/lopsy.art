import { test, expect } from './fixtures';
import {
  waitForStore,
  createDocument,
  getEditorState,
  getPixelAt,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  docToScreen,
  undo,
  selectTool,
  setToolOption,
} from './helpers';

/**
 * Regression test for an undo bug: after undoing a radial-symmetry brush
 * stroke, a non-target layer (the "fill" layer) jumps position down and
 * to the right.
 *
 * Repro: create a document with multiple layers, paint on each, enable
 * radial symmetry, draw on the top layer, undo → verify all other layers
 * retain their content positions.
 */
test.describe('Undo does not shift non-target layer positions', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);
    await page.waitForTimeout(500);
  });

  async function drawStroke(
    page: import('./fixtures').Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 15,
  ) {
    const start = await docToScreen(page, from.x, from.y);
    const end = await docToScreen(page, to.x, to.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  async function readLayerContentBounds(page: import('./fixtures').Page, layerId: string) {
    return page.evaluate(async (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (label: string) => void;
          document: { layers: Array<{ id: string; x: number; y: number }> };
        };
      };
      // pushHistory finalizes pending strokes so __readLayerPixels returns current data
      store.getState().pushHistory('flush');

      const readPixels = (window as unknown as Record<string, unknown>).__readLayerPixels as
        | ((id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>)
        | undefined;
      if (!readPixels) return null;
      const r = await readPixels(lid);
      if (!r || r.width === 0) return null;

      const layer = store.getState().document.layers.find((l) => l.id === lid);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;

      let minX = r.width;
      let minY = r.height;
      let maxX = -1;
      let maxY = -1;
      let opaqueCount = 0;
      let redCount = 0;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          const idx = (y * r.width + x) * 4;
          const a = r.pixels[idx + 3] ?? 0;
          if (a > 10) {
            opaqueCount++;
            const rr = r.pixels[idx] ?? 0;
            const gg = r.pixels[idx + 1] ?? 0;
            if (rr > 128 && gg < 64) redCount++;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      return {
        layerX: lx,
        layerY: ly,
        texWidth: r.width,
        texHeight: r.height,
        contentMinX: minX,
        contentMinY: minY,
        contentMaxX: maxX,
        contentMaxY: maxY,
        opaqueCount,
        redCount,
      };
    }, layerId);
  }

  test('fill layer position stable after undoing radial symmetry stroke', async ({ page }) => {
    // Get initial layer IDs (Background + Layer 1 from createDocument with white bg)
    let state = await getEditorState(page);
    const drawLayerId = state.document.activeLayerId;

    // Step 1: Draw a black circle-ish area with brush on the default draw layer
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 40);
    await setForegroundColor(page, 0, 0, 0);
    await page.waitForTimeout(200);
    await drawStroke(page, { x: 200, y: 160 }, { x: 200, y: 240 }, 20);
    await drawStroke(page, { x: 160, y: 200 }, { x: 240, y: 200 }, 20);
    await page.waitForTimeout(200);

    // Step 2: Add a new layer (goes above the active layer)
    const fillLayerId = await addLayer(page);

    // Step 3: Select the fill layer, set red, and paint a big area
    await setActiveLayer(page, fillLayerId);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 80);
    await setForegroundColor(page, 255, 0, 0);
    await page.waitForTimeout(200);

    // Paint a large red area under the circle
    await drawStroke(page, { x: 100, y: 100 }, { x: 300, y: 100 }, 15);
    await drawStroke(page, { x: 100, y: 150 }, { x: 300, y: 150 }, 15);
    await drawStroke(page, { x: 100, y: 200 }, { x: 300, y: 200 }, 15);
    await drawStroke(page, { x: 100, y: 250 }, { x: 300, y: 250 }, 15);
    await drawStroke(page, { x: 100, y: 300 }, { x: 300, y: 300 }, 15);
    await page.waitForTimeout(200);

    // Step 4: Add a new layer at the top
    const topLayerId = await addLayer(page);
    await setActiveLayer(page, topLayerId);
    await page.waitForTimeout(200);

    // Capture fill layer content bounds BEFORE the radial symmetry stroke
    const beforeBounds = await readLayerContentBounds(page, fillLayerId);
    expect(beforeBounds).not.toBeNull();
    expect(beforeBounds!.opaqueCount).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/undo-layer-position-before.png' });

    // Step 5: Enable radial symmetry and draw on the top layer
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 15);
    await setForegroundColor(page, 0, 0, 255);
    await page.waitForTimeout(200);

    // Enable radial symmetry via tool settings store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryRadialSegments: (v: number) => void;
        };
      };
      store.getState().setSymmetryRadialSegments(8);
    });
    await page.waitForTimeout(100);

    // Draw a big stroke from center outward (radial symmetry creates 8 copies)
    await drawStroke(page, { x: 200, y: 200 }, { x: 380, y: 200 }, 25);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/undo-layer-position-with-spiral.png' });

    // Step 6: Undo the radial symmetry stroke
    await undo(page);
    await page.waitForTimeout(500);

    // Step 7: Verify the fill layer content hasn't shifted
    const afterBounds = await readLayerContentBounds(page, fillLayerId);
    expect(afterBounds).not.toBeNull();

    await page.screenshot({ path: 'e2e/screenshots/undo-layer-position-after-undo.png' });

    // The fill layer's document-space position should not have changed
    expect(afterBounds!.layerX).toBe(beforeBounds!.layerX);
    expect(afterBounds!.layerY).toBe(beforeBounds!.layerY);

    // The texture dimensions should be the same
    expect(afterBounds!.texWidth).toBe(beforeBounds!.texWidth);
    expect(afterBounds!.texHeight).toBe(beforeBounds!.texHeight);

    // The content bounds within the texture should be the same
    expect(afterBounds!.contentMinX).toBe(beforeBounds!.contentMinX);
    expect(afterBounds!.contentMinY).toBe(beforeBounds!.contentMinY);
    expect(afterBounds!.contentMaxX).toBe(beforeBounds!.contentMaxX);
    expect(afterBounds!.contentMaxY).toBe(beforeBounds!.contentMaxY);

    // Opaque pixel count should be approximately the same (allow small tolerance for GPU precision)
    expect(afterBounds!.opaqueCount).toBeGreaterThan(beforeBounds!.opaqueCount * 0.95);
    expect(afterBounds!.opaqueCount).toBeLessThan(beforeBounds!.opaqueCount * 1.05);

    // Verify there's still red content
    expect(afterBounds!.redCount).toBeGreaterThan(0);

    // Also verify individual pixel positions haven't changed
    const centerBefore = await getPixelAt(page, 200, 200, fillLayerId);
    expect(centerBefore.a).toBeGreaterThan(0);
    expect(centerBefore.r).toBeGreaterThan(128);
  });
});
