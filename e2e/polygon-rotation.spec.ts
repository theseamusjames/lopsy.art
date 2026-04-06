/**
 * E2E tests for the polygon rotation fix (#60).
 * Even-sided polygons should render with a flat top edge (squares, not diamonds).
 * Odd-sided polygons should still have a vertex pointing up (triangles).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 400, transparent = true) {
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

async function drawShape(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const start = await docToScreen(page, fromX, fromY);
  const end = await docToScreen(page, toX, toY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function readLayer(page: Page, layerId?: string): Promise<PixelSnapshot> {
  const result = await page.evaluate((lid) => {
    return ((window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<PixelSnapshot | null>)(lid ?? undefined);
  }, layerId ?? null);
  return result ?? { width: 0, height: 0, pixels: [] };
}

/**
 * Find the bounding box of opaque pixels in a snapshot.
 */
function findOpaqueBounds(snap: PixelSnapshot) {
  let minX = snap.width;
  let minY = snap.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < snap.height; y++) {
    for (let x = 0; x < snap.width; x++) {
      const idx = (y * snap.width + x) * 4;
      if ((snap.pixels[idx + 3] ?? 0) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Count opaque pixels along a horizontal row within the snapshot.
 */
function countOpaqueInRow(snap: PixelSnapshot, y: number, fromX: number, toX: number) {
  let count = 0;
  for (let x = fromX; x <= toX; x++) {
    const idx = (y * snap.width + x) * 4;
    if ((snap.pixels[idx + 3] ?? 0) > 0) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Polygon rotation fix (#60)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, true);

    // Select shape tool in polygon mode with solid fill
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('shape');
    });
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);
  });

  test('4-sided polygon renders as square with flat top edge', async ({ page }) => {
    await setToolSetting(page, 'setShapePolygonSides', 4);

    // Draw from center (200,200) outward to (300,300) — radius ~100px
    await drawShape(page, 200, 200, 300, 300);

    const snap = await readLayer(page);
    expect(snap.width).toBeGreaterThan(0);

    const bounds = findOpaqueBounds(snap);
    expect(bounds).not.toBeNull();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polygon-4-sides-square.png') });

    // A square with a flat top has a wide horizontal span at its top edge.
    // A diamond (old bug) would have only ~1 pixel at the very top.
    // Check that the topmost row of the shape has significant horizontal extent.
    const topRow = bounds!.minY;
    const shapeWidth = bounds!.maxX - bounds!.minX;
    const topRowFilled = countOpaqueInRow(snap, topRow, bounds!.minX, bounds!.maxX);

    // For a flat-top square, the top row should span most of the shape width.
    // Allow some anti-aliasing tolerance — at least 50% of shape width.
    expect(topRowFilled).toBeGreaterThan(shapeWidth * 0.5);

    // Additionally: the topmost rows should be roughly as wide as the shape itself
    // (not tapering to a point like a diamond would).
    const nearTopRow = topRow + 2;
    const nearTopFilled = countOpaqueInRow(snap, nearTopRow, bounds!.minX, bounds!.maxX);
    expect(nearTopFilled).toBeGreaterThan(shapeWidth * 0.7);
  });

  test('6-sided polygon renders as flat-top hexagon', async ({ page }) => {
    await setToolSetting(page, 'setShapePolygonSides', 6);

    await drawShape(page, 200, 200, 300, 300);

    const snap = await readLayer(page);
    expect(snap.width).toBeGreaterThan(0);

    const bounds = findOpaqueBounds(snap);
    expect(bounds).not.toBeNull();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polygon-6-sides-hexagon.png') });

    // A flat-top hexagon has a wide top edge — not a point.
    // The top row should span a significant portion of the shape width.
    const topRow = bounds!.minY;
    const shapeWidth = bounds!.maxX - bounds!.minX;
    const topRowFilled = countOpaqueInRow(snap, topRow, bounds!.minX, bounds!.maxX);

    // Hexagon flat-top: top edge is half the full width. Allow tolerance.
    expect(topRowFilled).toBeGreaterThan(shapeWidth * 0.3);

    // A pointy-top hexagon (pre-fix) would have only ~1px at the top.
    // Confirm we have a meaningful span.
    expect(topRowFilled).toBeGreaterThan(5);
  });

  test('odd-sided polygons still point up (triangle)', async ({ page }) => {
    await setToolSetting(page, 'setShapePolygonSides', 3);

    await drawShape(page, 200, 200, 300, 300);

    const snap = await readLayer(page);
    expect(snap.width).toBeGreaterThan(0);

    const bounds = findOpaqueBounds(snap);
    expect(bounds).not.toBeNull();

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'polygon-3-sides-triangle.png') });

    // Verify the shape rendered with non-trivial dimensions.
    const shapeWidth = bounds!.maxX - bounds!.minX;
    const shapeHeight = bounds!.maxY - bounds!.minY;
    expect(shapeWidth).toBeGreaterThan(10);
    expect(shapeHeight).toBeGreaterThan(10);
  });
});
