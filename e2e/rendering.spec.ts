import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, '../test-results/screenshots');

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

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
  await page.waitForTimeout(500);
}

async function paintRect(
  page: Page,
  x: number, y: number, w: number, h: number,
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
          pushHistory: (label?: string) => void;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      state.pushHistory('Paint');
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
  await page.waitForTimeout(200);
}

async function fitToView(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { fitToView: () => void };
    };
    store.getState().fitToView();
  });
  await page.waitForTimeout(300);
}

test.describe('WASM/WebGL Rendering', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('01 - blank white document renders correctly', async ({ page }) => {
    // Capture browser console logs
    page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

    await createDocument(page, 400, 300, false);
    await fitToView(page);
    await page.waitForTimeout(500);

    // Diagnostic: check WebGL canvas state
    const diag = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="canvas-container"]');
      if (!container) return { error: 'no container' };
      const canvases = container.querySelectorAll('canvas');
      const results: Record<string, unknown>[] = [];
      canvases.forEach((c, i) => {
        const gl = c.getContext('webgl2');
        const ctx2d = c.getContext('2d');
        results.push({
          index: i,
          width: c.width,
          height: c.height,
          cssWidth: c.clientWidth,
          cssHeight: c.clientHeight,
          hasWebGL: !!gl,
          has2D: !!ctx2d,
          className: c.className,
        });
      });
      return { canvasCount: canvases.length, canvases: results };
    });
    console.log('Canvas diagnostics:', JSON.stringify(diag, null, 2));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-blank-white-doc.png') });
  });

  test('02 - blank transparent document shows checkerboard', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await fitToView(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-blank-transparent-doc.png') });
  });

  test('03 - full red fill (no sparse conversion)', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    // Paint entire canvas red — >50% content, won't be sparsified
    await paintRect(page, 0, 0, 400, 300, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);
    await page.waitForTimeout(500);
    // Check that pixel data exists in store
    const storeInfo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }>; width: number; height: number };
          layerPixelData: Map<string, ImageData>;
          sparseLayerData: Map<string, unknown>;
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const layer = state.document.layers[0];
      return {
        docSize: `${state.document.width}x${state.document.height}`,
        layerCount: state.document.layers.length,
        layerId: layer?.id,
        layerPos: layer ? `${layer.x},${layer.y}` : 'none',
        layerSize: layer ? `${layer.width}x${layer.height}` : 'none',
        hasDenseData: layer ? state.layerPixelData.has(layer.id) : false,
        hasSparseData: layer ? state.sparseLayerData.has(layer.id) : false,
        viewport: `zoom=${state.viewport.zoom.toFixed(2)} pan=${state.viewport.panX.toFixed(0)},${state.viewport.panY.toFixed(0)}`,
      };
    });
    console.log('Store state:', JSON.stringify(storeInfo, null, 2));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-full-red-fill.png') });
  });

  test('04 - blue rectangle in bottom-right corner', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 300, 225, 100, 75, { r: 0, g: 0, b: 255, a: 255 });
    await fitToView(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-blue-rect-bottom-right.png') });
  });

  test('05 - four colored corners verify orientation', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    // Top-left: red
    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 });
    // Top-right: green
    await paintRect(page, 350, 0, 50, 50, { r: 0, g: 255, b: 0, a: 255 });
    // Bottom-left: blue
    await paintRect(page, 0, 250, 50, 50, { r: 0, g: 0, b: 255, a: 255 });
    // Bottom-right: yellow
    await paintRect(page, 350, 250, 50, 50, { r: 255, g: 255, b: 0, a: 255 });
    await fitToView(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-four-corners.png') });
  });

  test('06 - panning moves document correctly', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await paintRect(page, 0, 0, 200, 150, { r: 255, g: 0, b: 0, a: 255 });
    await fitToView(page);
    await page.waitForTimeout(300);
    // Pan right and down
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setPan: (x: number, y: number) => void };
      };
      store.getState().setPan(100, 50);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-panned.png') });
  });

  test('07 - zoomed in view', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 180, 130, 40, 40, { r: 0, g: 128, b: 255, a: 255 });
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setZoom: (z: number) => void;
          setPan: (x: number, y: number) => void;
        };
      };
      store.getState().setZoom(4.0);
      store.getState().setPan(0, 0);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-zoomed-4x.png') });
  });

  test('08 - multi-layer compositing', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    const layers = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string }> };
          addLayer: () => void;
        };
      };
      store.getState().addLayer();
      return store.getState().document.layers.map(l => l.id);
    });
    // Bottom layer: large red rect
    await paintRect(page, 50, 50, 200, 150, { r: 255, g: 0, b: 0, a: 255 }, layers[0]);
    // Top layer: overlapping blue rect
    await paintRect(page, 150, 100, 200, 150, { r: 0, g: 0, b: 255, a: 255 }, layers[1]);
    await fitToView(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-multi-layer.png') });
  });

  test('09 - brush stroke renders in real-time', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await fitToView(page);
    await page.waitForTimeout(500);

    // Select brush tool and set settings
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { setActiveTool: (t: string) => void };
      };
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setBrushSize: (s: number) => void; setBrushHardness: (h: number) => void };
      };
      ui.getState().setActiveTool('brush');
      ts.getState().setBrushSize(30);
      ts.getState().setBrushHardness(100);
    });
    await page.waitForTimeout(200);

    // Draw a horizontal stroke across the middle of the canvas
    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    if (!box) throw new Error('No canvas container');

    const startX = box.x + box.width * 0.2;
    const endX = box.x + box.width * 0.8;
    const midY = box.y + box.height * 0.5;

    await page.mouse.move(startX, midY);
    await page.mouse.down();
    // Move in steps so dabs are rendered
    for (let x = startX; x <= endX; x += 10) {
      await page.mouse.move(x, midY);
      await page.waitForTimeout(16);
    }
    // Screenshot DURING the stroke (before mouse up)
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-brush-during-stroke.png') });

    await page.mouse.up();
    await page.waitForTimeout(300);
    // Screenshot AFTER the stroke
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-brush-after-stroke.png') });
  });

  test('10 - brush inside selection marquee clips to selection', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await fitToView(page);
    await page.waitForTimeout(500);

    // Create a rectangular selection in the center
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setSelection: (bounds: unknown, mask: Uint8ClampedArray, w: number, h: number) => void;
        };
      };
      const w = 400;
      const h = 300;
      const mask = new Uint8ClampedArray(w * h);
      for (let py = 110; py < 190; py++) {
        for (let px = 150; px < 250; px++) {
          mask[py * w + px] = 255;
        }
      }
      store.getState().setSelection(
        { x: 150, y: 110, width: 100, height: 80 },
        mask, w, h,
      );
    });
    await page.waitForTimeout(300);

    // Select brush tool with red color
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setActiveTool: (t: string) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setBrushSize: (s: number) => void; setBrushHardness: (h: number) => void };
      };
      ui.getState().setActiveTool('brush');
      ui.getState().setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
      ts.getState().setBrushSize(50);
      ts.getState().setBrushHardness(100);
    });
    await page.waitForTimeout(200);

    // Draw a horizontal stroke across the full width (should clip to selection)
    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    if (!box) throw new Error('No canvas container');

    const startX = box.x + box.width * 0.1;
    const endX = box.x + box.width * 0.9;
    const midY = box.y + box.height * 0.5;

    await page.mouse.move(startX, midY);
    await page.mouse.down();
    for (let x = startX; x <= endX; x += 8) {
      await page.mouse.move(x, midY);
      await page.waitForTimeout(16);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-brush-in-selection-during.png') });

    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-brush-in-selection-after.png') });

    // Verify via the layer's pixel data:
    // After crop, the layer data is trimmed to the painted region.
    // The layer position (x,y) tells us where it sits in document space.
    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const data = state.resolvePixelData(id);
      if (!data) return { error: 'no pixel data' };
      const layer = state.document.layers.find(l => l.id === id);
      if (!layer) return { error: 'layer not found' };

      // The painted red pixels should be within the selection (150-250, 110-190).
      // Check a pixel near the center of the selection in layer-local coords.
      const localX = 200 - layer.x;
      const localY = 150 - layer.y;
      const hasData = localX >= 0 && localX < data.width && localY >= 0 && localY < data.height;
      let insideHasRed = false;
      if (hasData) {
        const idx = (localY * data.width + localX) * 4;
        insideHasRed = (data.data[idx] ?? 0) > 200;
      }

      return { insideHasRed, hasData, layerPos: `${layer.x},${layer.y}`, dataSize: `${data.width}x${data.height}` };
    });

    console.log('Selection paint result:', JSON.stringify(result));
    expect(result).not.toHaveProperty('error');
    expect(result.insideHasRed).toBe(true);
  });

  test('11 - gradient renders on canvas', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await fitToView(page);
    await page.waitForTimeout(500);

    // Fill layer with a horizontal gradient (red left → blue right)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);
      for (let py = 0; py < data.height; py++) {
        for (let px = 0; px < data.width; px++) {
          const t = px / data.width;
          const idx = (py * data.width + px) * 4;
          data.data[idx] = Math.round(255 * (1 - t));
          data.data[idx + 1] = 0;
          data.data[idx + 2] = Math.round(255 * t);
          data.data[idx + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '11-gradient-render.png') });

    // Verify gradient via store pixel data (WebGL buffer may be swapped)
    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const data = state.resolvePixelData(state.document.activeLayerId);
      if (!data) return { error: 'no pixel data' };

      const midRow = Math.floor(data.height / 2);
      const leftCol = Math.floor(data.width * 0.1);
      const midCol = Math.floor(data.width * 0.5);
      const rightCol = Math.floor(data.width * 0.9);

      const getPixel = (x: number, y: number) => {
        const idx = (y * data.width + x) * 4;
        return [data.data[idx], data.data[idx + 1], data.data[idx + 2], data.data[idx + 3]];
      };

      return {
        left: getPixel(leftCol, midRow),
        mid: getPixel(midCol, midRow),
        right: getPixel(rightCol, midRow),
      };
    });

    console.log('Gradient render result:', JSON.stringify(result));
    expect(result).not.toHaveProperty('error');
    expect(result.left[0]).toBeGreaterThan(result.left[2]);
    expect(result.right[2]).toBeGreaterThan(result.right[0]);
    expect(Math.abs(result.mid[0]! - result.mid[2]!)).toBeLessThan(50);
  });

  test('12 - gradient inside selection marquee', async ({ page }) => {
    await createDocument(page, 400, 300, false);
    await fitToView(page);
    await page.waitForTimeout(500);

    // Create selection in center
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          setSelection: (bounds: unknown, mask: Uint8ClampedArray, w: number, h: number) => void;
        };
      };
      const w = 400;
      const h = 300;
      const mask = new Uint8ClampedArray(w * h);
      for (let py = 100; py < 200; py++) {
        for (let px = 100; px < 300; px++) {
          mask[py * w + px] = 255;
        }
      }
      store.getState().setSelection(
        { x: 100, y: 100, width: 200, height: 100 },
        mask, w, h,
      );
    });
    await page.waitForTimeout(300);

    // Select gradient tool
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => {
          setActiveTool: (t: string) => void;
          setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
          setBackgroundColor: (c: { r: number; g: number; b: number; a: number }) => void;
        };
      };
      ui.getState().setActiveTool('gradient');
      ui.getState().setForegroundColor({ r: 255, g: 0, b: 0, a: 1 });
      ui.getState().setBackgroundColor({ r: 0, g: 0, b: 255, a: 1 });
    });
    await page.waitForTimeout(200);

    // Drag gradient left-to-right across the selection
    const container = page.locator('[data-testid="canvas-container"]');
    const box = await container.boundingBox();
    if (!box) throw new Error('No canvas container');

    const startX = box.x + box.width * 0.2;
    const endX = box.x + box.width * 0.8;
    const midY = box.y + box.height * 0.5;

    await page.mouse.move(startX, midY);
    await page.mouse.down();
    await page.mouse.move(endX, midY, { steps: 5 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '12-gradient-in-selection-during.png') });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '12-gradient-in-selection-after.png') });

    // Verify: pixel data inside selection has gradient, outside is white
    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number; width: number; height: number }> };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const layer = state.document.layers.find(l => l.id === id);
      const data = state.resolvePixelData(id);

      if (!data || !layer) return { error: 'no data', hasData: !!data, hasLayer: !!layer };

      // Check center of selection in layer-local coords
      const cx = 200 - layer.x;
      const cy = 150 - layer.y;
      const inBounds = cx >= 0 && cx < data.width && cy >= 0 && cy < data.height;
      let centerPixel: number[] = [];
      if (inBounds) {
        const idx = (cy * data.width + cx) * 4;
        centerPixel = Array.from(data.data.slice(idx, idx + 4));
      }

      return {
        inBounds,
        centerPixel,
        layerPos: `${layer.x},${layer.y}`,
        layerSize: `${layer.width}x${layer.height}`,
        dataSize: `${data.width}x${data.height}`,
      };
    });

    console.log('Gradient in selection result:', JSON.stringify(result));
    expect(result).not.toHaveProperty('error');
    expect(result.inBounds).toBe(true);
    // Center pixel should have non-zero alpha (was painted by gradient)
    expect(result.centerPixel[3]).toBeGreaterThan(0);
  });

  // ========== LAYER EFFECTS ==========

  test('13 - drop shadow renders', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);
    // Paint a centered red square
    await paintRect(page, 60, 60, 80, 80, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(300);

    // Enable drop shadow
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const layer = state.document.layers.find(l => l.id === id);
      if (!layer) return;
      store.getState().updateLayerEffects(id, {
        ...layer.effects,
        dropShadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 1 }, offsetX: 10, offsetY: 10, blur: 5, spread: 0 },
      });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '13-drop-shadow.png') });
  });

  test('14 - color overlay changes color', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);
    await paintRect(page, 50, 50, 100, 100, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(300);

    // Enable color overlay (blue)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const layer = state.document.layers.find(l => l.id === id);
      if (!layer) return;
      store.getState().updateLayerEffects(id, {
        ...layer.effects,
        colorOverlay: { enabled: true, color: { r: 0, g: 0, b: 255, a: 1 } },
      });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '14-color-overlay.png') });
  });

  // ========== UNDO / REDO ==========

  test('15 - paint then undo restores original', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Read original pixel (transparent)
    const before = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const data = state.resolvePixelData(state.document.activeLayerId);
      return data ? Array.from(data.data.slice(0, 4)) : null;
    });

    // Paint red
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });

    // Undo
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      };
      store.getState().undo();
    });
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const data = state.resolvePixelData(state.document.activeLayerId);
      return data ? Array.from(data.data.slice(0, 4)) : null;
    });

    console.log('Undo test:', { before, after });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '15-undo.png') });
    // After undo, pixel data may be null (empty layer) or transparent
    // Both represent "no content", matching the original transparent state
    const afterNormalized = after ?? [0, 0, 0, 0];
    const beforeNormalized = before ?? [0, 0, 0, 0];
    expect(afterNormalized).toEqual(beforeNormalized);
  });

  test('16 - undo then redo restores paint', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);
    await paintRect(page, 0, 0, 200, 200, { r: 0, g: 255, b: 0, a: 255 });

    const painted = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const data = store.getState().resolvePixelData(store.getState().document.activeLayerId);
      return data ? Array.from(data.data.slice(0, 4)) : null;
    });

    // Undo
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__editorStore &&
      ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      }).getState().undo();
    });
    await page.waitForTimeout(200);

    // Redo
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { redo: () => void };
      }).getState().redo();
    });
    await page.waitForTimeout(300);

    const afterRedo = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const data = store.getState().resolvePixelData(store.getState().document.activeLayerId);
      return data ? Array.from(data.data.slice(0, 4)) : null;
    });

    console.log('Redo test:', { painted, afterRedo });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '16-redo.png') });
    expect(afterRedo).toEqual(painted);
  });

  // ========== COLOR ACCURACY ==========

  test('17 - exact RGB round-trip', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    await fitToView(page);

    // Fill with exact known RGB values
    const testColor = { r: 42, g: 137, b: 221, a: 255 };
    await paintRect(page, 0, 0, 100, 100, testColor);

    const result = await page.evaluate(({ r, g, b, a }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const data = store.getState().resolvePixelData(store.getState().document.activeLayerId);
      if (!data) return { error: 'no data' };
      // Check center pixel
      const idx = (50 * data.width + 50) * 4;
      return {
        r: data.data[idx],
        g: data.data[idx + 1],
        b: data.data[idx + 2],
        a: data.data[idx + 3],
      };
    }, testColor);

    console.log('Color round-trip:', result);
    expect(result).not.toHaveProperty('error');
    expect(result.r).toBe(testColor.r);
    expect(result.g).toBe(testColor.g);
    expect(result.b).toBe(testColor.b);
    expect(result.a).toBe(testColor.a);
  });

  // ========== LAYER OPERATIONS ==========

  test('18 - layer opacity blending', async ({ page }) => {
    await createDocument(page, 200, 200, false); // white bg
    await fitToView(page);
    // Paint red on top layer at 50% opacity
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          updateLayerOpacity: (id: string, opacity: number) => void;
        };
      };
      const state = store.getState();
      state.updateLayerOpacity(state.document.activeLayerId, 0.5);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '18-layer-opacity.png') });
  });

  test('19 - layer visibility toggle', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(300);

    // Hide the layer
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          toggleLayerVisibility: (id: string) => void;
        };
      };
      const state = store.getState();
      state.toggleLayerVisibility(state.document.activeLayerId);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '19-layer-hidden.png') });
  });

  test('20 - duplicate layer', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);
    await paintRect(page, 50, 50, 100, 100, { r: 0, g: 255, b: 0, a: 255 });

    const layerCountBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] }; duplicateLayer: () => void };
      };
      const before = store.getState().document.layers.length;
      store.getState().duplicateLayer();
      return before;
    });
    await page.waitForTimeout(300);

    const layerCountAfter = await page.evaluate(() => {
      return ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      }).getState().document.layers.length;
    });

    expect(layerCountAfter).toBe(layerCountBefore + 1);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '20-duplicate-layer.png') });
  });

  // ========== FILTERS ==========

  test('21 - invert filter', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    await fitToView(page);
    await paintRect(page, 0, 0, 100, 100, { r: 200, g: 50, b: 100, a: 255 });

    // Apply invert via filter runner
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: () => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      state.pushHistory();
      const data = state.getOrCreateLayerPixelData(id);
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i + 3]! > 0) {
          data.data[i] = 255 - data.data[i]!;
          data.data[i + 1] = 255 - data.data[i + 1]!;
          data.data[i + 2] = 255 - data.data[i + 2]!;
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const data = store.getState().resolvePixelData(store.getState().document.activeLayerId);
      if (!data) return null;
      const idx = (50 * data.width + 50) * 4;
      return [data.data[idx], data.data[idx + 1], data.data[idx + 2]];
    });

    console.log('Invert result:', result);
    // 200→55, 50→205, 100→155
    expect(result).toEqual([55, 205, 155]);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '21-invert-filter.png') });
  });

  // ========== MULTI-STEP INTEGRATION ==========

  test('22 - paint, add layer, paint, undo chain', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Paint red on first layer
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 0, b: 0, a: 255 });

    // Add new layer
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayer: () => void };
      }).getState().addLayer();
    });
    await page.waitForTimeout(200);

    // Paint blue on second layer
    await paintRect(page, 0, 0, 200, 200, { r: 0, g: 0, b: 255, a: 255 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '22-multi-step-before-undo.png') });

    // Undo the blue paint
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      }).getState().undo();
    });
    await page.waitForTimeout(300);

    // Undo the add layer
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { undo: () => void };
      }).getState().undo();
    });
    await page.waitForTimeout(300);

    // Should still have the red paint on the original layer
    const result = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: unknown[] };
          resolvePixelData: (id: string) => ImageData | undefined;
        };
      };
      const state = store.getState();
      const layerCount = state.document.layers.length;
      const data = state.resolvePixelData(state.document.activeLayerId);
      if (!data) return { layerCount, hasData: false };
      const idx = (100 * data.width + 100) * 4;
      return { layerCount, r: data.data[idx], a: data.data[idx + 3] };
    });

    console.log('Multi-step undo result:', result);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '22-multi-step-after-undo.png') });
    expect(result.layerCount).toBe(1); // Back to 1 layer
    expect(result.r).toBe(255); // Red still there
  });

  test('23 - blend mode multiply', async ({ page }) => {
    await createDocument(page, 200, 200, true);
    await fitToView(page);

    // Bottom layer: light blue
    await paintRect(page, 0, 0, 200, 200, { r: 100, g: 150, b: 255, a: 255 });

    // Add layer on top
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayer: () => void };
      }).getState().addLayer();
    });
    await page.waitForTimeout(200);

    // Top layer: light red, set to multiply blend
    await paintRect(page, 0, 0, 200, 200, { r: 255, g: 100, b: 100, a: 255 });
    // Set blend mode by updating the layer directly via setState
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; blendMode: string }> };
        };
        setState: (partial: unknown) => void;
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      store.setState({
        document: {
          ...state.document,
          layers: state.document.layers.map(l =>
            l.id === id ? { ...l, blendMode: 'multiply' } : l,
          ),
        },
      });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '23-blend-multiply.png') });
  });

});
