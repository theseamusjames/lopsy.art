import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  getPixelAt,
} from './helpers';

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const sel = state.selection as {
      active: boolean;
      bounds: { x: number; y: number; width: number; height: number } | null;
    };
    return { active: sel.active, bounds: sel.bounds };
  });
}

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

async function setTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool(t);
  }, tool);
}

async function setMagneticLassoSettings(
  page: Page,
  settings: { width?: number; contrast?: number; frequency?: number },
) {
  await page.evaluate((s) => {
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => {
        setMagneticLassoWidth: (n: number) => void;
        setMagneticLassoContrast: (n: number) => void;
        setMagneticLassoFrequency: (n: number) => void;
      };
    };
    const state = ts.getState();
    if (s.width !== undefined) state.setMagneticLassoWidth(s.width);
    if (s.contrast !== undefined) state.setMagneticLassoContrast(s.contrast);
    if (s.frequency !== undefined) state.setMagneticLassoFrequency(s.frequency);
  }, settings);
}

/** Paint an opaque rectangle directly into the layer, replicating the
 *  pattern used by the passing Magic Wand e2e test. */
async function paintRectPixels(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number },
) {
  await page.evaluate(
    ({ x, y, w, h, color }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const data = new ImageData(state.document.width, state.document.height);
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
      state.updateLayerPixelData(state.document.activeLayerId, data);
    },
    { x, y, w, h, color },
  );
  await page.waitForTimeout(150);
}

/**
 * Drag along a polyline in doc coordinates. Between each pair of points we
 * issue a `mouse.move` with `steps` so the magnetic lasso sees a stream of
 * mousemove events (one anchor may auto-place per segment, depending on
 * frequency).
 */
async function dragPolyline(
  page: Page,
  polyline: Array<{ x: number; y: number }>,
  stepsPerSegment = 15,
) {
  if (polyline.length < 2) return;
  const first = polyline[0]!;
  const start = await docToScreen(page, first.x, first.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i < polyline.length; i++) {
    const p = polyline[i]!;
    const screen = await docToScreen(page, p.x, p.y);
    await page.mouse.move(screen.x, screen.y, { steps: stepsPerSegment });
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ===========================================================================
// Magnetic Lasso
// ===========================================================================

test.describe('Magnetic Lasso', () => {
  test('snaps a drag-traced path onto a high-contrast rectangle edge', async ({ page }) => {
    // White background, 400x300 doc
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Paint a solid black rectangle — strong luma edge on all four sides.
    const rect = { x: 100, y: 80, w: 200, h: 140 };
    await paintRectPixels(page, rect.x, rect.y, rect.w, rect.h, {
      r: 0, g: 0, b: 0, a: 255,
    });

    // Force the engine sync to flush the pixel data to the GPU texture.
    // magneticLassoBegin reads pixels straight from that texture, so a stale
    // texture means an empty edge field and no snapping.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { notifyRender: () => void };
      };
      store.getState().notifyRender();
    });
    await page.waitForTimeout(300);

    // Confirm the pixel upload actually reached the layer — if this is
    // transparent the GPU texture hasn't been written and edge detection
    // will see nothing.
    const innerPixel = await getPixelAt(page, rect.x + 10, rect.y + 10);
    expect(innerPixel.a, 'interior of painted rect should be opaque black').toBe(255);
    expect(innerPixel.r).toBe(0);


    // Baseline screenshot: the black rectangle the user will trace around.
    await page.screenshot({ path: 'test-results/screenshots/magnetic-lasso-before.png' });

    // Activate magnetic lasso with a generous search width + auto-anchor
    // every ~30 px along the stroke.
    await setTool(page, 'lasso-magnetic');
    await setMagneticLassoSettings(page, {
      width: 20,
      contrast: 20,
      frequency: 30,
    });

    // Trace a rectangular path that's consistently 6 px *outside* the
    // rectangle's true edge. A working magnetic lasso should pull each
    // segment inward onto the black/white boundary.
    const inset = 6;
    const outerPath = [
      { x: rect.x - inset, y: rect.y - inset },
      { x: rect.x + rect.w + inset, y: rect.y - inset },
      { x: rect.x + rect.w + inset, y: rect.y + rect.h + inset },
      { x: rect.x - inset, y: rect.y + rect.h + inset },
      // The close segment is synthesised by mouseup; no need to return manually.
    ];
    await dragPolyline(page, outerPath, 20);

    // The trace should have produced a selection.
    const state = await getSelectionState(page);
    expect(state.active).toBe(true);
    expect(state.bounds).not.toBeNull();

    // Selection bounds should be pulled inward from the naïve outer path
    // toward the painted rectangle. The unsnapped path would span the outer
    // rectangle exactly (inset=6 px beyond the painted edge on every side);
    // snapping should shrink the selection by several pixels on every side.
    const bounds = state.bounds!;
    const outerLeft = rect.x - inset;
    const outerRight = rect.x + rect.w + inset;
    const outerTop = rect.y - inset;
    const outerBottom = rect.y + rect.h + inset;
    const outerWidth = outerRight - outerLeft;
    const outerHeight = outerBottom - outerTop;

    // Each side should be pulled inward by at least 1 px on average — but
    // rather than hard-assert each edge, verify the overall snap by checking
    // the selection's perimeter shrunk meaningfully.
    expect(bounds.width).toBeLessThan(outerWidth);
    expect(bounds.height).toBeLessThan(outerHeight);
    // And the bounds never exceed the outer path on any side.
    expect(bounds.x).toBeGreaterThanOrEqual(outerLeft);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(outerRight);
    expect(bounds.y).toBeGreaterThanOrEqual(outerTop);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(outerBottom);

    // Final screenshot: marching-ants selection around the (snapped) rect.
    await page.screenshot({ path: 'test-results/screenshots/magnetic-lasso-after.png' });
  });

  test('falls back to the raw path when no edges clear the contrast threshold', async ({ page }) => {
    // Transparent doc so there are zero edges anywhere.
    await createDocument(page, 300, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    await setTool(page, 'lasso-magnetic');
    // High contrast threshold means "only snap to very strong edges". On a
    // blank layer nothing will qualify and the segment must stay straight.
    // Frequency is non-zero so mid-stroke corners get committed as anchors;
    // without that, a freehand path with no edges would collapse to just
    // the mousedown and mouseup points.
    await setMagneticLassoSettings(page, {
      width: 15,
      contrast: 95,
      frequency: 50,
    });

    const path = [
      { x: 60, y: 60 },
      { x: 240, y: 60 },
      { x: 240, y: 160 },
      { x: 60, y: 160 },
    ];
    await dragPolyline(page, path, 10);

    const state = await getSelectionState(page);
    expect(state.active).toBe(true);
    const bounds = state.bounds!;
    // Unsnapped bounds should hug the drawn path (small tolerance for
    // selection rasterisation + closing segment).
    expect(bounds.x).toBeGreaterThanOrEqual(55);
    expect(bounds.x).toBeLessThanOrEqual(65);
    expect(bounds.y).toBeGreaterThanOrEqual(55);
    expect(bounds.y).toBeLessThanOrEqual(65);
    expect(bounds.width).toBeGreaterThan(170);
    expect(bounds.height).toBeGreaterThan(90);

    await page.screenshot({ path: 'test-results/screenshots/magnetic-lasso-no-edges.png' });
  });
});
