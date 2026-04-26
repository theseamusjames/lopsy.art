/**
 * Regression: text layer + brush stroke + undo + redo + merge down
 *
 * After painting on a text layer, undoing, redoing, and merging down,
 * the text content should remain visible in the merged result.
 * The bug requires render frames between redo and merge so that
 * syncLayers pushes the layer descriptor to the engine.
 */
import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width: number, height: number) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, true);
    },
    { w: width, h: height },
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

/** Count non-transparent pixels in a specific layer's GPU texture. */
async function countLayerOpaquePixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await fn(lid);
    if (!result || result.width === 0) return 0;
    let count = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      if ((result.pixels[i]! > 0)) count++;
    }
    return count;
  }, layerId);
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Text + brush + merge down', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
    await createDocument(page, 200, 200);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('text survives undo → redo → merge down after brush stroke', async ({ page }) => {
    const bgId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: Array<{ id: string }> } };
      };
      return store.getState().document.layers[0]!.id;
    });

    // --- 1. Add text layer with red "XY" past the halfway point ---
    // Placing text past (100, 100) on a 200x200 doc means if the
    // position gets doubled during merge (the bug), content falls
    // off the bottom layer's texture and disappears.
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('text');
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setTextFontSize: (s: number) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      const s = ts.getState();
      s.setTextFontSize(40);
      s.setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
    });

    const textPos = await docToScreen(page, 110, 110);
    await page.mouse.click(textPos.x, textPos.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('XY');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    // Get the rasterized text layer ID and verify it has content
    const textId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string; name: string }> };
        };
      };
      // Text layers are rasterized on commit — find by name
      return store.getState().document.layers.find((l) => l.type === 'raster' && l.name.startsWith('Text'))?.id ?? '';
    });
    expect(textId).not.toBe('');

    const textPixels = await countLayerOpaquePixels(page, textId);
    expect(textPixels).toBeGreaterThan(50);

    // --- 2. Switch to brush and paint on the text layer ---
    await page.evaluate((id: string) => {
      const editor = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      editor.getState().setActiveLayer(id);
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      ui.getState().setActiveTool('brush');
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setBrushSize: (s: number) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      const s = ts.getState();
      s.setBrushSize(8);
      s.setForegroundColor({ r: 0, g: 0, b: 255, a: 1 });
    }, textId);

    // Paint a stroke in the corner (away from text)
    const from = await docToScreen(page, 20, 20);
    const to = await docToScreen(page, 40, 40);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // --- 3. Undo → Redo → Merge down via keyboard shortcuts ---
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForTimeout(300);

    await page.keyboard.press(`${mod}+Shift+KeyZ`);
    await page.waitForTimeout(300);

    // Ensure text layer is active before merge
    await page.evaluate((id: string) => {
      const editor = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      editor.getState().setActiveLayer(id);
    }, textId);
    await page.waitForTimeout(100);

    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForTimeout(300);

    // --- 4. Verify ---
    await page.screenshot({ path: 'e2e/screenshots/text-brush-merge-after.png' });

    // Text layer should be gone (merged into background)
    const textLayerGone = await page.evaluate((tid: string) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string }> };
        };
      };
      return !store.getState().document.layers.some((l) => l.id === tid);
    }, textId);
    expect(textLayerGone).toBe(true);

    // The background layer must contain the merged text content.
    // Before the fix, the text position was doubled during merge,
    // pushing it off the 200x200 canvas.
    const mergedPixels = await countLayerOpaquePixels(page, bgId);
    expect(mergedPixels).toBeGreaterThanOrEqual(textPixels * 0.8);
  });
});
