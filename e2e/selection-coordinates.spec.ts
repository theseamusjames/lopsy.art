import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import {
  createDocument,
  waitForStore,
  getEditorState,
  getPixelAt,
  addLayer,
  moveLayerTo,
  drawRect,
} from './helpers';

interface SelectionInfo {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

async function getSelection(page: Page): Promise<SelectionInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          bounds: { x: number; y: number; width: number; height: number } | null;
        };
      };
    };
    const sel = store.getState().selection;
    return { active: sel.active, bounds: sel.bounds };
  });
}

// ---------------------------------------------------------------------------
// Helpers — drive the real wand and fill tools via mouse events on the
// canvas. These exercise the GPU flood-fill path in misc-handlers.ts and
// selection-handlers.ts (the production code), not test-local copies.
// ---------------------------------------------------------------------------

const toolShortcuts: Record<string, string> = {
  'move': 'v',
  'brush': 'b',
  'fill': 'g',
  'shape': 'u',
  'text': 't',
  'eraser': 'e',
  'marquee-rect': 'm',
  'wand': 'w',
};

async function setActiveTool(page: Page, tool: string): Promise<void> {
  const shortcut = toolShortcuts[tool];
  if (shortcut) {
    await page.keyboard.press(shortcut);
  } else {
    await page.locator(`[data-tool-id="${tool}"]`).click();
  }
  await page.waitForTimeout(50);
}

async function setForegroundColor(page: Page, color: { r: number; g: number; b: number; a: number }): Promise<void> {
  await page.evaluate((c) => {
    const tool = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
    };
    tool.getState().setForegroundColor(c);
  }, color);
}

async function docToScreen(page: Page, docX: number, docY: number) {
  return page.evaluate(({ x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    const rect = container.getBoundingClientRect();
    const sx = (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + rect.width / 2;
    const sy = (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + rect.height / 2;
    return { x: rect.left + sx, y: rect.top + sy };
  }, { x: docX, y: docY });
}

/**
 * Click on the canvas at a doc coordinate. Used to trigger single-click
 * tools (wand, fill) via real mouse events.
 */
async function clickAtDoc(page: Page, docX: number, docY: number): Promise<void> {
  const { x, y } = await docToScreen(page, docX, docY);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// Read a single composited screen pixel at a doc coordinate.
async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    // The composited buffer is in screen pixels. Project doc → screen.
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    // The composited buffer is read with gl.readPixels, which returns
    // bottom-up image data. Flip y to read the right row.
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ===========================================================================
// Magic Wand + Fill on Offset Layer
// ===========================================================================

test.describe('Selection coordinates with layer offset', () => {
  test('wand on a moved layer selects the colour at the click point in document space', async ({ page }) => {
    // 200×200 transparent doc with a single Background layer.
    await createDocument(page, 200, 200, true);

    // Paint a 60×60 red square at layer-local (60, 60)..(120, 120).
    // Auto-crop runs after paint, leaving the layer cropped to those bounds.
    await drawRect(page, 60, 60, 60, 60, { r: 255, g: 0, b: 0 });

    // Now move the cropped layer down by 20 doc px so the red square sits
    // at doc (60, 80)..(120, 140) instead of (60, 60)..(120, 120).
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;
    await moveLayerTo(page, layerId, 80, 80); // top-left of cropped layer in doc coords

    // Switch to the wand tool and click on the red square in document
    // space — at doc (90, 110), the centre of the square's new position.
    await setActiveTool(page, 'wand');
    await clickAtDoc(page, 90, 110);

    // The wand must have produced a selection that covers ~60×60 = 3600
    // pixels — the size of the red square.
    const sel = await getSelection(page);
    expect(sel.active).toBe(true);
    expect(sel.bounds).not.toBeNull();
    const bounds = sel.bounds!;
    // The selection bounds in doc space should hug the moved square.
    expect(bounds.x).toBeGreaterThanOrEqual(78);
    expect(bounds.x).toBeLessThanOrEqual(82);
    expect(bounds.y).toBeGreaterThanOrEqual(78);
    expect(bounds.y).toBeLessThanOrEqual(82);
    expect(bounds.width).toBeGreaterThanOrEqual(58);
    expect(bounds.width).toBeLessThanOrEqual(62);
    expect(bounds.height).toBeGreaterThanOrEqual(58);
    expect(bounds.height).toBeLessThanOrEqual(62);
  });

  test('fill tool fills only inside the active selection bounds', async ({ page }) => {
    // 100×100 transparent doc.
    await createDocument(page, 100, 100, true);

    // Paint a 40×40 red square at doc (30, 30).
    await drawRect(page, 30, 30, 40, 40, { r: 255, g: 0, b: 0 });

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Add a new layer ABOVE so the fill goes onto an empty layer.
    await addLayer(page);
    await page.waitForTimeout(100);
    const s1 = await getEditorState(page);
    const fillLayerId = s1.document.activeLayerId;
    expect(fillLayerId).not.toBe(bgId);

    // Use the wand to select all the empty area on the background layer.
    // First switch back to the bg layer, then click outside the red square
    // to wand-select the transparent region.
    await page.locator(`[data-layer-id="${bgId}"]`).click();
    await page.waitForTimeout(50);

    await setActiveTool(page, 'wand');
    await clickAtDoc(page, 5, 5);
    await page.waitForTimeout(150);

    const sWand = await getSelection(page);
    expect(sWand.active).toBe(true);

    // Now switch back to the empty fill layer and apply a green fill via
    // the bucket tool. The fill must respect the active selection mask
    // (selection-handlers.ts intersects fillMask with selection mask).
    await page.locator(`[data-layer-id="${fillLayerId}"]`).click();
    await page.waitForTimeout(200); // let engine sync the layer

    await setForegroundColor(page, { r: 0, g: 255, b: 0, a: 1 });
    await setActiveTool(page, 'fill');
    // The wand also wires up a transform overlay (handles around the
    // selection bounds). The fill click must NOT land on a handle or it
    // will be intercepted by the transform handler. Clear the transform
    // so only the selection mask remains.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setTransform: (t: null) => void };
      };
      ui.getState().setTransform(null);
    });
    await page.waitForTimeout(50);
    // Click outside the red square (in the area selected by the wand).
    await clickAtDoc(page, 5, 5);
    await page.waitForTimeout(300);

    // Pixels OUTSIDE the red square (in the selection) must now be green
    // on the fill layer. Read via getPixelAt against the fill layer.
    const outside = await getPixelAt(page, 5, 5, fillLayerId);
    expect(outside.g).toBe(255);
    expect(outside.a).toBe(255);

    const oppositeCorner = await getPixelAt(page, 95, 95, fillLayerId);
    expect(oppositeCorner.g).toBe(255);
    expect(oppositeCorner.a).toBe(255);

    // Pixels INSIDE the red square's doc-space bounds must NOT be green
    // on the fill layer (the selection excluded them).
    const inside = await getPixelAt(page, 50, 50, fillLayerId);
    expect(inside.a).toBe(0);
  });

  test('full-canvas selection fills every pixel of a new layer', async ({ page }) => {
    // 100×100 doc with the background painted red, then moved off-canvas
    // to ensure layer offsets do not affect a doc-space full selection.
    await createDocument(page, 100, 100, true);
    await drawRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0 });

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;
    await moveLayerTo(page, bgId, -75, -75);

    // Use a marquee-rect drag covering the whole document to create a
    // doc-space full selection via the real selection tool.
    await setActiveTool(page, 'marquee-rect');
    const start = await docToScreen(page, 0, 0);
    const end = await docToScreen(page, 100, 100);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const sSel = await getSelection(page);
    expect(sSel.active).toBe(true);

    // Add a new layer above and use the bucket tool with green to fill it.
    await addLayer(page);
    await page.waitForTimeout(50);
    const s1 = await getEditorState(page);
    const fillLayerId = s1.document.activeLayerId;

    await setForegroundColor(page, { r: 0, g: 0, b: 255, a: 1 });
    await setActiveTool(page, 'fill');
    await clickAtDoc(page, 50, 50);
    await page.waitForTimeout(200);

    // Every corner and the centre of the new layer must be blue.
    for (const [x, y] of [[0, 0], [99, 0], [0, 99], [99, 99], [50, 50]]) {
      const px = await getPixelAt(page, x!, y!, fillLayerId);
      expect(px.b, `pixel(${x},${y}).b`).toBe(255);
      expect(px.a, `pixel(${x},${y}).a`).toBe(255);
    }
  });
});
