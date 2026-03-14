import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
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

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const doc = state.document as {
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
    return {
      document: doc,
      undoStack: (state.undoStack as unknown[]).length,
      redoStack: (state.redoStack as unknown[]).length,
    };
  });
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    ({ x, y, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          layerPixelData: Map<string, ImageData>;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const data = state.layerPixelData.get(id);
      if (!data) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (y * data.width + x) * 4;
      return {
        r: data.data[idx] ?? 0,
        g: data.data[idx + 1] ?? 0,
        b: data.data[idx + 2] ?? 0,
        a: data.data[idx + 3] ?? 0,
      };
    },
    { x, y, lid: layerId ?? null },
  );
}

async function paintRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number },
  layerId?: string,
) {
  await page.evaluate(
    ({ x, y, w, h, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);
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
      state.updateLayerPixelData(id, data);
    },
    { x, y, w, h, color, lid: layerId ?? null },
  );
}

async function addLayer(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addLayer: () => void };
    };
    store.getState().addLayer();
  });
}

async function setActiveLayer(page: Page, layerId: string) {
  await page.evaluate(
    (id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(id);
    },
    layerId,
  );
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { createDocument: (w: number, h: number, transparent: boolean) => void };
    };
    store.getState().createDocument(400, 300, false);
  });
  await page.waitForSelector('[data-testid="canvas-container"]');
});

// ===========================================================================
// Merge Down
// ===========================================================================

test.describe('Merge Down', () => {
  test('merges top layer onto bottom layer', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const state0 = await getEditorState(page);
    const bgId = state0.document.layers[0]!.id;

    // Paint red on background
    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Add layer, paint blue
    await addLayer(page);
    const state1 = await getEditorState(page);
    const topId = state1.document.activeLayerId;
    await paintRect(page, 25, 25, 50, 50, { r: 0, g: 0, b: 255, a: 255 }, topId);

    // Merge down (Cmd+E)
    await page.keyboard.press(`${mod}+KeyE`);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(1);
    expect(after.document.activeLayerId).toBe(bgId);

    // Top-left (only red was there)
    const redPixel = await getPixelAt(page, 10, 10, bgId);
    expect(redPixel.r).toBe(255);
    expect(redPixel.g).toBe(0);
    expect(redPixel.b).toBe(0);
    expect(redPixel.a).toBe(255);

    // Bottom-right (only blue was there)
    const bluePixel = await getPixelAt(page, 60, 60, bgId);
    expect(bluePixel.r).toBe(0);
    expect(bluePixel.g).toBe(0);
    expect(bluePixel.b).toBe(255);
    expect(bluePixel.a).toBe(255);

    // Overlap region (blue on top of red)
    const overlapPixel = await getPixelAt(page, 30, 30, bgId);
    expect(overlapPixel.b).toBe(255);
    expect(overlapPixel.a).toBe(255);
  });

  test('undo after merge down restores both layers', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const state0 = await getEditorState(page);
    const bgId = state0.document.layers[0]!.id;

    // Paint red on background
    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Add layer, paint green
    await addLayer(page);
    const state1 = await getEditorState(page);
    const topId = state1.document.activeLayerId;
    await paintRect(page, 50, 50, 50, 50, { r: 0, g: 255, b: 0, a: 255 }, topId);

    // Verify pre-merge state
    expect(state1.document.layers).toHaveLength(2);

    // Merge down
    await page.keyboard.press(`${mod}+KeyE`);
    const merged = await getEditorState(page);
    expect(merged.document.layers).toHaveLength(1);

    // Undo
    await page.keyboard.press(`${mod}+KeyZ`);

    const undone = await getEditorState(page);
    expect(undone.document.layers).toHaveLength(2);
    expect(undone.document.layerOrder).toHaveLength(2);

    // Verify the background layer has its original red content
    const bgPixel = await getPixelAt(page, 10, 10, bgId);
    expect(bgPixel.r).toBe(255);
    expect(bgPixel.g).toBe(0);
    expect(bgPixel.b).toBe(0);
    expect(bgPixel.a).toBe(255);

    // Background should NOT have green in the bottom-right
    const bgNoGreen = await getPixelAt(page, 60, 60, bgId);
    expect(bgNoGreen.a).toBe(0);

    // Verify the top layer still has its green content
    const topPixel = await getPixelAt(page, 60, 60, topId);
    expect(topPixel.r).toBe(0);
    expect(topPixel.g).toBe(255);
    expect(topPixel.b).toBe(0);
    expect(topPixel.a).toBe(255);

    // Top layer should NOT have red
    const topNoRed = await getPixelAt(page, 10, 10, topId);
    expect(topNoRed.a).toBe(0);
  });

  test('redo after undo re-applies merge', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const state0 = await getEditorState(page);
    const bgId = state0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    await addLayer(page);
    const state1 = await getEditorState(page);
    const topId = state1.document.activeLayerId;
    await paintRect(page, 0, 0, 100, 100, { r: 0, g: 0, b: 255, a: 128 }, topId);

    // Merge, undo, redo
    await page.keyboard.press(`${mod}+KeyE`);
    await page.keyboard.press(`${mod}+KeyZ`);

    const undone = await getEditorState(page);
    expect(undone.document.layers).toHaveLength(2);

    await page.keyboard.press(`${mod}+Shift+KeyZ`);

    const redone = await getEditorState(page);
    expect(redone.document.layers).toHaveLength(1);
    expect(redone.document.activeLayerId).toBe(bgId);
  });

  test('merge down with multiple layers only merges active onto one below', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Add layer 2
    await addLayer(page);
    const s1 = await getEditorState(page);
    const midId = s1.document.activeLayerId;
    await paintRect(page, 0, 0, 100, 100, { r: 0, g: 255, b: 0, a: 255 }, midId);

    // Add layer 3
    await addLayer(page);
    const s2 = await getEditorState(page);
    const topId = s2.document.activeLayerId;
    await paintRect(page, 0, 0, 100, 100, { r: 0, g: 0, b: 255, a: 255 }, topId);

    expect(s2.document.layers).toHaveLength(3);

    // Merge top into mid
    await page.keyboard.press(`${mod}+KeyE`);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(2);
    expect(after.document.activeLayerId).toBe(midId);

    // Background should still be separate with red
    const bg = await getPixelAt(page, 50, 50, bgId);
    expect(bg.r).toBe(255);
    expect(bg.g).toBe(0);
  });

  test('undo merge preserves pixel data integrity across multiple operations', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint specific pattern on background
    await paintRect(page, 0, 0, 30, 30, { r: 200, g: 100, b: 50, a: 255 }, bgId);

    // Add and paint layer
    await addLayer(page);
    const s1 = await getEditorState(page);
    const topId = s1.document.activeLayerId;
    await paintRect(page, 70, 70, 30, 30, { r: 50, g: 100, b: 200, a: 255 }, topId);

    // Merge down
    await page.keyboard.press(`${mod}+KeyE`);

    // Verify merged result
    const mergedBg = await getPixelAt(page, 15, 15, bgId);
    expect(mergedBg.r).toBe(200);
    expect(mergedBg.g).toBe(100);
    expect(mergedBg.b).toBe(50);

    const mergedTop = await getPixelAt(page, 85, 85, bgId);
    expect(mergedTop.r).toBe(50);
    expect(mergedTop.g).toBe(100);
    expect(mergedTop.b).toBe(200);

    // Undo
    await page.keyboard.press(`${mod}+KeyZ`);

    // Background should have ONLY its original content
    const restoredBg = await getPixelAt(page, 15, 15, bgId);
    expect(restoredBg.r).toBe(200);
    expect(restoredBg.g).toBe(100);
    expect(restoredBg.b).toBe(50);
    expect(restoredBg.a).toBe(255);

    // Background should NOT have the top layer's content
    const bgEmpty = await getPixelAt(page, 85, 85, bgId);
    expect(bgEmpty.a).toBe(0);

    // Top layer should have its original content
    const restoredTop = await getPixelAt(page, 85, 85, topId);
    expect(restoredTop.r).toBe(50);
    expect(restoredTop.g).toBe(100);
    expect(restoredTop.b).toBe(200);
    expect(restoredTop.a).toBe(255);

    // Top layer should NOT have background's content
    const topEmpty = await getPixelAt(page, 15, 15, topId);
    expect(topEmpty.a).toBe(0);
  });

  test('merge down does nothing when only one layer exists', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const before = await getEditorState(page);
    expect(before.document.layers).toHaveLength(1);

    await page.keyboard.press(`${mod}+KeyE`);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(1);
    expect(after.undoStack).toBe(before.undoStack);
  });

  test('merge down does nothing when bottom layer is active', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    await addLayer(page);

    const state = await getEditorState(page);
    const bgId = state.document.layerOrder[0]!;

    // Switch to bottom layer
    await setActiveLayer(page, bgId);

    await page.keyboard.press(`${mod}+KeyE`);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(2);
  });
});
