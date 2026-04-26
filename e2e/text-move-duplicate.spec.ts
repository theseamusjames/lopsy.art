import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';

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

async function selectTextTool(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('text');
  });
}

async function selectMoveTool(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('move');
  });
}

async function getTextLayers(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{
            id: string;
            name: string;
            type: string;
            x: number;
            y: number;
            text?: string;
            width?: number | null;
          }>;
          activeLayerId: string;
        };
      };
    };
    const doc = store.getState().document;
    // Text layers are rasterized on commit — match by name prefix
    return {
      layers: doc.layers.filter((l) => l.name.startsWith('Text')),
      activeLayerId: doc.activeLayerId,
    };
  });
}

async function getLayerById(
  page: Page,
  id: string,
): Promise<{ id: string; x: number; y: number; type: string } | null> {
  return page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number; type: string }> };
        };
      };
      const found = store.getState().document.layers.find((l) => l.id === lid);
      return found ?? null;
    },
    id,
  );
}

async function duplicateActiveLayer(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { duplicateLayer: () => void };
    };
    store.getState().duplicateLayer();
  });
}

async function setActiveLayer(page: Page, id: string) {
  await page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(lid);
    },
    id,
  );
}

/**
 * Count opaque pixels in a doc-coordinate rectangle within a specific layer's
 * texture. Returns the count of pixels with alpha > 0.
 */
async function countOpaquePixelsInRegion(
  page: Page,
  layerId: string,
  docX: number,
  docY: number,
  regionW: number,
  regionH: number,
): Promise<number> {
  return page.evaluate(
    async ({ lid, docX, docY, regionW, regionH }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number }> };
        };
      };
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === lid);
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const result = await readFn(lid);
      if (!result || result.width === 0) return 0;
      let count = 0;
      for (let dy = 0; dy < regionH; dy++) {
        for (let dx = 0; dx < regionW; dx++) {
          const localX = docX + dx - lx;
          const localY = docY + dy - ly;
          if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) continue;
          const idx = (localY * result.width + localX) * 4;
          if ((result.pixels[idx + 3] ?? 0) > 0) count++;
        }
      }
      return count;
    },
    { lid: layerId, docX, docY, regionW, regionH },
  );
}

/**
 * Read the composited (flattened) pixel at a doc-space coordinate.
 * Accounts for viewport zoom, pan, and the bottom-up GPU buffer.
 */
async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ docX, docY }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const state = store.getState();
      const result = await readFn();
      const cw = result.width;
      const ch = result.height;
      const zoom = state.viewport.zoom;
      const panX = state.viewport.panX;
      const panY = state.viewport.panY;
      const dw = state.document.width;
      const dh = state.document.height;
      // Project doc coords to composite canvas coords (buffer is bottom-up)
      const cx = Math.round((docX - dw / 2) * zoom + panX + cw / 2);
      const cy_up = Math.round((docY - dh / 2) * zoom + panY + ch / 2);
      const cy = ch - 1 - cy_up;
      if (cx < 0 || cx >= cw || cy < 0 || cy >= ch) return { r: 0, g: 0, b: 0, a: 0 };
      const idx = (cy * cw + cx) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { docX, docY },
  );
}

/**
 * Count composited dark pixels (text against white background) in a doc rect.
 */
async function countDarkCompositedPixels(
  page: Page,
  docX: number,
  docY: number,
  regionW: number,
  regionH: number,
  threshold = 200,
): Promise<number> {
  return page.evaluate(
    async ({ docX, docY, regionW, regionH, threshold }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const state = store.getState();
      const result = await readFn();
      const cw = result.width;
      const ch = result.height;
      const zoom = state.viewport.zoom;
      const panX = state.viewport.panX;
      const panY = state.viewport.panY;
      const dw = state.document.width;
      const dh = state.document.height;
      let count = 0;
      for (let dy = 0; dy < regionH; dy++) {
        for (let dx = 0; dx < regionW; dx++) {
          const cx = Math.round((docX + dx - dw / 2) * zoom + panX + cw / 2);
          const cy_up = Math.round((docY + dy - dh / 2) * zoom + panY + ch / 2);
          const cy = ch - 1 - cy_up;
          if (cx < 0 || cx >= cw || cy < 0 || cy >= ch) continue;
          const idx = (cy * cw + cx) * 4;
          const r = result.pixels[idx] ?? 255;
          if (r < threshold) count++;
        }
      }
      return count;
    },
    { docX, docY, regionW, regionH, threshold },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Text — add, move, layer, duplicate', () => {
  // ERR_CERT_AUTHORITY_INVALID fires in the test environment due to a
  // self-signed cert on the vite dev server. It is unrelated to text
  // functionality and affects every test in this suite equally.
  test.use({ allowConsoleErrors: [/ERR_CERT_AUTHORITY_INVALID/] });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // 800×600 white-background document
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(200);
  });

  test('adding text renders pixel content at the clicked position', async ({ page }) => {
    await selectTextTool(page);

    // Click at doc (200, 150) — this creates a new text layer at that position.
    const clickPos = await docToScreen(page, 200, 150);
    await page.mouse.click(clickPos.x, clickPos.y);
    await page.waitForTimeout(100);

    // Type text and commit.
    await page.keyboard.type('Hello');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-add.png' });

    const { layers } = await getTextLayers(page);
    expect(layers.length).toBe(1);
    const textLayer = layers[0]!;

    // Text was rendered at (0,0) in a full-canvas ImageData; layer.x/y = click position.
    // Probe a 60×30 box starting at doc (200,150) — should have black text pixels.
    const opaqueCount = await countOpaquePixelsInRegion(
      page, textLayer.id, 200, 150, 60, 30,
    );
    expect(opaqueCount).toBeGreaterThan(0);

    // Verify the composited output shows dark text at the clicked location.
    // Text is black; background is white. Check a 60×25px region at the click point.
    const darkPixels = await countDarkCompositedPixels(page, 200, 150, 60, 25);
    expect(darkPixels).toBeGreaterThan(0);

    // Confirm no dark pixels 100px above the click — text is only where we placed it.
    const darkAbove = await countDarkCompositedPixels(page, 200, 50, 60, 25);
    expect(darkAbove).toBe(0);
  });

  test('move tool repositions committed text to the new document coordinates', async ({ page }) => {
    await selectTextTool(page);

    // Create and commit text at doc (150, 120).
    const clickPos = await docToScreen(page, 150, 120);
    await page.mouse.click(clickPos.x, clickPos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('Move me');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    const { layers: before } = await getTextLayers(page);
    expect(before.length).toBe(1);
    const textLayer = before[0]!;

    // Verify text is present at original position before moving.
    const opaqueBeforeMove = await countOpaquePixelsInRegion(
      page, textLayer.id, 150, 120, 80, 30,
    );
    expect(opaqueBeforeMove).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/text-move-before.png' });

    // Switch to the move tool. The text layer remains active.
    await selectMoveTool(page);
    await page.waitForTimeout(50);

    // Drag from doc (150, 120) to doc (400, 300) using real mouse events.
    // The move tool operates on the active layer.
    const dragStart = await docToScreen(page, 150, 120);
    const dragEnd = await docToScreen(page, 400, 300);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-move-after.png' });

    // Layer position should now be near doc (400, 300).
    const layerAfter = await getLayerById(page, textLayer.id);
    expect(layerAfter).not.toBeNull();
    // Layer x/y shifted roughly by the drag delta (+250, +180).
    expect(layerAfter!.x).toBeGreaterThan(300);
    expect(layerAfter!.y).toBeGreaterThan(200);

    // Pixel data is unchanged; layer position accounting means the text region
    // now maps to the new doc coordinates.
    const opaqueAtNew = await countOpaquePixelsInRegion(
      page, textLayer.id, layerAfter!.x, layerAfter!.y, 80, 30,
    );
    expect(opaqueAtNew).toBeGreaterThan(0);

    // The composited output should show text at the new location, not the old one.
    const darkAtNew = await countDarkCompositedPixels(
      page, layerAfter!.x, layerAfter!.y, 80, 30,
    );
    expect(darkAtNew).toBeGreaterThan(0);

    const darkAtOld = await countDarkCompositedPixels(page, 150, 120, 80, 30);
    expect(darkAtOld).toBe(0);
  });

  test('adding a second text element on a new layer creates two independent text layers', async ({ page }) => {
    await selectTextTool(page);

    // Create and commit first text at doc (100, 100).
    const firstPos = await docToScreen(page, 100, 100);
    await page.mouse.click(firstPos.x, firstPos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('First');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    // Verify first text layer exists.
    const { layers: afterFirst } = await getTextLayers(page);
    expect(afterFirst.length).toBe(1);
    const firstLayerId = afterFirst[0]!.id;

    // Click at a different location (doc 450, 350) to create a second text layer.
    // When textEditing is null (committed) and we click away from existing text,
    // the text tool creates a new layer.
    const secondPos = await docToScreen(page, 450, 350);
    await page.mouse.click(secondPos.x, secondPos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('Second');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-two-layers.png' });

    // There should now be two text layers.
    const { layers: afterSecond } = await getTextLayers(page);
    expect(afterSecond.length).toBe(2);

    // The first layer should still exist.
    const firstLayer = afterSecond.find((l) => l.id === firstLayerId);
    expect(firstLayer).toBeDefined();

    // The second layer should be a different layer.
    const secondLayer = afterSecond.find((l) => l.id !== firstLayerId);
    expect(secondLayer).toBeDefined();

    // Both layers should have pixel content (non-zero opaque pixels in their regions).
    const firstOpaqueCount = await countOpaquePixelsInRegion(
      page, firstLayerId, 100, 100, 60, 30,
    );
    expect(firstOpaqueCount).toBeGreaterThan(0);

    const secondOpaqueCount = await countOpaquePixelsInRegion(
      page, secondLayer!.id, 450, 350, 60, 30,
    );
    expect(secondOpaqueCount).toBeGreaterThan(0);

    // The composited output should show dark text at both locations.
    const darkAtFirst = await countDarkCompositedPixels(page, 100, 100, 60, 25);
    expect(darkAtFirst).toBeGreaterThan(0);

    const darkAtSecond = await countDarkCompositedPixels(page, 450, 350, 60, 25);
    expect(darkAtSecond).toBeGreaterThan(0);
  });

  test('duplicating a text layer then moving the duplicate leaves the original unchanged', async ({ page }) => {
    await selectTextTool(page);

    // Create and commit text at doc (120, 100).
    const origPos = await docToScreen(page, 120, 100);
    await page.mouse.click(origPos.x, origPos.y);
    await page.waitForTimeout(100);
    await page.keyboard.type('Original');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(300);

    const { layers: beforeDup } = await getTextLayers(page);
    expect(beforeDup.length).toBe(1);
    const originalId = beforeDup[0]!.id;

    // Record original layer position.
    const originalLayer = await getLayerById(page, originalId);
    expect(originalLayer).not.toBeNull();
    const origX = originalLayer!.x;
    const origY = originalLayer!.y;

    // Duplicate the text layer. The duplicate becomes the active layer.
    await duplicateActiveLayer(page);
    await page.waitForTimeout(200);

    const { layers: afterDup } = await getTextLayers(page);
    expect(afterDup.length).toBe(2);

    // Identify the duplicate (not the original).
    const duplicateLayer = afterDup.find((l) => l.id !== originalId);
    expect(duplicateLayer).toBeDefined();
    const duplicateId = duplicateLayer!.id;

    // Verify both layers have pixel content before moving.
    const origOpaqueBeforeMove = await countOpaquePixelsInRegion(
      page, originalId, origX, origY, 80, 30,
    );
    expect(origOpaqueBeforeMove).toBeGreaterThan(0);

    const dupOpaqueBeforeMove = await countOpaquePixelsInRegion(
      page, duplicateId, duplicateLayer!.x, duplicateLayer!.y, 80, 30,
    );
    expect(dupOpaqueBeforeMove).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/text-duplicate-before-move.png' });

    // Ensure the duplicate is the active layer, then switch to move tool.
    await setActiveLayer(page, duplicateId);
    await selectMoveTool(page);
    await page.waitForTimeout(50);

    // Drag the duplicate from its position (same as original) to doc (500, 400).
    const dupStartScreen = await docToScreen(page, duplicateLayer!.x + 10, duplicateLayer!.y + 10);
    const dupEndScreen = await docToScreen(page, 500, 400);
    await page.mouse.move(dupStartScreen.x, dupStartScreen.y);
    await page.mouse.down();
    await page.mouse.move(dupEndScreen.x, dupEndScreen.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-duplicate-after-move.png' });

    // The duplicate should now be at the new position.
    const dupAfterMove = await getLayerById(page, duplicateId);
    expect(dupAfterMove).not.toBeNull();
    expect(dupAfterMove!.x).toBeGreaterThan(400);
    expect(dupAfterMove!.y).toBeGreaterThan(300);

    // The original should remain at its original position.
    const origAfterMove = await getLayerById(page, originalId);
    expect(origAfterMove).not.toBeNull();
    expect(origAfterMove!.x).toBe(origX);
    expect(origAfterMove!.y).toBe(origY);

    // Original still has pixels at the original doc position.
    const origOpaqueAfterMove = await countOpaquePixelsInRegion(
      page, originalId, origX, origY, 80, 30,
    );
    expect(origOpaqueAfterMove).toBeGreaterThan(0);

    // Duplicate has pixels at the new position.
    const dupOpaqueAfterMove = await countOpaquePixelsInRegion(
      page, duplicateId, dupAfterMove!.x, dupAfterMove!.y, 80, 30,
    );
    expect(dupOpaqueAfterMove).toBeGreaterThan(0);

    // Composited view: text should appear at both original AND new positions,
    // since both layers are visible.
    const darkAtOriginal = await countDarkCompositedPixels(page, origX, origY, 80, 25);
    expect(darkAtOriginal).toBeGreaterThan(0);

    const darkAtDuplicate = await countDarkCompositedPixels(
      page, dupAfterMove!.x, dupAfterMove!.y, 80, 25,
    );
    expect(darkAtDuplicate).toBeGreaterThan(0);
  });
});
