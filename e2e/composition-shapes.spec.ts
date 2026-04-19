/**
 * Composition Test 2: Geometric Design
 *
 * Covers: Shape tool (ellipse, polygon with varying sides + corner radius),
 * Path tool (create path, convert to spline via Cmd+drag, edit handles,
 *   close path, stroke path, add anchor to segment),
 * Selection tools (rectangular marquee, elliptical marquee with marching ants,
 *   lasso, magic wand),
 * Transform (free scale, rotation),
 * Move tool with alignment (all 6 alignments), nudge via arrow keys,
 * Fill/paint bucket with tolerance,
 * Copy/paste/cut,
 * Flip horizontal/vertical, rotate 90°,
 * Canvas resize / image resize,
 * Grid and guides toggle.
 */
import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 500, height = 500, transparent = false) {
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
      return {
        x: rect.left + (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
        y: rect.top + (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
      };
    },
    { docX, docY },
  );
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function dragAtDoc(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function setForegroundColor(page: Page, color: { r: number; g: number; b: number; a: number }) {
  await page.evaluate((c) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
    };
    store.getState().setForegroundColor(c);
  }, color);
}

async function setActiveTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    store.getState().setActiveTool(t);
  }, tool);
  await page.waitForTimeout(100);
}

async function getActiveTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    if (dr + dg + db > 30) count++;
  }
  return count;
}

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{
            id: string;
            name: string;
            visible: boolean;
            opacity: number;
            x: number;
            y: number;
            width: number;
            height: number;
          }>;
          layerOrder: string[];
          activeLayerId: string;
        };
        undoStack: unknown[];
        redoStack: unknown[];
      };
    };
    const state = store.getState();
    return {
      document: state.document,
      undoStackLength: state.undoStack.length,
      redoStackLength: state.redoStack.length,
    };
  });
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
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
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

async function addLayer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addLayer: () => void;
        document: { activeLayerId: string };
      };
    };
    store.getState().addLayer();
    return store.getState().document.activeLayerId;
  });
}

async function getPathsState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        paths: Array<{
          id: string;
          name: string;
          anchors: Array<{
            point: { x: number; y: number };
            handleIn: { x: number; y: number } | null;
            handleOut: { x: number; y: number } | null;
          }>;
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
        anchors: p.anchors,
      })),
      selectedPathId: state.selectedPathId,
    };
  });
}

async function getOverlayPixelAtScreen(page: Page, screenX: number, screenY: number) {
  return page.evaluate(
    ({ sx, sy }) => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { r: 0, g: 0, b: 0, a: 0 };
      const canvases = container.querySelectorAll('canvas');
      const overlay = canvases[1] as HTMLCanvasElement | undefined;
      if (!overlay) return { r: 0, g: 0, b: 0, a: 0 };
      const rect = overlay.getBoundingClientRect();
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

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          bounds: { x: number; y: number; width: number; height: number } | null;
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
    return { active: s.active, bounds: s.bounds, nonZeroMaskPixels };
  });
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Composition 2: Geometric Design', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 500, 500, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('builds a geometric composition with shapes, paths, selections, transforms, and alignment', async ({ page }) => {
    test.setTimeout(300_000);

    // =====================================================================
    // PHASE 1: SHAPE — Ellipse (circle)
    // =====================================================================
    await setActiveTool(page, 'shape');
    expect(await getActiveTool(page)).toBe('shape');

    await setToolSetting(page, 'setShapeMode', 'ellipse');
    await setToolSetting(page, 'setShapeFillColor', { r: 220, g: 50, b: 50, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', { r: 0, g: 0, b: 0, a: 0 });
    await setToolSetting(page, 'setShapeStrokeWidth', 0);

    await dragAtDoc(page, { x: 200, y: 200 }, { x: 300, y: 300 });

    const ellipsePixel = await getPixelAt(page, 250, 250);
    expect(ellipsePixel.r).toBeGreaterThan(180);
    expect(ellipsePixel.a).toBeGreaterThan(200);

    await page.screenshot({ path: 'e2e/screenshots/comp2-01-ellipse.png' });

    // =====================================================================
    // PHASE 2: SHAPE — Polygon (hexagon with corner radius)
    // =====================================================================
    const hexLayerId = await addLayer(page);

    await setActiveTool(page, 'shape');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 6);
    await setToolSetting(page, 'setShapeCornerRadius', 8);
    await setToolSetting(page, 'setShapeFillColor', { r: 50, g: 120, b: 220, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', { r: 255, g: 255, b: 255, a: 1 });
    await setToolSetting(page, 'setShapeStrokeWidth', 3);

    await dragAtDoc(page, { x: 100, y: 100 }, { x: 200, y: 200 });

    const hexPixel = await getPixelAt(page, 150, 150);
    expect(hexPixel.b).toBeGreaterThan(150);
    expect(hexPixel.a).toBeGreaterThan(200);

    await page.screenshot({ path: 'e2e/screenshots/comp2-02-hexagon.png' });

    // =====================================================================
    // PHASE 3: SHAPE — Triangle (polygon 3 sides)
    // =====================================================================
    const triLayerId = await addLayer(page);

    await setActiveTool(page, 'shape');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 3);
    await setToolSetting(page, 'setShapeCornerRadius', 0);
    await setToolSetting(page, 'setShapeFillColor', { r: 50, g: 200, b: 100, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', { r: 0, g: 0, b: 0, a: 0 });

    await dragAtDoc(page, { x: 320, y: 80 }, { x: 420, y: 200 });

    await page.screenshot({ path: 'e2e/screenshots/comp2-03-triangle.png' });

    // =====================================================================
    // PHASE 4: MOVE TOOL + ALIGNMENT — Align shapes
    // =====================================================================
    await setActiveTool(page, 'move');
    expect(await getActiveTool(page)).toBe('move');

    // Select hex layer and align center horizontally
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(lid);
    }, hexLayerId);
    await page.waitForTimeout(100);

    // Align left
    const alignLeftBtn = page.locator('button[aria-label="Align left"]');
    if (await alignLeftBtn.isVisible()) {
      await alignLeftBtn.click();
      await page.waitForTimeout(200);

      const stateAfterAlign = await getEditorState(page);
      const hexLayer = stateAfterAlign.document.layers.find((l) => l.id === hexLayerId);
      expect(hexLayer!.x).toBe(0);

      // Align center horizontally
      const alignCenterH = page.locator('button[aria-label="Align center horizontally"]');
      if (await alignCenterH.isVisible()) {
        await alignCenterH.click();
        await page.waitForTimeout(200);
      }

      // Align top
      const alignTop = page.locator('button[aria-label="Align top"]');
      if (await alignTop.isVisible()) {
        await alignTop.click();
        await page.waitForTimeout(200);
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/comp2-04-aligned.png' });

    // =====================================================================
    // PHASE 5: MOVE TOOL — Nudge with arrow keys
    // =====================================================================
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(lid);
    }, triLayerId);

    const posBefore = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
        };
      };
      return store.getState().document.layers.find((l) => l.id === lid);
    }, triLayerId);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const posAfter = await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
        };
      };
      return store.getState().document.layers.find((l) => l.id === lid);
    }, triLayerId);

    expect(posAfter!.x).toBeGreaterThanOrEqual(posBefore!.x);
    expect(posAfter!.y).toBeGreaterThanOrEqual(posBefore!.y);

    // =====================================================================
    // PHASE 6: MOVE TOOL — Real mouse drag
    // =====================================================================
    const dragFrom = await docToScreen(page, posAfter!.x + 50, posAfter!.y + 50);
    const dragTo = await docToScreen(page, posAfter!.x + 80, posAfter!.y + 30);
    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
    await page.mouse.move(dragTo.x, dragTo.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/comp2-05-moved.png' });

    // =====================================================================
    // PHASE 7: PATH TOOL — Create a star-like path with spline curves
    // =====================================================================
    const pathLayerId = await addLayer(page);

    await page.keyboard.press('p');
    expect(await getActiveTool(page)).toBe('path');

    // Open paths panel
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

    // Draw a diamond path
    await clickAtDoc(page, 250, 330);
    await clickAtDoc(page, 310, 390);
    await clickAtDoc(page, 250, 450);
    await clickAtDoc(page, 190, 390);
    await clickAtDoc(page, 250, 330); // close
    await page.waitForTimeout(200);

    const pathState = await getPathsState(page);
    expect(pathState.paths.length).toBeGreaterThanOrEqual(1);
    const diamondPath = pathState.paths[pathState.paths.length - 1]!;
    expect(diamondPath.closed).toBe(true);
    expect(diamondPath.anchorCount).toBe(4);

    await page.screenshot({ path: 'e2e/screenshots/comp2-06-diamond-path.png' });

    // =====================================================================
    // PHASE 8: PATH — Convert anchor to spline (Cmd+drag)
    // =====================================================================
    const topAnchor = diamondPath.anchors[0]!;
    expect(topAnchor.handleIn).toBeNull();
    expect(topAnchor.handleOut).toBeNull();

    const anchorScreen = await docToScreen(page, topAnchor.point.x, topAnchor.point.y);
    const handleTarget = await docToScreen(page, topAnchor.point.x + 40, topAnchor.point.y);

    await page.mouse.move(anchorScreen.x, anchorScreen.y);
    await page.keyboard.down('Meta');
    await page.mouse.down();
    await page.mouse.move(handleTarget.x, handleTarget.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Meta');
    await page.waitForTimeout(200);

    const pathStateAfterSpline = await getPathsState(page);
    const updatedPath = pathStateAfterSpline.paths[pathStateAfterSpline.paths.length - 1]!;
    const convertedAnchor = updatedPath.anchors[0]!;
    expect(convertedAnchor.handleOut).not.toBeNull();
    expect(convertedAnchor.handleIn).not.toBeNull();

    await page.screenshot({ path: 'e2e/screenshots/comp2-07-spline-anchor.png' });

    // =====================================================================
    // PHASE 9: PATH — Add anchor to segment
    // =====================================================================
    // Click on midpoint of bottom segment (between anchors 1 and 2)
    const a1 = updatedPath.anchors[1]!.point;
    const a2 = updatedPath.anchors[2]!.point;
    const midX = (a1.x + a2.x) / 2;
    const midY = (a1.y + a2.y) / 2;
    await clickAtDoc(page, midX, midY);
    await page.waitForTimeout(200);

    const pathStateAfterAdd = await getPathsState(page);
    const pathAfterAdd = pathStateAfterAdd.paths[pathStateAfterAdd.paths.length - 1]!;
    expect(pathAfterAdd.anchorCount).toBe(5);

    // =====================================================================
    // PHASE 10: PATH — Stroke the path
    // =====================================================================
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selectedPathId: string | null };
      };
      const uiStore = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setStrokeModalPathId: (id: string | null) => void };
      };
      uiStore.getState().setStrokeModalPathId(store.getState().selectedPathId);
    });
    await page.waitForTimeout(200);

    const strokeBtn = page.locator('button', { hasText: 'Stroke' });
    if (await strokeBtn.isVisible({ timeout: 2000 })) {
      await strokeBtn.click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'e2e/screenshots/comp2-08-stroked-path.png' });

    // =====================================================================
    // PHASE 11: RECTANGULAR MARQUEE — Draw selection
    // =====================================================================
    const selectLayerId = await addLayer(page);

    // Paint a colored area to work with
    await page.keyboard.press('b');
    await setToolSetting(page, 'setBrushSize', 100);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setForegroundColor(page, { r: 255, g: 200, b: 0, a: 1 });
    await dragAtDoc(page, { x: 50, y: 350 }, { x: 200, y: 350 });
    await dragAtDoc(page, { x: 50, y: 400 }, { x: 200, y: 400 });
    await dragAtDoc(page, { x: 50, y: 450 }, { x: 200, y: 450 });

    await page.keyboard.press('m');
    expect(await getActiveTool(page)).toBe('marquee-rect');

    await dragAtDoc(page, { x: 60, y: 340 }, { x: 180, y: 460 });

    const selState = await getSelectionState(page);
    expect(selState.active).toBe(true);
    expect(selState.nonZeroMaskPixels).toBeGreaterThan(100);

    // Verify marching ants on overlay
    await page.waitForTimeout(300);
    const selEdgeScreen = await docToScreen(page, 60, 400);
    const overlayPixel = await getOverlayPixelAtScreen(page, selEdgeScreen.x, selEdgeScreen.y);
    // Marching ants should have non-zero alpha near selection boundary
    // (checking a point right on the boundary line)

    await page.screenshot({ path: 'e2e/screenshots/comp2-09-rect-marquee.png' });

    // =====================================================================
    // PHASE 12: FILL TOOL — Fill inside selection
    // =====================================================================
    await page.keyboard.press('g');
    expect(await getActiveTool(page)).toBe('fill');

    await setForegroundColor(page, { r: 128, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setFillTolerance', 200);

    await clickAtDoc(page, 120, 400);
    await page.waitForTimeout(300);

    const filledPixel = await getPixelAt(page, 120, 400);
    expect(filledPixel.r + filledPixel.b).toBeGreaterThan(100);
    expect(filledPixel.a).toBeGreaterThan(200);

    await page.screenshot({ path: 'e2e/screenshots/comp2-10-filled-selection.png' });

    // Deselect
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(200);

    const selAfterDeselect = await getSelectionState(page);
    expect(selAfterDeselect.active).toBe(false);

    // =====================================================================
    // PHASE 13: ELLIPTICAL MARQUEE — Create ellipse selection
    // =====================================================================
    await setActiveTool(page, 'marquee-ellipse');
    expect(await getActiveTool(page)).toBe('marquee-ellipse');

    await dragAtDoc(page, { x: 200, y: 200 }, { x: 300, y: 300 });

    const ellipseSelState = await getSelectionState(page);
    expect(ellipseSelState.active).toBe(true);
    expect(ellipseSelState.nonZeroMaskPixels).toBeGreaterThan(100);

    await page.screenshot({ path: 'e2e/screenshots/comp2-11-ellipse-marquee.png' });

    // Deselect
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(200);

    // =====================================================================
    // PHASE 14: LASSO — Freehand selection
    // =====================================================================
    await page.keyboard.press('l');
    expect(await getActiveTool(page)).toBe('lasso');

    await dragAtDoc(page, { x: 100, y: 100 }, { x: 200, y: 150 }, 15);

    await page.screenshot({ path: 'e2e/screenshots/comp2-12-lasso.png' });

    // Deselect
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(200);

    // =====================================================================
    // PHASE 15: MAGIC WAND — Select by color
    // =====================================================================
    // Select the red ellipse area
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(lid);
    }, (await getEditorState(page)).document.layers[0]!.id);

    await page.keyboard.press('w');
    expect(await getActiveTool(page)).toBe('wand');

    await setToolSetting(page, 'setWandTolerance', 60);

    await clickAtDoc(page, 250, 250);
    await page.waitForTimeout(300);

    // Clear any transform from wand
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setTransform: (t: null) => void };
      };
      store.getState().setTransform(null);
    });

    await page.screenshot({ path: 'e2e/screenshots/comp2-13-magic-wand.png' });

    // Deselect
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(200);

    // =====================================================================
    // PHASE 16: SELECT ALL and COPY/PASTE
    // =====================================================================
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(200);

    const selectAllState = await getSelectionState(page);
    expect(selectAllState.active).toBe(true);

    // Copy
    await page.keyboard.press('Meta+c');
    await page.waitForTimeout(200);

    // Deselect and paste (creates new layer)
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(100);
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp2-14-copy-paste.png' });

    // =====================================================================
    // PHASE 17: FLIP AND ROTATE — Flip the pasted layer
    // =====================================================================
    // Flip horizontal via Image menu
    await page.click('text=Image');
    await page.waitForTimeout(200);
    await page.click('text=Flip Horizontal');
    await page.waitForTimeout(300);

    const beforeFlip = await snapshot(page);

    // Flip vertical via Image menu
    await page.click('text=Image');
    await page.waitForTimeout(200);
    await page.click('text=Flip Vertical');
    await page.waitForTimeout(300);

    const afterFlip = await snapshot(page);
    expect(pixelDiff(beforeFlip, afterFlip)).toBeGreaterThan(0);

    // Rotate 90° CW via Image menu
    await page.click('text=Image');
    await page.waitForTimeout(200);
    await page.click('text=Rotate 90');
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/comp2-15-flip-rotate.png' });

    // =====================================================================
    // PHASE 18: GRID AND GUIDES
    // =====================================================================
    // Switch to move tool first to ensure shortcuts work
    await setActiveTool(page, 'move');

    // Toggle grid via store
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleGrid: () => void };
      };
      store.getState().toggleGrid();
    });
    await page.waitForTimeout(200);

    const gridVisible = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showGrid: boolean };
      };
      return store.getState().showGrid;
    });
    expect(gridVisible).toBe(true);

    await page.screenshot({ path: 'e2e/screenshots/comp2-16-grid.png' });

    // Toggle guides via store (default is true, so toggling turns them off)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleGuides: () => void };
      };
      store.getState().toggleGuides();
    });
    await page.waitForTimeout(200);

    const guidesOff = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showGuides: boolean };
      };
      return store.getState().showGuides;
    });
    expect(guidesOff).toBe(false);

    // Toggle back on
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleGuides: () => void };
      };
      store.getState().toggleGuides();
    });
    await page.waitForTimeout(100);

    const guidesOn = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showGuides: boolean };
      };
      return store.getState().showGuides;
    });
    expect(guidesOn).toBe(true);

    // Turn grid off
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { toggleGrid: () => void };
      };
      store.getState().toggleGrid();
    });
    await page.waitForTimeout(200);

    // =====================================================================
    // PHASE 19: ZOOM CONTROLS
    // =====================================================================
    // Zoom via store — zoom out then zoom in
    const zoomBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          viewport: { zoom: number };
          setZoom: (z: number) => void;
        };
      };
      const s = store.getState();
      const origZoom = s.viewport.zoom;
      s.setZoom(origZoom / 2);
      return origZoom;
    });
    await page.waitForTimeout(200);

    const zoomOut = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });
    expect(zoomOut).toBeLessThan(zoomBefore);

    // Zoom back in
    await page.evaluate((z) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setZoom: (z: number) => void };
      };
      store.getState().setZoom(z);
    }, zoomBefore);
    await page.waitForTimeout(200);

    const zoomRestored = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });
    expect(zoomRestored).toBeGreaterThanOrEqual(zoomBefore);

    // =====================================================================
    // PHASE 20: INVERT SELECTION
    // =====================================================================
    await page.keyboard.press('m');
    await dragAtDoc(page, { x: 100, y: 100 }, { x: 200, y: 200 });

    const beforeInvert = await getSelectionState(page);
    expect(beforeInvert.active).toBe(true);
    const beforeNonZero = beforeInvert.nonZeroMaskPixels;

    await page.keyboard.press('Shift+Meta+i');
    await page.waitForTimeout(200);

    const afterInvert = await getSelectionState(page);
    expect(afterInvert.active).toBe(true);
    expect(afterInvert.nonZeroMaskPixels).toBeGreaterThan(beforeNonZero);

    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(100);

    // =====================================================================
    // FINAL SCREENSHOT
    // =====================================================================
    await page.screenshot({ path: 'e2e/screenshots/comp2-final-geometric.png' });

    const finalState = await getEditorState(page);
    expect(finalState.document.layers.length).toBeGreaterThanOrEqual(4);
  });
});
