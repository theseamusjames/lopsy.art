import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument, getEditorState } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OverlaySample {
  width: number;
  height: number;
  pixels: number[];
  // Translate from doc coords to overlay coords:
  // overlayX = (docX - doc.width/2) * zoom + viewport.panX + overlay.width/2
  docToOverlayX: (dx: number) => number;
  docToOverlayY: (dy: number) => number;
  zoom: number;
}

/**
 * Capture the overlay canvas (where the grid is drawn) along with the
 * viewport state needed to project doc coordinates onto it.
 */
async function readOverlayCanvas(page: Page): Promise<OverlaySample> {
  const data = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    const overlay = all.find((c) => /overlayCanvas/.test(c.className));
    if (!overlay) throw new Error('overlay canvas not found');
    const ctx = overlay.getContext('2d');
    if (!ctx) throw new Error('overlay 2d context not available');
    const img = ctx.getImageData(0, 0, overlay.width, overlay.height);
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        viewport: { panX: number; panY: number; zoom: number };
        document: { width: number; height: number };
      };
    };
    const state = ed.getState();
    return {
      width: overlay.width,
      height: overlay.height,
      pixels: Array.from(img.data),
      panX: state.viewport.panX,
      panY: state.viewport.panY,
      zoom: state.viewport.zoom,
      docW: state.document.width,
      docH: state.document.height,
    };
  });
  const cx = data.panX + data.width / 2;
  const cy = data.panY + data.height / 2;
  return {
    width: data.width,
    height: data.height,
    pixels: data.pixels,
    zoom: data.zoom,
    docToOverlayX: (dx: number) => (dx - data.docW / 2) * data.zoom + cx,
    docToOverlayY: (dy: number) => (dy - data.docH / 2) * data.zoom + cy,
  };
}

function alphaAt(s: OverlaySample, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= s.width || yi < 0 || yi >= s.height) return 0;
  return s.pixels[(yi * s.width + xi) * 4 + 3] ?? 0;
}

/**
 * Returns true if any pixel in a small (3x3) neighborhood has alpha > threshold.
 * Used to tolerate sub-pixel grid line positioning.
 */
function hasMarkNear(s: OverlaySample, x: number, y: number, threshold = 20, radius = 1): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (alphaAt(s, x + dx, y + dy) > threshold) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Centered grid with edge snapping (#126)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('grid lines pass through the canvas center and mirror outward', async ({ page }) => {
    // Use an odd-sized canvas so a top-left-anchored grid (the bug) would
    // never land on the center line; only a properly centered grid does.
    await createDocument(page, 501, 501, false);
    await page.waitForTimeout(200);

    // Enable grid + snap and set a known size.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleGrid: () => void; setGridSize: (n: number) => void; showGrid: boolean };
      };
      const s = ui.getState();
      if (!s.showGrid) s.toggleGrid();
      s.setGridSize(50);
    });
    await page.waitForTimeout(300);

    const grid = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showGrid: boolean; snapToGrid: boolean; gridSize: number };
      };
      return ui.getState();
    });
    expect(grid.showGrid).toBe(true);
    expect(grid.snapToGrid).toBe(true);
    expect(grid.gridSize).toBe(50);

    // Capture the overlay so we can probe specific pixel positions.
    const sample = await readOverlayCanvas(page);
    expect(sample.width).toBeGreaterThan(0);

    // Pick a horizontal scan row that is NOT on a horizontal grid line —
    // a centered 50px grid puts horizontal lines at doc y = 250.5, 200.5,
    // 150.5, .... Doc y = 225 sits halfway between 200.5 and 250.5, so
    // hits no horizontal grid line.
    const offGridDocY = 225;
    const scanY = sample.docToOverlayY(offGridDocY);

    // Sanity: a doc x that is also off any grid line (doc x = 225) should
    // have no mark — this confirms our scan row isn't picking up anything
    // unrelated to the vertical grid lines.
    const blankX = sample.docToOverlayX(225);
    expect(hasMarkNear(sample, blankX, scanY)).toBe(false);

    // The centred grid must have a vertical line exactly at doc center
    // (250.5). For an odd width (501) this is the unique signature of a
    // centred grid; a top-left-anchored 50px grid would draw lines at
    // 0, 50, 100, ..., 500 — never at 250.5.
    const centerOverlayX = sample.docToOverlayX(250.5);
    expect(hasMarkNear(sample, centerOverlayX, scanY)).toBe(true);

    // Lines should also exist at center ± k * gridSize for several k.
    for (const k of [1, 2, 3]) {
      const left = sample.docToOverlayX(250.5 - k * 50);
      const right = sample.docToOverlayX(250.5 + k * 50);
      expect(hasMarkNear(sample, left, scanY)).toBe(true);
      expect(hasMarkNear(sample, right, scanY)).toBe(true);
    }

    // The same property must hold along a vertical scan column. Pick a
    // doc x that is off any vertical grid line (225), then probe rows
    // for the horizontal grid line at doc y = 250.5 ± k * 50.
    const offGridDocX = 225;
    const scanX = sample.docToOverlayX(offGridDocX);
    const centerOverlayY = sample.docToOverlayY(250.5);
    expect(hasMarkNear(sample, scanX, centerOverlayY)).toBe(true);
    for (const k of [1, 2, 3]) {
      const up = sample.docToOverlayY(250.5 - k * 50);
      const down = sample.docToOverlayY(250.5 + k * 50);
      expect(hasMarkNear(sample, scanX, up)).toBe(true);
      expect(hasMarkNear(sample, scanX, down)).toBe(true);
    }

    await page.screenshot({ path: 'e2e/screenshots/centered-grid.png' });
  });

  test('drag-move snaps the layer to nearest centred grid line', async ({ page }) => {
    await createDocument(page, 500, 400, false);
    await page.waitForTimeout(200);

    // Enable grid + snap with a coarse size so snap moves are large.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleGrid: () => void; setGridSize: (n: number) => void; showGrid: boolean };
      };
      const s = ui.getState();
      if (!s.showGrid) s.toggleGrid();
      s.setGridSize(50);
    });
    await page.waitForTimeout(100);

    // Add a layer with a 60×60 red square painted at doc coords (100..160).
    // After auto-crop, the layer will sit at x=100, y=100 with width=60.
    const layerId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          addLayer: () => void;
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = ed.getState();
      state.pushHistory('Add');
      state.addLayer();
      const id = state.document.activeLayerId;
      const data = new ImageData(state.document.width, state.document.height);
      for (let y = 100; y < 160; y++) {
        for (let x = 100; x < 160; x++) {
          const i = (y * data.width + x) * 4;
          data.data[i] = 255; data.data[i + 1] = 0; data.data[i + 2] = 0; data.data[i + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
      return id;
    });
    expect(layerId).toBeTruthy();

    // After auto-crop, layer.x and y should be 100 (top-left of painted area).
    const before = await getEditorState(page);
    const layerBefore = before.document.layers.find((l) => l.id === layerId)!;
    expect(layerBefore.x).toBe(100);
    expect(layerBefore.y).toBe(100);

    // Make the painted layer the active layer (it already is, but make
    // it explicit). Switch to the move tool. The move tool drags whatever
    // is currently the active layer.
    await page.evaluate(({ id }) => {
      const ed = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      ed.getState().setActiveLayer(id);
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('move');
    }, { id: layerId });
    await page.waitForTimeout(100);

    // Use the same docToScreen pattern as other working e2e tests
    // (tools.spec.ts, move-layer.spec.ts) — based on container bounding rect.
    const docToScreen = async (docX: number, docY: number) =>
      page.evaluate(({ dx, dy }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { width: number; height: number };
            viewport: { zoom: number; panX: number; panY: number };
          };
        };
        const state = store.getState();
        const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
        const rect = container.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const screenX = (dx - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
        const screenY = (dy - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
        return { x: rect.left + screenX, y: rect.top + screenY };
      }, { dx: docX, dy: docY });

    // Click in the centre of the painted square at doc (130, 130) and drag
    // the layer by +27 doc px in X. With a centred 50px grid, the pre-snap
    // post-drag x = 100 + 27 = 127, which snaps to 150 (nearest line).
    const start = await docToScreen(130, 130);
    const end = await docToScreen(157, 130);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const after = await getEditorState(page);
    const layer = after.document.layers.find((l) => l.id === layerId)!;
    // Pre-snap x would be 127. Nearest centred grid line is 150.
    expect(layer.x).toBe(150);
    expect(layer.y).toBe(100);

    await page.screenshot({ path: 'e2e/screenshots/centered-grid-snap.png' });
  });
});
