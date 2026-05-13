/**
 * E2E test for the Quick Selection tool.
 *
 * Strategy:
 *  1. Create a 200×200 document with two distinct solid-color regions
 *     (left half red, right half blue), painted via updateLayerPixelData.
 *  2. Activate the Quick Selection tool and drag it over the red region.
 *  3. Verify that:
 *     - A selection is created.
 *     - Pixels clearly inside the red region are within the selection bounds.
 *     - Pixels clearly inside the blue region are outside the selection.
 *  4. Screenshot before and after.
 */

import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

// ---------------------------------------------------------------------------
// Helpers shared across tests
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

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const sel = state.selection as {
      active: boolean;
      mask: number[] | null;
      maskWidth: number;
      maskHeight: number;
      bounds: { x: number; y: number; width: number; height: number } | null;
    };
    return {
      active: sel.active,
      bounds: sel.bounds,
      maskWidth: sel.maskWidth,
      maskHeight: sel.maskHeight,
      // Spot-check a handful of pixels in the mask rather than transferring
      // the whole mask across the IPC boundary.
      mask: sel.mask,
    };
  });
}

/** Read a single pixel from the selection mask at doc coordinates. */
async function getSelectionMaskAt(
  page: Page,
  docX: number,
  docY: number,
): Promise<number> {
  return page.evaluate(
    ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, unknown>;
      };
      const state = store.getState();
      const sel = state.selection as {
        mask: Uint8ClampedArray | null;
        maskWidth: number;
        maskHeight: number;
      };
      if (!sel.mask) return 0;
      const idx = docY * sel.maskWidth + docX;
      return sel.mask[idx] ?? 0;
    },
    { docX, docY },
  );
}

/**
 * Paint two solid-color half-rectangles into the active layer using a single
 * updateLayerPixelData call (avoids the auto-crop double-paint pitfall).
 */
async function paintTwoHalves(
  page: Page,
  docWidth: number,
  docHeight: number,
  leftColor: { r: number; g: number; b: number },
  rightColor: { r: number; g: number; b: number },
): Promise<void> {
  await page.evaluate(
    ({ docWidth, docHeight, leftColor, rightColor }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      state.pushHistory('paint-two-halves');
      const data = new ImageData(docWidth, docHeight);
      const half = Math.floor(docWidth / 2);
      for (let y = 0; y < docHeight; y++) {
        for (let x = 0; x < docWidth; x++) {
          const idx = (y * docWidth + x) * 4;
          const c = x < half ? leftColor : rightColor;
          data.data[idx] = c.r;
          data.data[idx + 1] = c.g;
          data.data[idx + 2] = c.b;
          data.data[idx + 3] = 255;
        }
      }
      state.updateLayerPixelData(state.document.activeLayerId, data);
    },
    { docWidth, docHeight, leftColor, rightColor },
  );
  // Let the engine sync tick flush pixels to the GPU texture.
  await page.waitForTimeout(300);
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
// ---------------------------------------------------------------------------

test.describe('Quick Selection tool', () => {
  test('selects the red half of a two-color image without crossing into the blue half', async ({ page }) => {
    const DOC_W = 200;
    const DOC_H = 200;

    await createDocument(page, DOC_W, DOC_H, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Paint: left half = red, right half = blue
    await paintTwoHalves(
      page, DOC_W, DOC_H,
      { r: 220, g: 30, b: 30 },
      { r: 30, g: 30, b: 220 },
    );

    // Screenshot: the two-color source image before selection
    await page.screenshot({ path: 'e2e/screenshots/quick-selection-before.png' });

    // Activate Quick Selection tool via keyboard shortcut
    await page.locator('[data-tool-id="quick-select"]').click();
    await page.waitForTimeout(100);

    // Configure settings via the store so we don't rely on the sliders UI
    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setQuickSelectSize: (v: number) => void;
          setQuickSelectTolerance: (v: number) => void;
          setQuickSelectEdgeStrength: (v: number) => void;
          setQuickSelectMode: (m: 'add' | 'subtract') => void;
        };
      };
      const state = ts.getState();
      state.setQuickSelectSize(15);
      state.setQuickSelectTolerance(60);
      state.setQuickSelectEdgeStrength(80);
      state.setQuickSelectMode('add');
    });

    // Drag across the red half (stay well away from the center boundary)
    const startDoc = { x: 30, y: 100 };
    const endDoc = { x: 80, y: 100 };
    const start = await docToScreen(page, startDoc.x, startDoc.y);
    const end = await docToScreen(page, endDoc.x, endDoc.y);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Screenshot: canvas with marching ants around the red half selection
    await page.screenshot({ path: 'e2e/screenshots/quick-selection-after.png' });

    // -------------------------------------------------------------------------
    // Assertions
    // -------------------------------------------------------------------------

    const sel = await getSelectionState(page);
    expect(sel.active, 'selection should be active after dragging Quick Selection').toBe(true);
    expect(sel.bounds, 'selection bounds should be non-null').not.toBeNull();

    // Selection bounds must be within the left (red) half of the document
    expect(sel.bounds!.x, 'selection left edge should be in red half').toBeLessThan(DOC_W / 2);
    expect(
      sel.bounds!.x + sel.bounds!.width,
      'selection should not extend into the blue half (right side > doc-center)',
    ).toBeLessThanOrEqual(DOC_W / 2 + 5); // +5px tolerance for edge pixels

    // The center of the red half (25, 100) should be selected
    const redMidSelected = await getSelectionMaskAt(page, 25, 100);
    expect(redMidSelected, 'center of red half should be selected').toBeGreaterThan(0);

    // A pixel well inside the blue half (170, 100) should NOT be selected
    const blueMidSelected = await getSelectionMaskAt(page, 170, 100);
    expect(blueMidSelected, 'center of blue half should not be selected').toBe(0);
  });

  test('subtract mode removes pixels from an existing selection', async ({ page }) => {
    const DOC_W = 200;
    const DOC_H = 200;

    await createDocument(page, DOC_W, DOC_H, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Solid red image
    await paintTwoHalves(
      page, DOC_W, DOC_H,
      { r: 220, g: 30, b: 30 },
      { r: 220, g: 30, b: 30 },
    );

    await page.locator('[data-tool-id="quick-select"]').click();
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setQuickSelectSize: (v: number) => void;
          setQuickSelectTolerance: (v: number) => void;
          setQuickSelectEdgeStrength: (v: number) => void;
          setQuickSelectMode: (m: 'add' | 'subtract') => void;
        };
      };
      const state = ts.getState();
      state.setQuickSelectSize(20);
      state.setQuickSelectTolerance(50);
      state.setQuickSelectEdgeStrength(0);
      state.setQuickSelectMode('add');
    });

    // First stroke: add — drag across the left portion
    const addStart = await docToScreen(page, 20, 100);
    const addEnd = await docToScreen(page, 90, 100);
    await page.mouse.move(addStart.x, addStart.y);
    await page.mouse.down();
    await page.mouse.move(addEnd.x, addEnd.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const afterAdd = await getSelectionState(page);
    expect(afterAdd.active, 'selection should be active after add stroke').toBe(true);
    const addedCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, unknown>;
      };
      const sel = (store.getState().selection as { mask: number[] | null });
      if (!sel.mask) return 0;
      return sel.mask.filter((v) => v > 0).length;
    });
    expect(addedCount).toBeGreaterThan(0);

    // Switch to subtract mode
    await page.evaluate(() => {
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setQuickSelectMode: (m: 'add' | 'subtract') => void };
      };
      ts.getState().setQuickSelectMode('subtract');
    });

    // Second stroke: subtract — drag over the center of the added region
    const subStart = await docToScreen(page, 50, 100);
    const subEnd = await docToScreen(page, 70, 100);
    await page.mouse.move(subStart.x, subStart.y);
    await page.mouse.down();
    await page.mouse.move(subEnd.x, subEnd.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const subtractedCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, unknown>;
      };
      const sel = (store.getState().selection as { mask: number[] | null });
      if (!sel.mask) return 0;
      return sel.mask.filter((v) => v > 0).length;
    });

    expect(subtractedCount, 'subtract stroke should reduce selected pixel count').toBeLessThan(addedCount);

    await page.screenshot({ path: 'e2e/screenshots/quick-selection-subtract.png' });
  });
});
