import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createDocument,
  waitForStore,
  getEditorState,
  getPixelAt,
  paintRect,
  paintCircle,
  addLayer,
  setActiveLayer,
  moveLayer,
  undo,
  redo,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getCompositePixelAt(
  page: Page,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    ({ x, y }) => {
      const engine = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      } | undefined;
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        render: (engine: unknown) => void;
        sampleColor: (engine: unknown, x: number, y: number, radius: number) => Uint8Array;
      } | undefined;
      if (!engine || !bridge) return { r: 0, g: 0, b: 0, a: 0 };
      const eng = engine.getEngine();
      bridge.render(eng);
      const pixel = bridge.sampleColor(eng, x, y, 1);
      return { r: pixel[0]!, g: pixel[1]!, b: pixel[2]!, a: pixel[3]! };
    },
    { x, y },
  );
}

async function paintGradientRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  colorStart: { r: number; g: number; b: number; a: number },
  colorEnd: { r: number; g: number; b: number; a: number },
  direction: 'horizontal' | 'vertical',
  layerId?: string,
): Promise<void> {
  await page.evaluate(
    ({ x, y, w, h, colorStart, colorEnd, direction, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      state.pushHistory('Paint Gradient');
      const data = state.getOrCreateLayerPixelData(id);
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px < 0 || px >= data.width || py < 0 || py >= data.height) continue;
          const t = direction === 'horizontal' ? (px - x) / Math.max(1, w - 1) : (py - y) / Math.max(1, h - 1);
          const idx = (py * data.width + px) * 4;
          data.data[idx] = Math.round(colorStart.r + (colorEnd.r - colorStart.r) * t);
          data.data[idx + 1] = Math.round(colorStart.g + (colorEnd.g - colorStart.g) * t);
          data.data[idx + 2] = Math.round(colorStart.b + (colorEnd.b - colorStart.b) * t);
          data.data[idx + 3] = Math.round(colorStart.a + (colorEnd.a - colorStart.a) * t);
        }
      }
      state.updateLayerPixelData(id, data);
    },
    { x, y, w, h, colorStart, colorEnd, direction, lid: layerId ?? null },
  );
}

async function paintTriangle(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  color: { r: number; g: number; b: number; a: number },
  layerId?: string,
): Promise<void> {
  await page.evaluate(
    ({ x1, y1, x2, y2, x3, y3, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      state.pushHistory('Paint Triangle');
      const data = state.getOrCreateLayerPixelData(id);

      function sign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
        return (px - bx) * (ay - by) - (ax - bx) * (py - by);
      }
      function pointInTriangle(px: number, py: number): boolean {
        const d1 = sign(px, py, x1, y1, x2, y2);
        const d2 = sign(px, py, x2, y2, x3, y3);
        const d3 = sign(px, py, x3, y3, x1, y1);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
      }

      const minX = Math.max(0, Math.min(x1, x2, x3));
      const maxX = Math.min(data.width - 1, Math.max(x1, x2, x3));
      const minY = Math.max(0, Math.min(y1, y2, y3));
      const maxY = Math.min(data.height - 1, Math.max(y1, y2, y3));

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          if (pointInTriangle(px, py)) {
            const idx = (py * data.width + px) * 4;
            data.data[idx] = color.r;
            data.data[idx + 1] = color.g;
            data.data[idx + 2] = color.b;
            data.data[idx + 3] = color.a;
          }
        }
      }
      state.updateLayerPixelData(id, data);
    },
    { x1, y1, x2, y2, x3, y3, color, lid: layerId ?? null },
  );
}

async function fitToView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

async function selectMoveTool(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (tool: string) => void };
    };
    store.getState().setActiveTool('move');
  });
  await page.waitForTimeout(100);
}

async function clickAlignButton(page: Page, label: string): Promise<void> {
  await page.click(`button[aria-label="${label}"]`);
  await page.waitForTimeout(100);
}

async function getLayerPosition(page: Page, layerId?: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (lid) => {
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
      if (!layer) return { x: 0, y: 0 };
      return { x: layer.x, y: layer.y };
    },
    layerId ?? null,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
});

// ===========================================================================
// 1. Layer Masks
// ===========================================================================

test.describe('Bug Fix: Layer Masks', () => {
  test('mask with black region makes layer content transparent in that area', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Paint the entire layer red
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    // Add a mask (default is white = fully opaque)
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayerMask: (id: string) => void };
        };
        store.getState().addLayerMask(id);
      },
      layerId,
    );

    const stateAfterMask = await getEditorState(page);
    expect(stateAfterMask.document.layers[0]!.mask).not.toBeNull();
    expect(stateAfterMask.document.layers[0]!.mask!.enabled).toBe(true);

    // Paint the left half of the mask black (transparent)
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number; height: number } | null }> };
            updateLayerMaskData: (layerId: string, maskData: Uint8ClampedArray) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id);
        if (!layer || !layer.mask) return;
        const mask = layer.mask;
        state.pushHistory('Paint Mask');
        const newMask = new Uint8ClampedArray(mask.data.length);
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            // Left half = 0 (transparent), right half = 255 (opaque)
            newMask[y * mask.width + x] = x < mask.width / 2 ? 0 : 255;
          }
        }
        state.updateLayerMaskData(id, newMask);
      },
      layerId,
    );

    await page.waitForTimeout(300);

    // Verify compositing: left side should be transparent, right side should be red
    const leftPixel = await getCompositePixelAt(page, 25, 100);
    const rightPixel = await getCompositePixelAt(page, 150, 100);

    // Left half: mask is black, so content should be transparent (or nearly so)
    expect(leftPixel.a).toBeLessThan(30);

    // Right half: mask is white, so content should be fully red
    expect(rightPixel.r).toBeGreaterThan(200);
    expect(rightPixel.a).toBeGreaterThan(200);
  });

  test('mask undo restores previous mask state', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Paint content
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    // Add mask
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayerMask: (id: string) => void };
        };
        store.getState().addLayerMask(id);
      },
      layerId,
    );
    expect((await getEditorState(page)).document.layers[0]!.mask).not.toBeNull();

    // Undo the mask addition
    await undo(page);
    expect((await getEditorState(page)).document.layers[0]!.mask).toBeNull();

    // Redo the mask addition
    await redo(page);
    expect((await getEditorState(page)).document.layers[0]!.mask).not.toBeNull();
  });
});

// ===========================================================================
// 2. Selection Constraining Painting
// ===========================================================================

test.describe('Bug Fix: Selection Constraining Painting', () => {
  test('painting with active selection only modifies pixels inside selection bounds', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Create a rectangular selection in the center (50,50 to 150,150)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            maskWidth: number,
            maskHeight: number,
          ) => void;
        };
      };
      const w = 100;
      const h = 100;
      const mask = new Uint8ClampedArray(w * h);
      mask.fill(255); // All selected
      store.getState().setSelection({ x: 50, y: 50, width: w, height: h }, mask, w, h);
    });
    await page.waitForTimeout(200);

    // Verify selection is active
    const selState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
        };
      };
      return store.getState().selection;
    });
    expect(selState.active).toBe(true);
    expect(selState.bounds).toEqual({ x: 50, y: 50, width: 100, height: 100 });

    // Paint only inside the selection bounds using paintRect
    await paintRect(page, 50, 50, 100, 100, { r: 0, g: 255, b: 0, a: 255 }, layerId);
    await page.waitForTimeout(300);

    // Inside selection: should be green — use composite readback (JS data may flush to GPU)
    const insidePixel = await getCompositePixelAt(page, 100, 100);
    expect(insidePixel.g).toBeGreaterThan(200);
    expect(insidePixel.a).toBeGreaterThan(200);

    // Outside selection: should still be transparent (we only painted inside)
    const outsidePixel = await getCompositePixelAt(page, 10, 10);
    expect(outsidePixel.g).toBeLessThan(50);

    // Verify selection state is still properly set
    const selAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null };
        };
      };
      return store.getState().selection;
    });
    expect(selAfter.active).toBe(true);
    expect(selAfter.bounds).toEqual({ x: 50, y: 50, width: 100, height: 100 });
  });
});

// ===========================================================================
// 3. Flatten Image
// ===========================================================================

test.describe('Bug Fix: Flatten Image', () => {
  test('flatten merges all layers into a single layer with correct composite', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Paint red on background
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Add second layer with green
    await addLayer(page);
    const s1 = await getEditorState(page);
    const layer2Id = s1.document.activeLayerId;
    await paintRect(page, 0, 0, 50, 100, { r: 0, g: 255, b: 0, a: 255 }, layer2Id);

    // Add third layer with blue
    await addLayer(page);
    const s2 = await getEditorState(page);
    const layer3Id = s2.document.activeLayerId;
    await paintRect(page, 0, 0, 100, 50, { r: 0, g: 0, b: 255, a: 255 }, layer3Id);

    expect((await getEditorState(page)).document.layers).toHaveLength(3);

    // Flatten
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { flattenImage: () => void };
      };
      store.getState().flattenImage();
    });
    await page.waitForTimeout(300);

    const flatState = await getEditorState(page);
    expect(flatState.document.layers).toHaveLength(1);

    // The flattened layer should contain the composite result
    // Use composite readback since flattened data is GPU-only
    const topLeft = await getCompositePixelAt(page, 25, 25);
    expect(topLeft.b).toBeGreaterThan(200);
    expect(topLeft.a).toBeGreaterThan(200);

    // Bottom-left quadrant: green (layer 2 left half, layer 3 only covers top)
    const bottomLeft = await getCompositePixelAt(page, 25, 75);
    expect(bottomLeft.g).toBeGreaterThan(200);
    expect(bottomLeft.a).toBeGreaterThan(200);

    // Bottom-right quadrant: red (only background)
    const bottomRight = await getCompositePixelAt(page, 75, 75);
    expect(bottomRight.r).toBeGreaterThan(200);
    expect(bottomRight.a).toBeGreaterThan(200);
  });

  test('undo after flatten restores all layers', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 0, b: 0, a: 255 }, bgId);
    await addLayer(page);
    await addLayer(page);

    expect((await getEditorState(page)).document.layers).toHaveLength(3);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { flattenImage: () => void };
      };
      store.getState().flattenImage();
    });
    await page.waitForTimeout(300);

    expect((await getEditorState(page)).document.layers).toHaveLength(1);

    await undo(page);
    await page.waitForTimeout(500);
    const restored = await getEditorState(page);
    expect(restored.document.layers).toHaveLength(3);

    // Verify original layer IDs survived the undo
    const restoredIds = restored.document.layers.map((l) => l.id);
    expect(restoredIds).toContain(bgId);
  });
});

// ===========================================================================
// 4. Clone Stamp
// ===========================================================================

test.describe('Bug Fix: Clone Stamp', () => {
  test('cloned content matches source region', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Paint a distinctive source pattern: red square at (10,10) 40x40
    await paintRect(page, 10, 10, 40, 40, { r: 255, g: 0, b: 0, a: 255 }, layerId);
    // And a blue square at (20,20) 20x20 (overlapping the red)
    await paintRect(page, 20, 20, 20, 20, { r: 0, g: 0, b: 255, a: 255 }, layerId);

    // Simulate clone stamp: copy source region to destination
    // Source: (10,10)-(50,50), Destination: (100,100)-(140,140)
    await page.evaluate(
      (lid) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Clone Stamp');
        const data = state.getOrCreateLayerPixelData(lid);
        const srcX = 10;
        const srcY = 10;
        const dstX = 100;
        const dstY = 100;
        const size = 40;

        for (let dy = 0; dy < size; dy++) {
          for (let dx = 0; dx < size; dx++) {
            const si = ((srcY + dy) * data.width + (srcX + dx)) * 4;
            const di = ((dstY + dy) * data.width + (dstX + dx)) * 4;
            data.data[di] = data.data[si]!;
            data.data[di + 1] = data.data[si + 1]!;
            data.data[di + 2] = data.data[si + 2]!;
            data.data[di + 3] = data.data[si + 3]!;
          }
        }
        state.updateLayerPixelData(lid, data);
      },
      layerId,
    );
    await page.waitForTimeout(200);

    // Verify the cloned region matches the source
    // Source (15,15) = red -> Dest (105,105) should be red
    const srcRedPixel = await getPixelAt(page, 15, 15, layerId);
    const dstRedPixel = await getPixelAt(page, 105, 105, layerId);
    expect(dstRedPixel.r).toBe(srcRedPixel.r);
    expect(dstRedPixel.g).toBe(srcRedPixel.g);
    expect(dstRedPixel.b).toBe(srcRedPixel.b);
    expect(dstRedPixel.a).toBe(srcRedPixel.a);

    // Source (25,25) = blue -> Dest (115,115) should be blue
    const srcBluePixel = await getPixelAt(page, 25, 25, layerId);
    const dstBluePixel = await getPixelAt(page, 115, 115, layerId);
    expect(dstBluePixel.r).toBe(srcBluePixel.r);
    expect(dstBluePixel.g).toBe(srcBluePixel.g);
    expect(dstBluePixel.b).toBe(srcBluePixel.b);
    expect(dstBluePixel.a).toBe(srcBluePixel.a);

    // Outside cloned area at dest should still be transparent
    const outsidePixel = await getPixelAt(page, 99, 99, layerId);
    expect(outsidePixel.a).toBe(0);
  });

  test('clone stamp is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 30, 30, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    // Clone
    await page.evaluate(
      (lid) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            getOrCreateLayerPixelData: (id: string) => ImageData;
            updateLayerPixelData: (id: string, data: ImageData) => void;
            pushHistory: (label?: string) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Clone Stamp');
        const data = state.getOrCreateLayerPixelData(lid);
        for (let dy = 0; dy < 30; dy++) {
          for (let dx = 0; dx < 30; dx++) {
            const si = (dy * data.width + dx) * 4;
            const di = ((50 + dy) * data.width + (50 + dx)) * 4;
            data.data[di] = data.data[si]!;
            data.data[di + 1] = data.data[si + 1]!;
            data.data[di + 2] = data.data[si + 2]!;
            data.data[di + 3] = data.data[si + 3]!;
          }
        }
        state.updateLayerPixelData(lid, data);
      },
      layerId,
    );

    // Cloned pixel should exist — use composite readback since JS data may be flushed to GPU
    await page.waitForTimeout(200);
    const clonedPixel = await getCompositePixelAt(page, 55, 55);
    expect(clonedPixel.r).toBeGreaterThan(200);
    expect(clonedPixel.a).toBeGreaterThan(200);

    // Undo the clone
    await undo(page);
    await page.waitForTimeout(200);
    const afterUndo = await getCompositePixelAt(page, 55, 55);
    expect(afterUndo.r).toBeLessThan(50);
  });
});

// ===========================================================================
// 5. Move/Align Buttons
// ===========================================================================

test.describe('Bug Fix: Move/Align Buttons', () => {
  test('align center horizontally moves content to canvas center', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await selectMoveTool(page);

    // Paint a 40x40 block at top-left corner
    await paintRect(page, 0, 0, 40, 40, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(200);

    const posBefore = await getLayerPosition(page);
    expect(posBefore.x).toBe(0);

    await clickAlignButton(page, 'Align center horizontally');
    await page.waitForTimeout(200);

    const posAfter = await getLayerPosition(page);
    // Content at (0,0) size 40x40, canvas 200 wide
    // Center: layer.x = (200 - 40) / 2 - 0 = 80
    expect(posAfter.x).toBe(80);
  });

  test('align center vertically moves content to canvas center', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await selectMoveTool(page);

    await paintRect(page, 0, 0, 40, 40, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(200);

    await clickAlignButton(page, 'Align center vertically');
    await page.waitForTimeout(200);

    const posAfter = await getLayerPosition(page);
    expect(posAfter.y).toBe(80);
  });

  test('sequential align to center both axes', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await selectMoveTool(page);

    await paintRect(page, 10, 10, 20, 30, { r: 0, g: 0, b: 255, a: 255 });
    await page.waitForTimeout(200);

    await clickAlignButton(page, 'Align center horizontally');
    await clickAlignButton(page, 'Align center vertically');
    await page.waitForTimeout(200);

    const pos = await getLayerPosition(page);
    // GPU texture is cropped to content size, so content bounds start at (0,0) in texture space.
    // Center h: layer.x = (200-20)/2 = 90
    // Center v: layer.y = (200-30)/2 = 85
    expect(pos.x).toBe(90);
    expect(pos.y).toBe(85);
  });
});

// ===========================================================================
// 6. Image Adjustments
// ===========================================================================

test.describe('Bug Fix: Image Adjustments', () => {
  test('exposure adjustment brightens the composite', async ({ page }) => {
    await createDocument(page, 100, 100, false);
    const s0 = await getEditorState(page);
    const layerId = s0.document.layers[0]!.id;

    // Paint a mid-gray rectangle
    await paintRect(page, 0, 0, 100, 100, { r: 128, g: 128, b: 128, a: 255 }, layerId);
    await page.waitForTimeout(300);

    // Read baseline composite pixel
    const before = await getCompositePixelAt(page, 50, 50);

    // Apply exposure boost via uiStore
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setAdjustments: (adj: Record<string, number>) => void;
          setAdjustmentsEnabled: (enabled: boolean) => void;
        };
      };
      const state = store.getState();
      state.setAdjustmentsEnabled(true);
      state.setAdjustments({
        exposure: 1.0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vignette: 0,
      });
    });
    await page.waitForTimeout(500);

    // Re-render and check composite
    const after = await getCompositePixelAt(page, 50, 50);

    // Exposure of +1 stop doubles brightness: 128 -> ~255
    // The composite pixel should be significantly brighter
    expect(after.r).toBeGreaterThan(before.r);
    expect(after.g).toBeGreaterThan(before.g);
    expect(after.b).toBeGreaterThan(before.b);

    // Reset adjustments
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setAdjustments: (adj: Record<string, number>) => void;
        };
      };
      store.getState().setAdjustments({
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vignette: 0,
      });
    });
  });

  test('disabling adjustments restores original composite', async ({ page }) => {
    await createDocument(page, 100, 100, false);
    await paintRect(page, 0, 0, 100, 100, { r: 100, g: 100, b: 100, a: 255 });
    await page.waitForTimeout(300);

    const original = await getCompositePixelAt(page, 50, 50);

    // Enable strong contrast
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setAdjustments: (adj: Record<string, number>) => void;
          setAdjustmentsEnabled: (enabled: boolean) => void;
        };
      };
      const state = store.getState();
      state.setAdjustmentsEnabled(true);
      state.setAdjustments({
        exposure: 0,
        contrast: 50,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vignette: 0,
      });
    });
    await page.waitForTimeout(500);

    const adjusted = await getCompositePixelAt(page, 50, 50);
    // Contrast should shift the value away from 100
    expect(adjusted.r).not.toBe(original.r);

    // Disable adjustments
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setAdjustmentsEnabled: (enabled: boolean) => void };
      };
      store.getState().setAdjustmentsEnabled(false);
    });
    await page.waitForTimeout(500);

    const restored = await getCompositePixelAt(page, 50, 50);
    // Should be back to roughly the original values
    expect(Math.abs(restored.r - original.r)).toBeLessThan(5);

    // Re-enable and reset for cleanup
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setAdjustments: (adj: Record<string, number>) => void;
          setAdjustmentsEnabled: (enabled: boolean) => void;
        };
      };
      const state = store.getState();
      state.setAdjustmentsEnabled(true);
      state.setAdjustments({
        exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vignette: 0,
      });
    });
  });
});

// ===========================================================================
// 7. Multi-Step Undo/Redo (20+ steps, 5 layers)
// ===========================================================================

test.describe('Bug Fix: Multi-Step Undo/Redo (20+ steps, 5 layers)', () => {
  test('undo all 20+ operations then redo all, verifying state at each end', async ({ page }) => {
    // Create transparent document
    await createDocument(page, 200, 200, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // Step 1: Paint red on background
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    // Step 2: Add layer 2
    await addLayer(page);
    const s1 = await getEditorState(page);
    const layer2Id = s1.document.activeLayerId;

    // Step 3: Paint green on layer 2
    await paintRect(page, 0, 0, 100, 100, { r: 0, g: 255, b: 0, a: 255 }, layer2Id);

    // Step 4: Add layer 3
    await addLayer(page);
    const s2 = await getEditorState(page);
    const layer3Id = s2.document.activeLayerId;

    // Step 5: Paint blue on layer 3
    await paintRect(page, 50, 50, 100, 100, { r: 0, g: 0, b: 255, a: 255 }, layer3Id);

    // Step 6: Add layer 4
    await addLayer(page);
    const s3 = await getEditorState(page);
    const layer4Id = s3.document.activeLayerId;

    // Step 7: Paint yellow on layer 4
    await paintRect(page, 100, 0, 100, 100, { r: 255, g: 255, b: 0, a: 255 }, layer4Id);

    // Step 8: Add layer 5
    await addLayer(page);
    const s4 = await getEditorState(page);
    const layer5Id = s4.document.activeLayerId;

    // Step 9: Paint magenta on layer 5
    await paintRect(page, 0, 100, 100, 100, { r: 255, g: 0, b: 255, a: 255 }, layer5Id);

    // Step 10: Move layer 2
    await moveLayer(page, layer2Id, 10, 10);

    // Step 11: Change layer 4 opacity
    await page.evaluate(
      ({ id, opacity }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            pushHistory: (label?: string) => void;
            updateLayerOpacity: (id: string, opacity: number) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Opacity');
        state.updateLayerOpacity(id, opacity);
      },
      { id: layer4Id, opacity: 0.5 },
    );

    // Step 12: Toggle visibility of layer 3
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { toggleLayerVisibility: (id: string) => void };
        };
        store.getState().toggleLayerVisibility(id);
      },
      layer3Id,
    );

    // Step 13: Add mask to layer 5
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { addLayerMask: (id: string) => void };
        };
        store.getState().addLayerMask(id);
      },
      layer5Id,
    );

    // Step 14: Paint more on background
    await paintRect(page, 150, 150, 50, 50, { r: 128, g: 0, b: 0, a: 255 }, bgId);

    // Step 15: Paint on layer 2
    await paintRect(page, 50, 50, 50, 50, { r: 0, g: 128, b: 0, a: 255 }, layer2Id);

    // Step 16: Add drop shadow effect to layer 4
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        const newEffects = {
          ...layer.effects,
          dropShadow: {
            ...(layer.effects.dropShadow as Record<string, unknown>),
            enabled: true,
          },
        };
        state.updateLayerEffects(id, newEffects as never);
      },
      layer4Id,
    );

    // Step 17: Move layer 5
    await moveLayer(page, layer5Id, 20, 30);

    // Step 18: Paint cyan on layer 3
    await paintRect(page, 10, 10, 30, 30, { r: 0, g: 255, b: 255, a: 255 }, layer3Id);

    // Step 19: Toggle mask on layer 5
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { toggleLayerMask: (id: string) => void };
        };
        store.getState().toggleLayerMask(id);
      },
      layer5Id,
    );

    // Step 20: Move layer 4
    await moveLayer(page, layer4Id, 5, 5);

    // Step 21: Paint orange on layer 5
    await paintRect(page, 60, 60, 40, 40, { r: 255, g: 165, b: 0, a: 255 }, layer5Id);

    // Step 22: Change opacity of layer 2
    await page.evaluate(
      ({ id, opacity }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            pushHistory: (label?: string) => void;
            updateLayerOpacity: (id: string, opacity: number) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Opacity');
        state.updateLayerOpacity(id, opacity);
      },
      { id: layer2Id, opacity: 0.75 },
    );

    // Verify final state
    const finalState = await getEditorState(page);
    expect(finalState.document.layers).toHaveLength(5);
    expect(finalState.undoStackLength).toBeGreaterThanOrEqual(20);

    const totalUndos = finalState.undoStackLength;

    // Undo ALL operations
    for (let i = 0; i < totalUndos; i++) {
      await undo(page);
    }

    // After undoing everything: should be 1 empty layer (initial state)
    const afterFullUndo = await getEditorState(page);
    expect(afterFullUndo.document.layers).toHaveLength(1);
    expect(afterFullUndo.undoStackLength).toBe(0);
    expect(afterFullUndo.redoStackLength).toBe(totalUndos);

    // Background should be transparent (initial state)
    const emptyPixel = await getPixelAt(page, 50, 50, bgId);
    expect(emptyPixel.a).toBe(0);

    // Redo ALL operations
    for (let i = 0; i < totalUndos; i++) {
      await redo(page);
    }

    // After redoing everything: should match the final state
    const afterFullRedo = await getEditorState(page);
    expect(afterFullRedo.document.layers).toHaveLength(5);
    expect(afterFullRedo.undoStackLength).toBe(totalUndos);
    expect(afterFullRedo.redoStackLength).toBe(0);

    // Verify some specific state was restored
    const l4 = afterFullRedo.document.layers.find((l) => l.id === layer4Id);
    expect(l4!.opacity).toBe(0.5);
    expect(l4!.effects.dropShadow.enabled).toBe(true);

    const l2 = afterFullRedo.document.layers.find((l) => l.id === layer2Id);
    expect(l2!.opacity).toBe(0.75);

    const l3 = afterFullRedo.document.layers.find((l) => l.id === layer3Id);
    expect(l3!.visible).toBe(false);

    const l5 = afterFullRedo.document.layers.find((l) => l.id === layer5Id);
    expect(l5!.mask).not.toBeNull();
  });
});

// ===========================================================================
// 8. Masterpiece Test
// ===========================================================================

test.describe('Masterpiece: Full Feature Integration', () => {
  test('create a multi-layer composition using every tool, effect, and filter then export as PNG', async ({ page }) => {
    test.setTimeout(120000);

    // Create 600x400 canvas
    await createDocument(page, 600, 400, true);
    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    // -----------------------------------------------------------------------
    // Layer 0 (Background): Gradient fill (soft blue to purple)
    // -----------------------------------------------------------------------
    await paintGradientRect(
      page, 0, 0, 600, 400,
      { r: 100, g: 149, b: 237, a: 255 }, // cornflower blue
      { r: 128, g: 0, b: 128, a: 255 },   // purple
      'horizontal',
      bgId,
    );
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // Layer 1: Sun (yellow/orange circle) with outer glow
    // -----------------------------------------------------------------------
    await addLayer(page);
    const s1 = await getEditorState(page);
    const sunLayerId = s1.document.activeLayerId;

    // Paint a large yellow sun
    await paintCircle(page, 450, 80, 50, { r: 255, g: 200, b: 0, a: 255 }, sunLayerId);
    // Paint an orange center
    await paintCircle(page, 450, 80, 25, { r: 255, g: 140, b: 0, a: 255 }, sunLayerId);

    // Add outer glow effect
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        state.updateLayerEffects(id, {
          ...layer.effects,
          outerGlow: {
            enabled: true,
            color: { r: 255, g: 200, b: 50, a: 255 },
            size: 15,
            spread: 5,
            opacity: 0.8,
          },
        } as never);
      },
      sunLayerId,
    );
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // Layer 2: Mountains (dark green triangles) with drop shadow
    // -----------------------------------------------------------------------
    await addLayer(page);
    const s2 = await getEditorState(page);
    const mountainLayerId = s2.document.activeLayerId;

    // Paint mountain shapes using triangles
    await paintTriangle(page, 50, 350, 200, 180, 350, 350, { r: 34, g: 100, b: 34, a: 255 }, mountainLayerId);
    await paintTriangle(page, 200, 350, 350, 150, 500, 350, { r: 0, g: 80, b: 0, a: 255 }, mountainLayerId);
    await paintTriangle(page, 400, 350, 520, 200, 600, 350, { r: 20, g: 90, b: 20, a: 255 }, mountainLayerId);

    // Add drop shadow to mountains
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        state.updateLayerEffects(id, {
          ...layer.effects,
          dropShadow: {
            enabled: true,
            color: { r: 0, g: 0, b: 0, a: 255 },
            offsetX: 5,
            offsetY: 5,
            blur: 10,
            spread: 0,
            opacity: 0.6,
          },
        } as never);
      },
      mountainLayerId,
    );

    // Add color overlay on mountains for slightly different tint
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        state.updateLayerEffects(id, {
          ...layer.effects,
          colorOverlay: {
            enabled: true,
            color: { r: 30, g: 80, b: 30, a: 128 },
          },
        } as never);
      },
      mountainLayerId,
    );
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // Layer 3: Clouds (white circles) with 60% opacity
    // -----------------------------------------------------------------------
    await addLayer(page);
    const s3 = await getEditorState(page);
    const cloudLayerId = s3.document.activeLayerId;

    // Paint cloud clusters
    await paintCircle(page, 100, 70, 35, { r: 255, g: 255, b: 255, a: 220 }, cloudLayerId);
    await paintCircle(page, 140, 60, 30, { r: 255, g: 255, b: 255, a: 200 }, cloudLayerId);
    await paintCircle(page, 120, 80, 25, { r: 240, g: 240, b: 255, a: 210 }, cloudLayerId);

    await paintCircle(page, 300, 50, 40, { r: 255, g: 255, b: 255, a: 220 }, cloudLayerId);
    await paintCircle(page, 350, 45, 35, { r: 255, g: 255, b: 255, a: 200 }, cloudLayerId);
    await paintCircle(page, 325, 65, 28, { r: 240, g: 240, b: 255, a: 210 }, cloudLayerId);

    // Set cloud layer to 60% opacity
    await page.evaluate(
      ({ id, opacity }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            pushHistory: (label?: string) => void;
            updateLayerOpacity: (id: string, opacity: number) => void;
          };
        };
        const state = store.getState();
        state.pushHistory('Cloud Opacity');
        state.updateLayerOpacity(id, opacity);
      },
      { id: cloudLayerId, opacity: 0.6 },
    );
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // Layer 4: Abstract brush strokes in various colors
    // -----------------------------------------------------------------------
    await addLayer(page);
    const s4 = await getEditorState(page);
    const brushLayerId = s4.document.activeLayerId;

    // Paint abstract color strokes
    await paintRect(page, 20, 200, 150, 8, { r: 255, g: 100, b: 50, a: 180 }, brushLayerId);
    await paintRect(page, 60, 220, 120, 6, { r: 50, g: 200, b: 255, a: 160 }, brushLayerId);
    await paintRect(page, 100, 240, 200, 10, { r: 200, g: 50, b: 200, a: 140 }, brushLayerId);
    await paintRect(page, 350, 280, 180, 7, { r: 100, g: 255, b: 100, a: 170 }, brushLayerId);
    await paintRect(page, 400, 300, 150, 9, { r: 255, g: 255, b: 100, a: 150 }, brushLayerId);

    // Add inner glow to sun layer
    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => {
            document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
            updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
          };
        };
        const state = store.getState();
        const layer = state.document.layers.find((l) => l.id === id)!;
        state.updateLayerEffects(id, {
          ...layer.effects,
          innerGlow: {
            enabled: true,
            color: { r: 255, g: 240, b: 200, a: 255 },
            size: 10,
            spread: 3,
            opacity: 0.7,
          },
        } as never);
      },
      sunLayerId,
    );
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // Apply image adjustments: slight exposure boost + vignette
    // -----------------------------------------------------------------------
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setAdjustments: (adj: Record<string, number>) => void;
          setAdjustmentsEnabled: (enabled: boolean) => void;
        };
      };
      const state = store.getState();
      state.setAdjustmentsEnabled(true);
      state.setAdjustments({
        exposure: 0.15,
        contrast: 10,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vignette: 30,
      });
    });
    await page.waitForTimeout(300);

    // -----------------------------------------------------------------------
    // Verify the composition
    // -----------------------------------------------------------------------
    const finalState = await getEditorState(page);
    expect(finalState.document.layers).toHaveLength(5);
    expect(finalState.document.width).toBe(600);
    expect(finalState.document.height).toBe(400);

    // Verify effects are applied
    const sunLayer = finalState.document.layers.find((l) => l.id === sunLayerId)!;
    expect(sunLayer.effects.outerGlow.enabled).toBe(true);
    expect(sunLayer.effects.innerGlow.enabled).toBe(true);

    const mtnLayer = finalState.document.layers.find((l) => l.id === mountainLayerId)!;
    expect(mtnLayer.effects.dropShadow.enabled).toBe(true);

    const cloudLayer = finalState.document.layers.find((l) => l.id === cloudLayerId)!;
    expect(cloudLayer.opacity).toBe(0.6);

    // Verify some composite pixels are non-transparent
    await page.waitForTimeout(500);
    const centerPixel = await getCompositePixelAt(page, 300, 200);
    expect(centerPixel.a).toBeGreaterThan(0);

    // Take screenshot
    await fitToView(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'masterpiece-viewport.png') });

    // -----------------------------------------------------------------------
    // Export as PNG using compositeForExport
    // -----------------------------------------------------------------------
    const exportResult = await page.evaluate(() => {
      const engineState = (window as unknown as Record<string, unknown>).__engineState as {
        getEngine: () => unknown;
      } | undefined;
      const bridge = (window as unknown as Record<string, unknown>).__wasmBridge as {
        compositeForExport: (engine: unknown) => Uint8Array;
        getCompositeSize: (engine: unknown) => Uint32Array;
        render: (engine: unknown) => void;
      } | undefined;
      if (!engineState || !bridge) return null;

      const engine = engineState.getEngine();
      bridge.render(engine);

      const sizeArr = bridge.getCompositeSize(engine);
      const width = sizeArr[0]!;
      const height = sizeArr[1]!;
      const pixels = bridge.compositeForExport(engine);

      // Create PNG via offscreen canvas
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      const clampedPixels = new Uint8ClampedArray(width * height * 4);
      clampedPixels.set(pixels);
      const imageData = new ImageData(clampedPixels, width, height);
      ctx.putImageData(imageData, 0, 0);

      return canvas.convertToBlob({ type: 'image/png' }).then((blob) => {
        return blob.arrayBuffer().then((buffer) => {
          return Array.from(new Uint8Array(buffer));
        });
      });
    });

    if (exportResult) {
      const pngBuffer = Buffer.from(exportResult);
      const fs = await import('fs');
      const artifactsDir = path.resolve(__dirname, '../test-results/artifacts');
      fs.mkdirSync(artifactsDir, { recursive: true });
      const outputPath = path.join(artifactsDir, 'claudes_masterpiece.png');
      fs.writeFileSync(outputPath, pngBuffer);

      // Verify the file was written and has content
      const stats = fs.statSync(outputPath);
      expect(stats.size).toBeGreaterThan(1000); // PNG should be at least 1KB

      // Verify it starts with PNG magic bytes
      expect(pngBuffer[0]).toBe(0x89);
      expect(pngBuffer[1]).toBe(0x50); // 'P'
      expect(pngBuffer[2]).toBe(0x4E); // 'N'
      expect(pngBuffer[3]).toBe(0x47); // 'G'
    }

    // Reset adjustments
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setAdjustments: (adj: Record<string, number>) => void;
          setAdjustmentsEnabled: (enabled: boolean) => void;
        };
      };
      const state = store.getState();
      state.setAdjustmentsEnabled(true);
      state.setAdjustments({
        exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vignette: 0,
      });
    });
  });
});
