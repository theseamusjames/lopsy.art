/**
 * E2E tests for the shape tool covering:
 * 1. Corner radius not being applied to polygons (bug)
 * 2. Click-and-drag to draw a shape (broken)
 *
 * All tests use real UI interactions and GPU pixel readback.
 */
import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
  );
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

async function dragShape(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
  steps = 5,
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
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

async function activateShapeTool(page: Page) {
  await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool('shape');
  });
  await page.waitForTimeout(100);
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    async ({ x, y, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
            layers: Array<{ id: string; x: number; y: number }>;
          };
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const layer = state.document.layers.find((l) => l.id === id);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
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
    { x, y, lid: layerId ?? null },
  );
}

/** Count opaque pixels on the active layer via GPU readback. */
async function countOpaquePixels(page: Page, layerId?: string) {
  return page.evaluate(
    async (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
        };
      };
      const id = lid ?? store.getState().document.activeLayerId;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return 0;
      let count = 0;
      for (let i = 3; i < result.pixels.length; i += 4) {
        if ((result.pixels[i] ?? 0) > 0) count++;
      }
      return count;
    },
    layerId ?? null,
  );
}

/** Get document state snapshot. */
async function getDocumentState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{
            id: string;
            name: string;
            type: string;
            visible: boolean;
          }>;
          activeLayerId: string;
        };
      };
    };
    const state = store.getState();
    return {
      width: state.document.width,
      height: state.document.height,
      layers: state.document.layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
      })),
      activeLayerId: state.document.activeLayerId,
    };
  });
}

// ---------------------------------------------------------------------------
// Setup — creates a new document with 2 layers (Background + Layer 1),
// same as the default non-transparent document in the app.
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  // Non-transparent creates Background (white) + Layer 1 (empty) — 2 raster layers + root group
  await createDocument(page, 400, 300, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

// ---------------------------------------------------------------------------
// Tests: Corner Radius
// ---------------------------------------------------------------------------

test.describe('Shape tool corner radius', () => {
  test('polygon with corner radius should have rounded corners (GPU pixel check)', async ({ page }) => {
    // Set up shape tool: polygon, 4 sides, corner radius 30, red fill, no stroke
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeCornerRadius', 30);
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw rectangle: center at (200,150), drag to (300,250)
    // This creates a polygon with ~100px radius in each direction
    // Bounding box approximately (100,50) to (300,250)
    await dragShape(page, { x: 200, y: 150 }, { x: 300, y: 250 });

    await page.screenshot({ path: 'test-results/screenshots/shape-corner-radius.png' });

    // With corner radius 30, the exact corner of the bounding box should be transparent
    // because the corner is rounded off. Check near the top-left corner.
    const cornerPixel = await getPixelAt(page, 101, 51);
    expect(cornerPixel.a).toBe(0);

    // A pixel well inside the shape should be filled with red
    const centerPixel = await getPixelAt(page, 200, 150);
    expect(centerPixel.a).toBeGreaterThan(0);
    expect(centerPixel.r).toBe(255);

    // A pixel along the top edge midpoint should be filled.
    // The 4-sided polygon (rotated 45°) has its edge at cos(PI/4) * 100 ≈ 71px
    // from center, so the top edge midpoint is at y ≈ 150 - 71 = 79.
    const midEdgePixel = await getPixelAt(page, 200, 80);
    expect(midEdgePixel.a).toBeGreaterThan(0);
  });

  test('hexagon with corner radius should have rounded vertices', async ({ page }) => {
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 6);
    await setToolSetting(page, 'setShapeCornerRadius', 20);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw hexagon: center at (200,150), drag to (280,230)
    // rx = 80, ry = 80
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 230 });

    await page.screenshot({ path: 'test-results/screenshots/shape-hexagon-rounded.png' });

    // Center should be filled
    const center = await getPixelAt(page, 200, 150);
    expect(center.a).toBeGreaterThan(0);
    expect(center.b).toBe(255);

    // Flat-top hexagon: vertices sit at (±circumR/2, ±faceR) where faceR=80
    // and circumR=faceR/cos(π/6)≈92.4. So upper-right vertex tip is near
    // (200+46, 150-80)=(246, 70). Corner radius 20 should round that tip,
    // making the extreme-corner pixel transparent.
    const vertexTip = await getPixelAt(page, 246, 71);
    expect(vertexTip.a).toBe(0);
  });

  test('triangle with corner radius should have rounded vertices', async ({ page }) => {
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 3);
    await setToolSetting(page, 'setShapeCornerRadius', 15);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 255, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw triangle: center at (200,150), drag to (280,230)
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 230 });

    await page.screenshot({ path: 'test-results/screenshots/shape-triangle-rounded.png' });

    // Center should be filled
    const center = await getPixelAt(page, 200, 160);
    expect(center.a).toBeGreaterThan(0);
    expect(center.g).toBe(255);

    // The opaque pixel count should be positive
    const opaqueCount = await countOpaquePixels(page);
    expect(opaqueCount).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Tests: Click-and-Drag Shape Drawing
// ---------------------------------------------------------------------------

test.describe('Shape tool click-and-drag', () => {
  test('dragging creates a filled shape on the active layer', async ({ page }) => {
    const docState = await getDocumentState(page);
    // Verify we have a 2-layer document (Background + Layer 1 + root group)
    const rasterLayers = docState.layers.filter((l) => l.type !== 'group');
    expect(rasterLayers).toHaveLength(2);

    // Active layer should be "Layer 1"
    const activeLayer = docState.layers.find((l) => l.id === docState.activeLayerId);
    expect(activeLayer?.name).toBe('Layer 1');

    // Before drawing, the active layer should have no opaque pixels
    const beforeCount = await countOpaquePixels(page);
    expect(beforeCount).toBe(0);

    // Set up shape tool: ellipse, red fill
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw an ellipse from center (200,150) to edge (280,220)
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 220 });

    await page.screenshot({ path: 'test-results/screenshots/shape-drag-ellipse.png' });

    // After drawing, the active layer should have opaque pixels
    const afterCount = await countOpaquePixels(page);
    expect(afterCount).toBeGreaterThan(1000);

    // Center of the ellipse should be filled red
    const center = await getPixelAt(page, 200, 150);
    expect(center.r).toBe(255);
    expect(center.a).toBeGreaterThan(0);

    // Outside the ellipse should be transparent
    const outside = await getPixelAt(page, 10, 10);
    expect(outside.a).toBe(0);
  });

  test('polygon drag does not fill the entire screen', async ({ page }) => {
    // Reproduces: new doc → shape tool → click and drag → whole doc turns
    // black instantly. The first mousemove during any drag typically moves
    // in only one axis (e.g. a few px right, 0px down). The polygon SDF
    // divides p / halfSize — when halfSize.y is 0 this produces NaN that
    // fills every pixel. The handleShapeMove guard `rx < 1 && ry < 1` uses
    // && instead of ||, so it lets through (rx>=1, ry=0). Once the first
    // frame corrupts the layer, subsequent frames render on top and the
    // damage is permanent.
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeCornerRadius', 0);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Simulate a realistic drag where the first mousemove is axis-aligned.
    // In a real browser the mouse often registers horizontal movement before
    // vertical, so the very first frame has height=0.
    const start = await docToScreen(page, 200, 150);
    const mid = await docToScreen(page, 205, 150); // first frame: only X moved
    const end = await docToScreen(page, 280, 230);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y); // renders shape with height=0
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'test-results/screenshots/shape-polygon-no-flood.png' });

    // The shape should only cover a bounded area around the center.
    // All four corners of the document must be transparent.
    const topLeft = await getPixelAt(page, 5, 5);
    const topRight = await getPixelAt(page, 395, 5);
    const bottomLeft = await getPixelAt(page, 5, 295);
    const bottomRight = await getPixelAt(page, 395, 295);

    expect(topLeft.a).toBe(0);
    expect(topRight.a).toBe(0);
    expect(bottomLeft.a).toBe(0);
    expect(bottomRight.a).toBe(0);

    // The center should be filled
    const center = await getPixelAt(page, 200, 150);
    expect(center.a).toBeGreaterThan(0);

    // The opaque area should be bounded — a 160x160 polygon is at most ~25,600 px,
    // far less than the full 400x300 = 120,000 pixel canvas
    const opaqueCount = await countOpaquePixels(page);
    expect(opaqueCount).toBeLessThan(40000);
    expect(opaqueCount).toBeGreaterThan(1000);
  });

  test('horizontal-only drag does not corrupt the layer', async ({ page }) => {
    // When dragging horizontally, ry stays 0 for many frames. This causes
    // division by zero in the polygon SDF shader (p / halfSize where halfSize.y = 0),
    // which can fill the entire texture.
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 6);
    await setToolSetting(page, 'setShapeCornerRadius', 0);
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Drag purely horizontally — height dimension is 0 throughout
    await dragShape(page, { x: 150, y: 150 }, { x: 300, y: 150 }, 10);

    await page.screenshot({ path: 'test-results/screenshots/shape-horizontal-drag.png' });

    // With zero height, either no shape should be drawn or a degenerate thin shape.
    // The entire canvas must NOT be filled — corners should be transparent.
    const topLeft = await getPixelAt(page, 5, 5);
    const bottomRight = await getPixelAt(page, 395, 295);
    expect(topLeft.a).toBe(0);
    expect(bottomRight.a).toBe(0);

    // The total opaque area should be small (thin line at most, or nothing)
    const opaqueCount = await countOpaquePixels(page);
    expect(opaqueCount).toBeLessThan(5000);
  });

  test('semi-transparent shape drag does not accumulate opacity', async ({ page }) => {
    // Each mousemove renders the shape onto the layer texture with blending.
    // Without clearing between frames, semi-transparent fills accumulate
    // to full opacity after a few frames.
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 0.5 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw with many steps to accumulate renders
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 220 }, 15);

    await page.screenshot({ path: 'test-results/screenshots/shape-semitransparent.png' });

    // The center pixel should have ~50% opacity (alpha ~128), not near-100%
    // from accumulated renders. Allow some tolerance for anti-aliasing.
    const center = await getPixelAt(page, 200, 150);
    expect(center.a).toBeGreaterThan(50);
    expect(center.a).toBeLessThan(200);
  });

  test('shape draws on the correct layer in a multi-layer document', async ({ page }) => {
    const docState = await getDocumentState(page);
    const rasterLayers = docState.layers.filter((l) => l.type !== 'group');
    expect(rasterLayers).toHaveLength(2);

    // Background is the other raster layer
    const bgLayer = rasterLayers.find((l) => l.name === 'Background');
    expect(bgLayer).toBeDefined();

    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw on the active layer (Layer 1)
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 220 });

    // Layer 1 should have content
    const layer1Pixels = await countOpaquePixels(page, docState.activeLayerId);
    expect(layer1Pixels).toBeGreaterThan(0);

    // Background layer should be unaffected (should be all white = opaque)
    // Read a pixel from background — it should still be white
    const bgPixel = await getPixelAt(page, 10, 10, bgLayer!.id);
    expect(bgPixel.r).toBe(255);
    expect(bgPixel.g).toBe(255);
    expect(bgPixel.b).toBe(255);
    expect(bgPixel.a).toBe(255);
  });

  test('small drag below threshold does not create a shape', async ({ page }) => {
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Drag only 2 pixels — below the 4px click threshold
    await dragShape(page, { x: 200, y: 150 }, { x: 201, y: 151 });

    await page.screenshot({ path: 'test-results/screenshots/shape-small-drag.png' });

    // No shape should have been committed — the layer should be empty
    // (the click handler undoes the history push for sub-threshold drags)
    const opaqueCount = await countOpaquePixels(page);
    expect(opaqueCount).toBe(0);
  });

  test('shape with stroke only creates visible outline', async ({ page }) => {
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', null);
    await setToolSetting(page, 'setShapeStrokeColor', { r: 0, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setShapeStrokeWidth', 4);

    // Draw an ellipse from center (200,150) to edge (280,220)
    await dragShape(page, { x: 200, y: 150 }, { x: 280, y: 220 });

    await page.screenshot({ path: 'test-results/screenshots/shape-stroke-only.png' });

    // Outer edge of ellipse should have stroke pixels
    const opaqueCount = await countOpaquePixels(page);
    expect(opaqueCount).toBeGreaterThan(100);

    // Center of the ellipse should be empty (no fill)
    const center = await getPixelAt(page, 200, 150);
    expect(center.a).toBe(0);
  });

  test('successive shapes can be drawn without errors', async ({ page }) => {
    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw first shape
    await dragShape(page, { x: 100, y: 100 }, { x: 150, y: 140 });
    const count1 = await countOpaquePixels(page);
    expect(count1).toBeGreaterThan(0);

    // Draw second shape on the same layer
    await dragShape(page, { x: 250, y: 200 }, { x: 320, y: 260 });
    const count2 = await countOpaquePixels(page);
    // Second shape adds more pixels
    expect(count2).toBeGreaterThan(count1);

    await page.screenshot({ path: 'test-results/screenshots/shape-successive.png' });
  });
});
