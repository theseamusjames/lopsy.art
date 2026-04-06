import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots/paths');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  await page.waitForTimeout(200);
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

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
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
        firstAnchor: p.anchors[0]?.point ?? null,
      })),
      selectedPathId: state.selectedPathId,
    };
  });
}

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          mask: Uint8ClampedArray | null;
          maskWidth: number;
          maskHeight: number;
        };
      };
    };
    const s = store.getState().selection;
    let nonZeroMaskPixels = 0;
    if (s.mask) {
      for (let i = 0; i < s.mask.length; i++) {
        if (s.mask[i]! > 0) nonZeroMaskPixels++;
      }
    }
    return { active: s.active, nonZeroMaskPixels };
  });
}

/**
 * Sample the selection mask value at a document-space coordinate.
 * Returns 0–255 (0 = not selected, 255 = fully selected).
 */
async function getSelectionMaskAt(page: Page, docX: number, docY: number): Promise<number> {
  return page.evaluate(
    ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          selection: {
            active: boolean;
            mask: Uint8ClampedArray | null;
            maskWidth: number;
          };
        };
      };
      const sel = store.getState().selection;
      if (!sel.active || !sel.mask) return 0;
      const idx = Math.round(y) * sel.maskWidth + Math.round(x);
      return sel.mask[idx] ?? 0;
    },
    { x: docX, y: docY },
  );
}

async function countOpaquePixels(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        getOrCreateLayerPixelData: (id: string) => ImageData;
      };
    };
    const state = store.getState();
    const data = state.getOrCreateLayerPixelData(state.document.activeLayerId);
    if (!data) return 0;
    let count = 0;
    for (let i = 3; i < data.data.length; i += 4) {
      if ((data.data[i] ?? 0) > 0) count++;
    }
    return count;
  });
}

/** Read a pixel from the active layer at document-local coords. */
async function getPixelAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
        };
      };
      const state = store.getState();
      const data = state.getOrCreateLayerPixelData(state.document.activeLayerId);
      if (!data) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (y * data.width + x) * 4;
      return {
        r: data.data[idx] ?? 0,
        g: data.data[idx + 1] ?? 0,
        b: data.data[idx + 2] ?? 0,
        a: data.data[idx + 3] ?? 0,
      };
    },
    { x, y },
  );
}

/**
 * Read the overlay canvas pixel at a given screen coordinate.
 * Returns RGBA. Non-zero alpha means something is drawn on the overlay.
 */
async function getOverlayPixelAtScreen(page: Page, screenX: number, screenY: number) {
  return page.evaluate(
    ({ sx, sy }) => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { r: 0, g: 0, b: 0, a: 0 };
      const canvases = container.querySelectorAll('canvas');
      // The overlay canvas is the second canvas in the container
      const overlay = canvases[1] as HTMLCanvasElement | undefined;
      if (!overlay) return { r: 0, g: 0, b: 0, a: 0 };
      const rect = overlay.getBoundingClientRect();
      // Convert screen coords to canvas pixel coords (account for CSS vs pixel size)
      const scaleX = overlay.width / rect.width;
      const scaleY = overlay.height / rect.height;
      const px = Math.round((sx - rect.left) * scaleX);
      const py = Math.round((sy - rect.top) * scaleY);
      const ctx = overlay.getContext('2d');
      if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
      const pixel = ctx.getImageData(px, py, 1, 1).data;
      return {
        r: pixel[0] ?? 0,
        g: pixel[1] ?? 0,
        b: pixel[2] ?? 0,
        a: pixel[3] ?? 0,
      };
    },
    { sx: screenX, sy: screenY },
  );
}

/**
 * Check whether the overlay has any non-transparent pixel along a line
 * between two document-space points (samples N points along the line).
 */
async function overlayHasPixelsBetween(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  samples = 10,
): Promise<boolean> {
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const docX = from.x + (to.x - from.x) * t;
    const docY = from.y + (to.y - from.y) * t;
    const screen = await docToScreen(page, docX, docY);
    const pixel = await getOverlayPixelAtScreen(page, screen.x, screen.y);
    if (pixel.a > 0) return true;
  }
  return false;
}

async function openPathsPanel(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => {
        visiblePanels: Set<string>;
        togglePanel: (id: string) => void;
      };
    };
    const state = store.getState();
    if (!state.visiblePanels.has('paths')) {
      state.togglePanel('paths');
    }
  });
  await page.waitForTimeout(100);
}

async function selectPathInPanel(page: Page, pathId: string) {
  await page.evaluate(
    (id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectPath: (id: string | null) => void };
      };
      store.getState().selectPath(id);
    },
    pathId,
  );
  await page.waitForTimeout(100);
}

async function deselectPath(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selectPath: (id: string | null) => void };
    };
    store.getState().selectPath(null);
  });
  await page.waitForTimeout(100);
}

async function triggerNotifyRender(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { notifyRender: () => void };
    };
    store.getState().notifyRender();
  });
  await page.waitForTimeout(200);
}

/** Draw a closed triangle path at the given doc-space vertices. */
async function drawTrianglePath(
  page: Page,
  v1: { x: number; y: number },
  v2: { x: number; y: number },
  v3: { x: number; y: number },
) {
  await clickAtDoc(page, v1.x, v1.y);
  await clickAtDoc(page, v2.x, v2.y);
  await clickAtDoc(page, v3.x, v3.y);
  // Close by clicking near first point
  await clickAtDoc(page, v1.x, v1.y);
  await page.waitForTimeout(200);
}

/** Draw an open path (no close) with the given points, then press Enter. */
async function drawOpenPath(page: Page, points: Array<{ x: number; y: number }>) {
  for (const pt of points) {
    await clickAtDoc(page, pt.x, pt.y);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
  );
  await createDocument(page, 400, 400, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await openPathsPanel(page);
  // Select pen tool
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
});

// ===========================================================================
// Tests
// ===========================================================================

test.describe('Paths Panel', () => {
  test('path creation and panel listing', async ({ page }) => {
    await drawTrianglePath(
      page,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 150, y: 200 },
    );

    const state = await getPathsState(page);
    expect(state.paths).toHaveLength(1);
    expect(state.paths[0]!.name).toBe('Path 1');
    expect(state.paths[0]!.anchorCount).toBe(3);
    expect(state.paths[0]!.closed).toBe(true);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-path-created-in-panel.png'),
    });
  });

  test('selected path overlay shows all segments including closing segment', async ({ page }) => {
    // Triangle — three segments: v1→v2, v2→v3, v3→v1 (closing)
    const v1 = { x: 100, y: 80 };
    const v2 = { x: 300, y: 80 };
    const v3 = { x: 200, y: 300 };
    await drawTrianglePath(page, v1, v2, v3);

    const state = await getPathsState(page);
    expect(state.selectedPathId).toBe(state.paths[0]!.id);

    // Force a render tick so the overlay is painted
    await triggerNotifyRender(page);

    // --- Verify overlay pixels exist along each segment ---
    // Segment 1: v1 → v2 (top edge)
    const seg1 = await overlayHasPixelsBetween(page, v1, v2);
    expect(seg1).toBe(true);

    // Segment 2: v2 → v3 (right side)
    const seg2 = await overlayHasPixelsBetween(page, v2, v3);
    expect(seg2).toBe(true);

    // Segment 3: v3 → v1 (closing segment — the bug we just fixed)
    const seg3 = await overlayHasPixelsBetween(page, v3, v1);
    expect(seg3).toBe(true);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-selected-path-overlay.png'),
    });
  });

  test('deselected path has no overlay', async ({ page }) => {
    const v1 = { x: 100, y: 100 };
    const v2 = { x: 300, y: 100 };
    const v3 = { x: 200, y: 300 };
    await drawTrianglePath(page, v1, v2, v3);

    await deselectPath(page);
    await triggerNotifyRender(page);

    // The overlay should be empty for the segment — no path selected
    const seg1 = await overlayHasPixelsBetween(page, v1, v2);
    expect(seg1).toBe(false);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-no-overlay-when-deselected.png'),
    });
  });

  test('stroke path with default settings produces pixels along path', async ({ page }) => {
    const v1 = { x: 80, y: 80 };
    const v2 = { x: 320, y: 80 };
    const v3 = { x: 200, y: 320 };
    await drawTrianglePath(page, v1, v2, v3);

    const state = await getPathsState(page);
    await selectPathInPanel(page, state.paths[0]!.id);

    // Open stroke modal via store
    await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setStrokeModalPathId: (id: string | null) => void };
      };
      const edStore = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectedPathId: string | null };
      };
      uiStore.getState().setStrokeModalPathId(edStore.getState().selectedPathId);
    });
    await page.waitForTimeout(200);

    // Confirm stroke with default settings
    const confirmBtn = page.locator('button', { hasText: 'Stroke' });
    await confirmBtn.click();
    await page.waitForTimeout(300);

    // Verify pixels exist along each edge of the triangle
    // Top edge midpoint
    const topMid = await getPixelAt(page, 200, 80);
    expect(topMid.a).toBeGreaterThan(0);

    // Right side midpoint: halfway from v2(320,80) to v3(200,320)
    const rightMid = await getPixelAt(page, 260, 200);
    expect(rightMid.a).toBeGreaterThan(0);

    // Left side midpoint: halfway from v3(200,320) to v1(80,80)
    const leftMid = await getPixelAt(page, 140, 200);
    expect(leftMid.a).toBeGreaterThan(0);

    // Interior should be empty (stroke, not fill)
    const interior = await getPixelAt(page, 200, 180);
    expect(interior.a).toBe(0);

    // Path still exists in panel
    const stateAfter = await getPathsState(page);
    expect(stateAfter.paths).toHaveLength(1);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-stroked-path-pixels.png'),
    });
  });

  test('stroke path with custom width is thicker', async ({ page }) => {
    const v1 = { x: 80, y: 80 };
    const v2 = { x: 320, y: 80 };
    const v3 = { x: 200, y: 320 };
    await drawTrianglePath(page, v1, v2, v3);

    const state = await getPathsState(page);
    await selectPathInPanel(page, state.paths[0]!.id);

    await page.evaluate(() => {
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setStrokeModalPathId: (id: string | null) => void };
      };
      const edStore = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectedPathId: string | null };
      };
      uiStore.getState().setStrokeModalPathId(edStore.getState().selectedPathId);
    });
    await page.waitForTimeout(200);

    // Set width to 20px
    const widthInput = page.locator('input[type="number"]');
    await widthInput.fill('20');

    const confirmBtn = page.locator('button', { hasText: 'Stroke' });
    await confirmBtn.click();
    await page.waitForTimeout(300);

    const opaqueCount = await countOpaquePixels(page);
    expect(opaqueCount).toBeGreaterThan(500);

    // With 20px width, pixels 8px away from the edge should also be opaque
    const nearEdge = await getPixelAt(page, 200, 72);
    expect(nearEdge.a).toBeGreaterThan(0);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-custom-stroke-width.png'),
    });
  });

  test('edit mode — drag anchor', async ({ page }) => {
    await drawTrianglePath(
      page,
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 200, y: 300 },
    );

    const state = await getPathsState(page);
    await selectPathInPanel(page, state.paths[0]!.id);
    await page.waitForTimeout(200);

    // Ensure pen tool is active for edit mode
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // Drag the first anchor
    const firstAnchor = state.paths[0]!.firstAnchor!;
    const startScreen = await docToScreen(page, firstAnchor.x, firstAnchor.y);
    const endScreen = await docToScreen(
      page,
      firstAnchor.x + 50,
      firstAnchor.y + 50,
    );

    await page.mouse.move(startScreen.x, startScreen.y);
    await page.mouse.down();
    await page.mouse.move(endScreen.x, endScreen.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const stateAfter = await getPathsState(page);
    const movedAnchor = stateAfter.paths[0]!.firstAnchor!;
    expect(movedAnchor.x).toBeGreaterThan(firstAnchor.x + 20);
    expect(movedAnchor.y).toBeGreaterThan(firstAnchor.y + 20);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '09-edited-path.png'),
    });
  });

  test('edit mode — add anchor to segment', async ({ page }) => {
    await drawOpenPath(page, [{ x: 100, y: 200 }, { x: 300, y: 200 }]);

    const state = await getPathsState(page);
    expect(state.paths[0]!.anchorCount).toBe(2);
    await selectPathInPanel(page, state.paths[0]!.id);

    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // Click on the midpoint of the segment
    await clickAtDoc(page, 200, 200);
    await page.waitForTimeout(200);

    const stateAfter = await getPathsState(page);
    expect(stateAfter.paths[0]!.anchorCount).toBe(3);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '10-anchor-added.png'),
    });
  });

  test('open path commit via Enter key', async ({ page }) => {
    await drawOpenPath(page, [
      { x: 50, y: 50 },
      { x: 200, y: 100 },
      { x: 350, y: 50 },
    ]);

    const state = await getPathsState(page);
    expect(state.paths).toHaveLength(1);
    expect(state.paths[0]!.anchorCount).toBe(3);
    expect(state.paths[0]!.closed).toBe(false);

    // Verify overlay shows the open path (no closing segment)
    await triggerNotifyRender(page);
    const seg = await overlayHasPixelsBetween(
      page,
      { x: 50, y: 50 },
      { x: 200, y: 100 },
    );
    expect(seg).toBe(true);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '11-open-path.png'),
    });
  });

  test('edit mode — Cmd+drag converts anchor to spline', async ({ page }) => {
    // Create a simple straight-line triangle
    await drawTrianglePath(
      page,
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 200, y: 300 },
    );

    const state = await getPathsState(page);
    await selectPathInPanel(page, state.paths[0]!.id);
    await page.waitForTimeout(200);

    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    // Verify anchor has no handles initially
    const anchorsBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          paths: Array<{
            anchors: Array<{
              point: { x: number; y: number };
              handleIn: { x: number; y: number } | null;
              handleOut: { x: number; y: number } | null;
            }>;
          }>;
        };
      };
      const p = store.getState().paths[0];
      if (!p) return null;
      return p.anchors.map((a) => ({
        handleIn: a.handleIn,
        handleOut: a.handleOut,
      }));
    });
    expect(anchorsBefore).not.toBeNull();
    expect(anchorsBefore![0]!.handleIn).toBeNull();
    expect(anchorsBefore![0]!.handleOut).toBeNull();

    // Cmd+drag the first anchor to pull out handles
    const firstAnchor = state.paths[0]!.firstAnchor!;
    const startScreen = await docToScreen(page, firstAnchor.x, firstAnchor.y);
    const endScreen = await docToScreen(page, firstAnchor.x + 60, firstAnchor.y);

    await page.mouse.move(startScreen.x, startScreen.y);
    await page.keyboard.down('Meta');
    await page.mouse.down();
    await page.mouse.move(endScreen.x, endScreen.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Meta');
    await page.waitForTimeout(200);

    // Verify handles were created symmetrically
    const anchorsAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          paths: Array<{
            anchors: Array<{
              point: { x: number; y: number };
              handleIn: { x: number; y: number } | null;
              handleOut: { x: number; y: number } | null;
            }>;
          }>;
        };
      };
      const p = store.getState().paths[0];
      if (!p) return null;
      return p.anchors.map((a) => ({
        point: a.point,
        handleIn: a.handleIn,
        handleOut: a.handleOut,
      }));
    });
    expect(anchorsAfter).not.toBeNull();
    const converted = anchorsAfter![0]!;
    // handleOut should be to the right of the anchor point
    expect(converted.handleOut).not.toBeNull();
    expect(converted.handleOut!.x).toBeGreaterThan(converted.point.x + 20);
    // handleIn should be symmetric (to the left)
    expect(converted.handleIn).not.toBeNull();
    expect(converted.handleIn!.x).toBeLessThan(converted.point.x - 20);
    // Anchor point itself should not have moved
    expect(Math.abs(converted.point.x - firstAnchor.x)).toBeLessThan(2);
    expect(Math.abs(converted.point.y - firstAnchor.y)).toBeLessThan(2);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '12-anchor-converted-to-spline.png'),
    });
  });

  test('edit mode — Cmd+click reverts spline anchor to corner', async ({ page }) => {
    await drawTrianglePath(
      page,
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 200, y: 300 },
    );

    const state = await getPathsState(page);
    await selectPathInPanel(page, state.paths[0]!.id);
    await page.waitForTimeout(200);
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    const firstAnchor = state.paths[0]!.firstAnchor!;

    // Step 1: Cmd+drag to create handles
    const startScreen = await docToScreen(page, firstAnchor.x, firstAnchor.y);
    const dragTarget = await docToScreen(page, firstAnchor.x + 60, firstAnchor.y);
    await page.mouse.move(startScreen.x, startScreen.y);
    await page.keyboard.down('Meta');
    await page.mouse.down();
    await page.mouse.move(dragTarget.x, dragTarget.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Meta');
    await page.waitForTimeout(200);

    // Verify handles exist
    const anchorsWithHandles = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          paths: Array<{
            anchors: Array<{
              handleIn: { x: number; y: number } | null;
              handleOut: { x: number; y: number } | null;
            }>;
          }>;
        };
      };
      const a = store.getState().paths[0]?.anchors[0];
      return { handleIn: a?.handleIn ?? null, handleOut: a?.handleOut ?? null };
    });
    expect(anchorsWithHandles.handleIn).not.toBeNull();
    expect(anchorsWithHandles.handleOut).not.toBeNull();

    // Step 2: Cmd+click (no drag) to revert to corner
    await page.mouse.move(startScreen.x, startScreen.y);
    await page.keyboard.down('Meta');
    await page.mouse.click(startScreen.x, startScreen.y);
    await page.keyboard.up('Meta');
    await page.waitForTimeout(200);

    // Verify handles are gone
    const anchorsReverted = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          paths: Array<{
            anchors: Array<{
              handleIn: { x: number; y: number } | null;
              handleOut: { x: number; y: number } | null;
            }>;
          }>;
        };
      };
      const a = store.getState().paths[0]?.anchors[0];
      return { handleIn: a?.handleIn ?? null, handleOut: a?.handleOut ?? null };
    });
    expect(anchorsReverted.handleIn).toBeNull();
    expect(anchorsReverted.handleOut).toBeNull();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '13-spline-reverted-to-corner.png'),
    });
  });

  test('escape discards uncommitted path', async ({ page }) => {
    await clickAtDoc(page, 100, 100);
    await clickAtDoc(page, 200, 200);
    await page.waitForTimeout(100);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const state = await getPathsState(page);
    expect(state.paths).toHaveLength(0);
  });
});
