import { test, expect, type Page } from './fixtures';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots/shape-path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
  );
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
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function getPathsState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        paths: Array<{
          id: string;
          name: string;
          anchors: Array<{ point: { x: number; y: number } }>;
          closed: boolean;
        }>;
        selectedPathId: string | null;
      };
    };
    const state = store.getState();
    return {
      paths: state.paths.map((p) => ({
        id: p.id,
        name: p.name,
        anchorCount: p.anchors.length,
        closed: p.closed,
      })),
      selectedPathId: state.selectedPathId,
    };
  });
}

async function setShapeTool(
  page: Page,
  mode: 'ellipse' | 'polygon',
  output: 'pixels' | 'path',
  options?: { sides?: number },
) {
  await page.evaluate(
    ({ mode, output, sides }) => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setShapeMode: (m: string) => void;
          setShapeOutput: (o: string) => void;
          setShapeFillColor: (c: { r: number; g: number; b: number; a: number } | null) => void;
          setShapePolygonSides: (n: number) => void;
        };
      };
      const settings = ts.getState();
      settings.setShapeMode(mode);
      settings.setShapeOutput(output);
      settings.setShapeFillColor({ r: 255, g: 0, b: 0, a: 1 });
      if (sides !== undefined) {
        settings.setShapePolygonSides(sides);
      }

      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('shape');
    },
    { mode, output, sides: options?.sides ?? null },
  );
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Shape path output (#61)', () => {
  test('ellipse shape creates a path when output is set to path', async ({ page }) => {
    await setShapeTool(page, 'ellipse', 'path');

    // Draw an ellipse from center (200,200) to edge (300,280)
    await dragShape(page, { x: 200, y: 200 }, { x: 300, y: 280 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'shape-path-ellipse.png') });

    const pathState = await getPathsState(page);
    expect(pathState.paths).toHaveLength(1);
    expect(pathState.paths[0]!.closed).toBe(true);
    // Ellipse is approximated with 4 cubic bezier anchors
    expect(pathState.paths[0]!.anchorCount).toBe(4);
  });

  test('polygon shape creates a path with correct number of anchors', async ({ page }) => {
    await setShapeTool(page, 'polygon', 'path', { sides: 5 });

    // Draw a polygon from center (200,200) to edge (300,280)
    await dragShape(page, { x: 200, y: 200 }, { x: 300, y: 280 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'shape-path-polygon.png') });

    const pathState = await getPathsState(page);
    expect(pathState.paths).toHaveLength(1);
    expect(pathState.paths[0]!.anchorCount).toBe(5);
    expect(pathState.paths[0]!.closed).toBe(true);
  });

  test('pixels mode still rasterizes normally', async ({ page }) => {
    await setShapeTool(page, 'ellipse', 'pixels');

    // Draw an ellipse
    await dragShape(page, { x: 200, y: 200 }, { x: 300, y: 280 });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'shape-pixels-mode.png') });

    // No path should have been created
    const pathState = await getPathsState(page);
    expect(pathState.paths).toHaveLength(0);

    // Verify pixels were written to the active layer
    const hasPixels = await page.evaluate(async () => {
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn();
      if (!result || result.width === 0) return false;
      let opaqueCount = 0;
      for (let i = 3; i < result.pixels.length; i += 4) {
        if ((result.pixels[i] ?? 0) > 0) opaqueCount++;
      }
      return opaqueCount > 0;
    });
    expect(hasPixels).toBe(true);
  });
});
