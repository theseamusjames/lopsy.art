import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  paintCircle,
  paintRect,
  getEditorState,
  addLayer,
  withEditorStore,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulates what handleMoveDown does: expand → crop → move by delta.
 * This mirrors the real move tool behavior (crop to content first).
 */
async function moveLayerContent(
  page: Page,
  layerId: string,
  dx: number,
  dy: number,
): Promise<void> {
  await page.evaluate(
    ({ id, dx, dy }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
          pushHistory: (label?: string) => void;
          expandLayerForEditing: (id: string) => ImageData;
          cropLayerToContent: (id: string) => void;
          updateLayerPosition: (id: string, x: number, y: number) => void;
        };
      };
      const state = store.getState();
      state.pushHistory('Move');
      state.expandLayerForEditing(id);
      state.cropLayerToContent(id);
      const layer = store.getState().document.layers.find((l) => l.id === id);
      state.updateLayerPosition(id, (layer?.x ?? 0) + dx, (layer?.y ?? 0) + dy);
    },
    { id: layerId, dx, dy },
  );
}

/**
 * Get pixel from the expanded (editing) buffer, accounting for layer offset.
 */
async function getPixelAtCanvasPos(
  page: Page,
  canvasX: number,
  canvasY: number,
  layerId: string,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    ({ x, y, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
          expandLayerForEditing: (id: string) => ImageData;
        };
      };
      const state = store.getState();
      const data = state.expandLayerForEditing(lid);
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const bx = x - lx;
      const by = y - ly;
      if (bx < 0 || bx >= data.width || by < 0 || by >= data.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (by * data.width + bx) * 4;
      return {
        r: data.data[idx] ?? 0,
        g: data.data[idx + 1] ?? 0,
        b: data.data[idx + 2] ?? 0,
        a: data.data[idx + 3] ?? 0,
      };
    },
    { x: canvasX, y: canvasY, lid: layerId },
  );
}

/**
 * Simulates what handleMoveDown does at mousedown: expand → crop.
 * Does NOT move the layer — this is just the "click to start drag" step.
 */
async function simulateMoveMouseDown(
  page: Page,
  layerId: string,
): Promise<void> {
  await page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (label?: string) => void;
          expandLayerForEditing: (id: string) => ImageData;
          cropLayerToContent: (id: string) => void;
        };
      };
      const state = store.getState();
      state.pushHistory('Move');
      state.expandLayerForEditing(lid);
      state.cropLayerToContent(lid);
    },
    layerId,
  );
}

/**
 * Get the layer's current position and dimensions from the store.
 */
async function getLayerBounds(
  page: Page,
  layerId: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
        };
      };
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      return { x: layer?.x ?? 0, y: layer?.y ?? 0, width: layer?.width ?? 0, height: layer?.height ?? 0 };
    },
    layerId,
  );
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function drawStroke(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
  steps = 10,
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(
    ({ setter, value }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => Record<string, (v: unknown) => void>;
      };
      store.getState()[setter]!(value);
    },
    { setter, value },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

test.describe('Move Layer — content only', () => {
  test('moving a layer does not move transparent pixels', async ({ page }) => {
    // 400×300 transparent document
    await createDocument(page, 400, 300, true);
    await addLayer(page);
    // Wait for the GPU engine to sync the new layer
    await page.waitForTimeout(200);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Paint a circle in the center (radius 50)
    await paintCircle(page, 200, 150, 50, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    // Move the layer 100px south-east (simulating the move tool)
    await moveLayerContent(page, layerId, 100, 100);

    // After move, the layer should only cover the circle's content bounds
    // shifted by (100, 100). The rest of the canvas should be accessible
    // for painting.
    const layerAfter = await withEditorStore(page, (s) => {
      const doc = s.document as { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
      return doc.layers.find((l) => l.id === (s.document as { activeLayerId: string }).activeLayerId);
    });

    // The layer's position should reflect the moved content bounds, not the
    // full canvas
    expect(layerAfter!.x).toBeGreaterThan(0);
    expect(layerAfter!.y).toBeGreaterThan(0);
    // Content dimensions should be roughly the circle's bounding box, not the canvas
    expect(layerAfter!.width).toBeLessThan(400);
    expect(layerAfter!.height).toBeLessThan(300);

    // Expanding the layer for editing should still give us access to the
    // full canvas area — verify we can read/write at (5, 5) which is far
    // from the moved circle
    const topLeftPixel = await getPixelAtCanvasPos(page, 5, 5, layerId);
    expect(topLeftPixel.a).toBe(0); // transparent — no content here

    // The circle should be at its new position (~300, ~250)
    const circlePixel = await getPixelAtCanvasPos(page, 300, 250, layerId);
    expect(circlePixel.r).toBe(255);
    expect(circlePixel.a).toBe(255);
  });

  test('content moved off-canvas is preserved', async ({ page }) => {
    // 400×300 transparent document
    await createDocument(page, 400, 300, true);
    await addLayer(page);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Paint a circle near the right edge
    await paintCircle(page, 350, 150, 40, { r: 0, g: 255, b: 0, a: 255 }, layerId);

    // Move 100px right — pushes part of the circle off-canvas
    await moveLayerContent(page, layerId, 100, 0);

    // Expand for editing — the buffer should be larger than the canvas
    // to preserve off-canvas content
    const bufferInfo = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
          expandLayerForEditing: (id: string) => ImageData;
        };
      };
      const state = store.getState();
      const data = state.expandLayerForEditing(lid);
      const layer = store.getState().document.layers.find((l) => l.id === lid);
      return {
        bufferWidth: data.width,
        bufferHeight: data.height,
        layerX: layer?.x ?? 0,
        layerY: layer?.y ?? 0,
        docWidth: state.document.width,
      };
    }, layerId);

    // The buffer should extend beyond the canvas width to preserve the
    // off-canvas portion of the circle
    expect(bufferInfo.bufferWidth).toBeGreaterThan(bufferInfo.docWidth);

    // Read a pixel that's off-canvas (at canvas x=430, within the circle)
    const offCanvasPixel = await getPixelAtCanvasPos(page, 450, 150, layerId);
    expect(offCanvasPixel.g).toBe(255);
    expect(offCanvasPixel.a).toBe(255);

    // Now move it back on-canvas and verify content is intact
    await moveLayerContent(page, layerId, -100, 0);
    const restoredPixel = await getPixelAtCanvasPos(page, 350, 150, layerId);
    expect(restoredPixel.g).toBe(255);
    expect(restoredPixel.a).toBe(255);
  });

  test('mousedown with move tool does not snap off-canvas content back', async ({ page }) => {
    // 400×300 transparent document
    await createDocument(page, 400, 300, true);
    await addLayer(page);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Paint a 100×100 square in the center
    await paintRect(page, 150, 100, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    // Move the square so only 1×1 px is visible at the top-left corner.
    // Content bounds after crop are roughly (150,100)–(249,199).
    // We want the bottom-right pixel at canvas (0,0), so shift by
    // -(249, 199) = (-249, -199).  That puts content origin at (-249,-199)
    // and the last pixel at (0, 0).
    // Use a delta that puts the bottom-right corner at (0,0):
    //   newX = 150 + dx => dx such that newX + 99 = 0 => newX = -99 => dx = -249
    //   newY = 100 + dy => dy such that newY + 99 = 0 => newY = -99 => dy = -199
    await moveLayerContent(page, layerId, -249, -199);

    const boundsAfterMove = await getLayerBounds(page, layerId);
    // Content should be mostly off-canvas
    expect(boundsAfterMove.x).toBeLessThan(0);
    expect(boundsAfterMove.y).toBeLessThan(0);

    const posBeforeClick = { x: boundsAfterMove.x, y: boundsAfterMove.y };

    // Simulate a move-tool mousedown (expand → crop) without dragging.
    // BUG: this used to snap the content back on-canvas because
    // sparse offsets were stale.
    await simulateMoveMouseDown(page, layerId);

    const boundsAfterClick = await getLayerBounds(page, layerId);

    // The layer position should be unchanged — content must NOT snap back
    expect(boundsAfterClick.x).toBe(posBeforeClick.x);
    expect(boundsAfterClick.y).toBe(posBeforeClick.y);
    expect(boundsAfterClick.width).toBe(boundsAfterMove.width);
    expect(boundsAfterClick.height).toBe(boundsAfterMove.height);
  });

  test('GPU-painted brush content does not snap back on move mousedown', async ({ page }) => {
    // 400×300 transparent document
    await createDocument(page, 400, 300, true);
    await addLayer(page);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Draw a spiral-like shape in the center using the brush tool (GPU path).
    // This is the critical difference from the paintRect test: brush strokes
    // live on the GPU, so JS has no pixel data until readback.
    await page.keyboard.press('b');
    await setToolSetting(page, 'setBrushSize', 10);
    await setToolSetting(page, 'setBrushOpacity', 100);
    await drawStroke(page, { x: 200, y: 100 }, { x: 250, y: 150 }, 15);
    await drawStroke(page, { x: 250, y: 150 }, { x: 200, y: 200 }, 15);
    await drawStroke(page, { x: 200, y: 200 }, { x: 150, y: 150 }, 15);
    await drawStroke(page, { x: 150, y: 150 }, { x: 200, y: 130 }, 15);

    // Move the brush content mostly off-canvas via the store (simulating
    // the move tool's expand → crop → reposition flow).
    await moveLayerContent(page, layerId, -350, -250);

    const boundsAfterMove = await getLayerBounds(page, layerId);
    // Content should be mostly off-canvas
    expect(boundsAfterMove.x).toBeLessThan(0);
    expect(boundsAfterMove.y).toBeLessThan(0);

    const posBeforeClick = { x: boundsAfterMove.x, y: boundsAfterMove.y };

    // Simulate a second move-tool mousedown (expand → crop). With GPU-
    // painted content, the expand reads from GPU or sparse/dense cache.
    // BUG: content snapped back on-canvas because the expand used stale
    // sparse offsets or failed to preserve off-canvas data.
    await simulateMoveMouseDown(page, layerId);

    const boundsAfterClick = await getLayerBounds(page, layerId);

    // The layer position must NOT change — content stays off-canvas
    expect(boundsAfterClick.x).toBe(posBeforeClick.x);
    expect(boundsAfterClick.y).toBe(posBeforeClick.y);
    expect(boundsAfterClick.width).toBe(boundsAfterMove.width);
    expect(boundsAfterClick.height).toBe(boundsAfterMove.height);
  });

  test('brush click after move does not snap layer back', async ({ page }) => {
    // Exact user scenario: draw spiral → move to bottom-right → brush click
    await createDocument(page, 400, 300, true);
    await addLayer(page);

    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // 1. Draw a square with the brush tool (GPU path)
    await page.keyboard.press('b');
    await setToolSetting(page, 'setBrushSize', 8);
    await setToolSetting(page, 'setBrushOpacity', 100);
    await drawStroke(page, { x: 150, y: 100 }, { x: 250, y: 100 }, 15);
    await drawStroke(page, { x: 250, y: 100 }, { x: 250, y: 200 }, 15);
    await drawStroke(page, { x: 250, y: 200 }, { x: 150, y: 200 }, 15);
    await drawStroke(page, { x: 150, y: 200 }, { x: 150, y: 130 }, 15);

    // 2. Move the content to the bottom-right via the move tool
    await moveLayerContent(page, layerId, 100, 50);
    await page.waitForTimeout(100);

    const boundsAfterMove = await getLayerBounds(page, layerId);
    expect(boundsAfterMove.x).toBeGreaterThan(100);
    expect(boundsAfterMove.y).toBeGreaterThan(50);

    // 3. Switch to brush and click to draw a dot.
    //    This triggers beginStroke → ensure_layer_full_size on the GPU.
    //    BUG: ensure_layer_full_size used to discard the cropped texture
    //    and reset position to (0,0), causing content to jump.
    await page.keyboard.press('b');
    await page.waitForTimeout(50);

    const clickPos = await docToScreen(page, 380, 280);
    await page.mouse.click(clickPos.x, clickPos.y);
    await page.waitForTimeout(200);

    // After the brush click, expand the layer to get pixel data and check
    // that the original content is still at its moved position (not at origin).
    const result = await page.evaluate(
      ({ lid, movedX, movedY }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            expandLayerForEditing: (id: string) => ImageData;
            document: { layers: Array<{ id: string; x: number; y: number }> };
          };
        };
        const st = store.getState();
        const data = st.expandLayerForEditing(lid);
        const layer = store.getState().document.layers.find((l) => l.id === lid);
        const lx = layer?.x ?? 0;
        const ly = layer?.y ?? 0;

        // Check for opaque pixels near the moved content center
        const cx = movedX - lx;
        const cy = movedY - ly;
        let movedCount = 0;
        for (let dy = -15; dy <= 15; dy++) {
          for (let dx = -15; dx <= 15; dx++) {
            const px = cx + dx;
            const py = cy + dy;
            if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
            if ((data.data[(py * data.width + px) * 4 + 3] ?? 0) > 0) movedCount++;
          }
        }

        // Check for opaque pixels near the origin (where content should NOT be)
        const ox = 10 - lx;
        const oy = 10 - ly;
        let originCount = 0;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const px = ox + dx;
            const py = oy + dy;
            if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
            if ((data.data[(py * data.width + px) * 4 + 3] ?? 0) > 0) originCount++;
          }
        }

        return { movedCount, originCount, lx, ly, w: data.width, h: data.height };
      },
      {
        lid: layerId,
        movedX: Math.round(boundsAfterMove.x + boundsAfterMove.width / 2),
        movedY: Math.round(boundsAfterMove.y + 4),
      },
    );

    // Content must be at the moved position, NOT at the origin
    expect(result.movedCount).toBeGreaterThan(0);
    expect(result.originCount).toBe(0);
  });
});
