/**
 * E2E tests for the text-on-path feature.
 *
 * Verifies that text layers with a pathId render their glyphs along the
 * associated Bezier path rather than in a straight horizontal line.
 */

import { test, expect, type Page } from './fixtures';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots/text-on-path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
    undefined,
    { timeout: 15000 },
  );
}

async function createDocument(page: Page, w = 400, h = 400, transparent = true) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w, h, t: transparent },
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
  await page.waitForTimeout(80);
}

/** Inject a stored path directly via the store (no pen-tool UI required). */
async function injectPath(
  page: Page,
  anchors: Array<{
    point: { x: number; y: number };
    handleIn: { x: number; y: number } | null;
    handleOut: { x: number; y: number } | null;
  }>,
  closed: boolean,
) {
  return page.evaluate(
    ({ anchors, closed }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          addPath: (anchors: unknown, closed: boolean) => void;
          paths: Array<{ id: string }>;
        };
      };
      store.getState().addPath(anchors, closed);
      const paths = store.getState().paths;
      return paths[paths.length - 1]!.id;
    },
    { anchors, closed },
  );
}

/** Create a text layer on a path via the store. */
async function createTextLayerOnPath(
  page: Page,
  text: string,
  pathId: string,
  x = 50,
  y = 50,
) {
  return page.evaluate(
    ({ text, pathId, x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
          addTextLayer: (layer: unknown) => void;
          updateTextLayerProperties: (id: string, props: unknown) => void;
          notifyRender: () => void;
        };
      };
      const state = store.getState();
      const id = crypto.randomUUID();
      state.addTextLayer({
        id,
        name: 'Path Text',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x,
        y,
        clipToBelow: false,
        effects: {
          stroke: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, position: 'outside' },
          dropShadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 0.75 },
          outerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
          innerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
          colorOverlay: { enabled: false, color: { r: 255, g: 0, b: 0, a: 1 } },
        },
        mask: null,
        text,
        fontFamily: 'Inter',
        fontSize: 20,
        fontWeight: 400,
        fontStyle: 'normal',
        color: { r: 0, g: 0, b: 0, a: 1 },
        lineHeight: 1.4,
        letterSpacing: 0,
        textAlign: 'left',
        width: null,
        pathId,
      });
      state.notifyRender();
      return id;
    },
    { text, pathId, x, y },
  );
}

async function readLayerPixels(page: Page, layerId: string) {
  return page.evaluate(async (id) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    return fn(id);
  }, layerId);
}

async function pushHistory(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory();
  });
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Helpers to scan for non-transparent pixels in a horizontal band
// ---------------------------------------------------------------------------

/**
 * Returns the set of distinct Y coordinates (in doc space) that have at least
 * one opaque pixel in the column range [x0, x1].
 *
 * We read from the composited GPU buffer which reflects the full rendered
 * scene (including the path-text layer pixels).
 */
async function opaqueRowsInBand(
  page: Page,
  docX0: number,
  docX1: number,
  docY0: number,
  docY1: number,
): Promise<number[]> {
  return page.evaluate(
    async ({ x0, x1, y0, y1 }) => {
      const fn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const frame = await fn();
      if (!frame) return [];
      const { width, height, pixels } = frame;
      const rows = new Set<number>();
      for (let y = y0; y <= y1 && y < height; y++) {
        // Buffer is bottom-up; flip y
        const flippedY = height - 1 - y;
        for (let x = x0; x <= x1 && x < width; x++) {
          const idx = (flippedY * width + x) * 4;
          const alpha = pixels[idx + 3] ?? 0;
          if (alpha > 10) {
            rows.add(y);
            break;
          }
        }
      }
      return Array.from(rows);
    },
    { x0: docX0, x1: docX1, y0: docY0, y1: docY1 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Text on Path', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text-on-path requires desktop sidebar');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('text layer with pathId renders pixels along a curved path', async ({ page }) => {
    // Create a diagonal path from (50, 200) to (350, 200) going through a
    // curve peak at (200, 50) — effectively an arc that goes upward.
    const pathId = await injectPath(
      page,
      [
        {
          point: { x: 50, y: 200 },
          handleIn: null,
          handleOut: { x: 100, y: 50 },
        },
        {
          point: { x: 350, y: 200 },
          handleIn: { x: 300, y: 50 },
          handleOut: null,
        },
      ],
      false,
    );

    const layerId = await createTextLayerOnPath(page, 'Hello Path', pathId, 0, 0);
    await page.waitForTimeout(300); // allow render frame to pick up the layer

    // Force a history push so the GPU texture is settled
    await pushHistory(page);

    const result = await readLayerPixels(page, layerId);
    expect(result).not.toBeNull();
    expect(result!.width).toBeGreaterThan(0);

    // Count pixels with non-zero alpha
    const opaqueCount = result!.pixels.filter((v, i) => i % 4 === 3 && v > 10).length;
    expect(opaqueCount).toBeGreaterThan(0);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-text-on-curved-path.png'),
    });
  });

  test('text layer without pathId renders as normal straight text', async ({ page }) => {
    // Create a path but do NOT assign it to the text layer
    await injectPath(
      page,
      [
        { point: { x: 50, y: 100 }, handleIn: null, handleOut: null },
        { point: { x: 350, y: 100 }, handleIn: null, handleOut: null },
      ],
      false,
    );

    // Normal text layer — no pathId
    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          addTextLayer: (layer: unknown) => void;
          notifyRender: () => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = crypto.randomUUID();
      state.addTextLayer({
        id,
        name: 'Normal Text',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 100,
        y: 200,
        clipToBelow: false,
        effects: {
          stroke: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, width: 2, position: 'outside' },
          dropShadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 0.75 },
          outerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
          innerGlow: { enabled: false, color: { r: 255, g: 255, b: 100, a: 1 }, size: 10, spread: 0, opacity: 0.75 },
          colorOverlay: { enabled: false, color: { r: 255, g: 0, b: 0, a: 1 } },
        },
        mask: null,
        text: 'Hello',
        fontFamily: 'Inter',
        fontSize: 20,
        fontWeight: 400,
        fontStyle: 'normal',
        color: { r: 0, g: 0, b: 0, a: 1 },
        lineHeight: 1.4,
        letterSpacing: 0,
        textAlign: 'left',
        width: null,
        // no pathId
      });
      state.notifyRender();
      return id;
    });

    await page.waitForTimeout(300);

    // Verify the layer has no pathId set
    const layerPathId = await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string; pathId?: string }> };
        };
      };
      const layer = store.getState().document.layers.find((l) => l.id === id);
      return layer?.type === 'text' ? (layer as { pathId?: string }).pathId : null;
    }, layerId);

    expect(layerPathId).toBeUndefined();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-normal-text-no-path.png'),
    });
  });

  test('path text option dropdown appears in TextOptions when paths exist', async ({ page }) => {
    // Create a stored path
    await injectPath(
      page,
      [
        { point: { x: 50, y: 100 }, handleIn: null, handleOut: null },
        { point: { x: 350, y: 100 }, handleIn: null, handleOut: null },
      ],
      false,
    );

    // Switch to text tool so TextOptions renders
    await page.keyboard.press('t');
    await page.waitForTimeout(200);

    // The "Path" label and dropdown should appear since paths exist
    const pathLabel = page.locator('label', { hasText: 'Path' });
    await expect(pathLabel).toBeVisible();

    const pathSelect = page.locator('select[aria-label="Text path"]');
    await expect(pathSelect).toBeVisible();

    // The dropdown should include "None" option and the created path
    const optionCount = await pathSelect.locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(2); // None + at least one path

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-text-options-path-dropdown.png'),
    });
  });

  test('assigning a path via the dropdown updates the text layer pathId', async ({ page }) => {
    // Create a path then a text layer via the text tool
    const pathId = await injectPath(
      page,
      [
        { point: { x: 50, y: 200 }, handleIn: null, handleOut: null },
        { point: { x: 350, y: 200 }, handleIn: null, handleOut: null },
      ],
      false,
    );

    // Select the text tool and click to create a text layer
    await page.keyboard.press('t');
    await page.waitForTimeout(100);
    await clickAtDoc(page, 200, 200);
    await page.keyboard.type('On Path');
    await page.keyboard.press('Shift+Enter'); // commit
    await page.waitForTimeout(200);

    // Get the committed layer id
    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string; type: string }> } };
      };
      const layers = store.getState().document.layers;
      const tl = layers.find((l) => l.type === 'text');
      return tl?.id ?? null;
    });
    expect(layerId).not.toBeNull();

    // Select the layer and switch to text tool so the options bar shows
    await page.keyboard.press('t');
    await page.waitForTimeout(100);

    // The path dropdown should be present
    const pathSelect = page.locator('select[aria-label="Text path"]');
    await expect(pathSelect).toBeVisible();

    // Select the first path (not "None")
    await pathSelect.selectOption(pathId);
    await page.waitForTimeout(200);

    // Verify the layer has the pathId set
    const actualPathId = await page.evaluate((id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{ id: string; type: string; pathId?: string }>;
          };
        };
      };
      const layer = store.getState().document.layers.find((l) => l.id === id);
      return layer?.type === 'text' ? (layer as { pathId?: string }).pathId ?? null : null;
    }, layerId!);

    expect(actualPathId).toBe(pathId);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-text-layer-path-id-assigned.png'),
    });
  });

  test('path text with diagonal path has pixels at multiple Y positions (not a straight line)', async ({
    page,
  }) => {
    // A diagonal path from top-left to bottom-right forces glyphs to spread
    // vertically — proves text is NOT rendering on a flat horizontal baseline.
    const pathId = await injectPath(
      page,
      [
        { point: { x: 50, y: 50 }, handleIn: null, handleOut: null },
        { point: { x: 350, y: 350 }, handleIn: null, handleOut: null },
      ],
      false,
    );

    await createTextLayerOnPath(page, 'ABCDE', pathId, 0, 0);
    await page.waitForTimeout(400);

    // Read composited pixels and find the unique Y rows where opaque pixels appear
    // in the diagonal region (roughly 50..350 on both axes).
    const rows = await opaqueRowsInBand(page, 50, 350, 50, 350);

    // If text were rendering in a horizontal line, all glyphs would share the
    // same Y row. A diagonal path should produce glyphs at many distinct Y values.
    expect(rows.length).toBeGreaterThan(3);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-diagonal-path-text-spread.png'),
    });
  });
});
