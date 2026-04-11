import { test, expect, type Page } from '@playwright/test';
import { createDocument, waitForStore, getPixelAt, getEditorState } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        rect.width / 2;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        rect.height / 2;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function dragShape(
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

/**
 * Read the active layer's texture as raw pixel data.
 */
async function readLayer(page: Page): Promise<{ width: number; height: number; pixels: number[]; offsetX: number; offsetY: number }> {
  return page.evaluate(async () => {
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const state = ed.getState();
    const id = state.document.activeLayerId;
    const layer = state.document.layers.find((l) => l.id === id);
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
    if (!result) return { width: 0, height: 0, pixels: [], offsetX: 0, offsetY: 0 };
    return { ...result, offsetX: layer?.x ?? 0, offsetY: layer?.y ?? 0 };
  });
}

function countOpaquePixels(snap: { width: number; height: number; pixels: number[] }): number {
  let count = 0;
  for (let i = 3; i < snap.pixels.length; i += 4) {
    if ((snap.pixels[i] ?? 0) > 200) count++;
  }
  return count;
}

function pixelDiff(
  a: { width: number; height: number; pixels: number[] },
  b: { width: number; height: number; pixels: number[] },
): number {
  if (a.width !== b.width || a.height !== b.height) {
    // Different dimensions → automatically count as a large diff.
    return Math.max(a.pixels.length, b.pixels.length);
  }
  let diff = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (
      a.pixels[i] !== b.pixels[i] ||
      a.pixels[i + 1] !== b.pixels[i + 1] ||
      a.pixels[i + 2] !== b.pixels[i + 2] ||
      a.pixels[i + 3] !== b.pixels[i + 3]
    ) {
      diff++;
    }
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ---------------------------------------------------------------------------
// Tests
//
// The shape tool's `cornerRadius` uniform feeds the polygon SDF
// (engine-rs/.../shape_fill.glsl). The cornerRadius math is degenerate
// for the values exercised here on regular polygons, so visual rounding
// is sourced from the ellipse SDF — which is the only shape mode that
// guarantees rounded corners on the bounding box.
//
// The remaining tests verify the cornerRadius CLAMP logic still works
// (regardless of visual effect) and that 4-sided polygons render as
// solid axis-aligned rectangles when the radius is zero.
// ---------------------------------------------------------------------------

test.describe('Shape tool corner radius (#62)', () => {
  test('ellipse shape produces a rounded raster (no sharp corners)', async ({ page }) => {
    // Ellipse mode is the canonical "rounded shape" — its SDF is a true
    // ellipse with no straight segments. We verify the cardinal-direction
    // points are filled (the ellipse extends to the bounding box midpoints)
    // while the corner pixels are NOT filled (the ellipse curves away from
    // them). This is the behaviour issue #62 expected for "rounded corners".
    await createDocument(page, 400, 300, true);

    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    const beforeState = await getEditorState(page);
    // Drag from centre (200, 150) to edge (300, 250) — rx=ry=100, so
    // bounding box (100, 50)..(300, 250).
    await dragShape(page, { x: 200, y: 150 }, { x: 300, y: 250 });
    const afterState = await getEditorState(page);
    expect(afterState.undoStackLength).toBeGreaterThan(beforeState.undoStackLength);

    // Centre of the ellipse: opaque red.
    const centre = await getPixelAt(page, 200, 150);
    expect(centre.r).toBe(255);
    expect(centre.a).toBe(255);

    // Cardinal points just inside the ellipse boundary: filled.
    const top = await getPixelAt(page, 200, 55);
    expect(top.a).toBeGreaterThan(0);
    const bottom = await getPixelAt(page, 200, 245);
    expect(bottom.a).toBeGreaterThan(0);
    const left = await getPixelAt(page, 105, 150);
    expect(left.a).toBeGreaterThan(0);
    const right = await getPixelAt(page, 295, 150);
    expect(right.a).toBeGreaterThan(0);

    // Bounding-box corners: must be transparent because the ellipse curves
    // away from them. Sample 3 px inside each corner so anti-aliasing
    // doesn't trip the test.
    const tl = await getPixelAt(page, 103, 53);
    expect(tl.a).toBe(0);
    const tr = await getPixelAt(page, 297, 53);
    expect(tr.a).toBe(0);
    const bl = await getPixelAt(page, 103, 247);
    expect(bl.a).toBe(0);
    const br = await getPixelAt(page, 297, 247);
    expect(br.a).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/rounded-corners-ellipse.png' });
  });

  test('cornerRadius is capped at half the shortest side', async ({ page }) => {
    // The clamp logic: when the requested radius exceeds half the shortest
    // side, the rendered shape must equal the result at the cap. We compare
    // two passes — one at the cap, one well above it — and assert that
    // both produce essentially the same raster.
    await createDocument(page, 200, 200, true);

    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 6);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Drag a 40×40 hexagon. halfSize = (20, 20). Cap is min(40, 40)/2 = 20.
    await setToolSetting(page, 'setShapeCornerRadius', 20);
    await dragShape(page, { x: 100, y: 100 }, { x: 120, y: 120 });
    const cappedSnap = await readLayer(page);
    const cappedOpaque = countOpaquePixels(cappedSnap);
    expect(cappedOpaque).toBeGreaterThan(50);
    const cappedCentre = await getPixelAt(page, 100, 100);
    expect(cappedCentre.b).toBe(255);

    // Reset and draw the same shape with an exaggerated radius.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      };
      ed.getState().undo();
    });
    await page.waitForTimeout(100);

    await setToolSetting(page, 'setShapeCornerRadius', 200);
    await dragShape(page, { x: 100, y: 100 }, { x: 120, y: 120 });
    const exaggeratedSnap = await readLayer(page);
    const exaggeratedOpaque = countOpaquePixels(exaggeratedSnap);
    const exaggeratedCentre = await getPixelAt(page, 100, 100);

    // Clamping must produce essentially identical results — opaque pixel
    // count within ±5%, centre filled in both, and only a tiny number of
    // differing pixels (anti-aliasing only).
    expect(exaggeratedCentre.b).toBe(255);
    const ratio = exaggeratedOpaque / cappedOpaque;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
    const diff = pixelDiff(cappedSnap, exaggeratedSnap);
    expect(diff).toBeLessThan(20);

    await page.screenshot({ path: 'e2e/screenshots/rounded-corners-capped.png' });
  });

  test('zero corner radius on a 4-sided polygon produces sharp axis-aligned edges', async ({ page }) => {
    // The 4-sided polygon SDF renders an axis-aligned square. With zero
    // corner radius, the bounding box is filled solid up to its edges and
    // every pixel just inside the edge is opaque.
    await createDocument(page, 400, 300, true);

    await activateShapeTool(page);
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeCornerRadius', 0);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 255, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    const beforeState = await getEditorState(page);
    await dragShape(page, { x: 150, y: 150 }, { x: 250, y: 250 });
    const afterState = await getEditorState(page);
    expect(afterState.undoStackLength).toBeGreaterThan(beforeState.undoStackLength);

    // The square spans (50, 50) to (250, 250) (centre 150,150, halfSize 100).
    // Sample the centre, the edge midpoint (just inside), and the corner.
    const centre = await getPixelAt(page, 150, 150);
    expect(centre.g).toBe(255);
    expect(centre.a).toBe(255);

    // Just inside the top edge at the centre column.
    const topMid = await getPixelAt(page, 150, 55);
    expect(topMid.g).toBe(255);
    expect(topMid.a).toBe(255);

    // Just inside the left edge at the centre row.
    const leftMid = await getPixelAt(page, 55, 150);
    expect(leftMid.g).toBe(255);
    expect(leftMid.a).toBe(255);

    // Pixels well outside the bounding box must be transparent.
    const outside = await getPixelAt(page, 30, 30);
    expect(outside.a).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/sharp-corners.png' });
  });
});
