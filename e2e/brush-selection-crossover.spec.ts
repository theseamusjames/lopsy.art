import { test, expect, type Page } from './fixtures';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width: number, height: number, transparent = false) {
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

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(
    ({ setter, value }) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => Record<string, (v: unknown) => void>;
      };
      store.getState()[setter]!(value);
    },
    { setter, value },
  );
}

async function setForegroundColor(page: Page, color: { r: number; g: number; b: number; a: number }) {
  await page.evaluate((c) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setForegroundColor: (c: unknown) => void };
    };
    store.getState().setForegroundColor(c);
  }, color);
}

async function readCompositedPixelAt(page: Page, docX: number, docY: number) {
  return page.evaluate(async ({ docX, docY }) => {
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
    const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    if (!container) return { r: 0, g: 0, b: 0, a: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
    const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(screenX * dpr);
    const py = result.height - 1 - Math.round(screenY * dpr);
    if (px < 0 || px >= result.width || py < 0 || py >= result.height) return { r: 0, g: 0, b: 0, a: 0 };
    const idx = (py * result.width + px) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { docX, docY });
}

async function setup(page: Page) {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 400, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
}

async function selectBrushWithRed(page: Page) {
  await page.keyboard.press('b');
  await page.waitForTimeout(50);
  await setToolSetting(page, 'setBrushSize', 100);
  await setToolSetting(page, 'setBrushHardness', 100);
  await setToolSetting(page, 'setBrushOpacity', 100);
  await setToolSetting(page, 'setBrushSpacing', 10);
  await setForegroundColor(page, { r: 255, g: 0, b: 0, a: 1 });
}

async function addTransparentLayerAndActivate(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addLayer: () => void;
        document: { layers: Array<{ id: string }>; activeLayerId: string };
      };
    };
    store.getState().addLayer();
    return store.getState().document.activeLayerId;
  });
}

/** Paint a filled circle into a layer via direct pixel manipulation. */
async function paintCircle(
  page: Page,
  cx: number,
  cy: number,
  radius: number,
  color: { r: number; g: number; b: number; a: number },
  layerId: string,
): Promise<void> {
  await page.evaluate(
    ({ cx, cy, radius, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number; layers: Array<{ id: string; width: number; height: number }> };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => ImageData | undefined;
      };
      const state = store.getState();
      state.pushHistory('Paint Circle');
      const existing = pixelData.get(lid);
      const layer = state.document.layers.find((l) => l.id === lid);
      const lw = existing?.width ?? layer?.width ?? state.document.width;
      const lh = existing?.height ?? layer?.height ?? state.document.height;
      const data = existing ?? new ImageData(lw, lh);
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= radius * radius) {
            const idx = (y * data.width + x) * 4;
            data.data[idx] = color.r;
            data.data[idx + 1] = color.g;
            data.data[idx + 2] = color.b;
            data.data[idx + 3] = color.a;
          }
        }
      }
      state.updateLayerPixelData(lid, data);
    },
    { cx, cy, radius, color, lid: layerId },
  );
}

/** Build a selection from the layer's alpha (equivalent to cmd-clicking the thumbnail). */
async function selectLayerAlpha(page: Page, layerId: string) {
  await page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number; layers: Array<{ id: string; x: number; y: number }> };
        resolvePixelData: (id: string) => ImageData | null;
        setSelection: (bounds: { x: number; y: number; width: number; height: number }, mask: Uint8ClampedArray, w: number, h: number) => void;
      };
    };
    const state = store.getState();
    const layer = state.document.layers.find((l) => l.id === lid);
    if (!layer) return;
    const pixels = state.resolvePixelData(lid);
    if (!pixels) return;
    const docW = state.document.width;
    const docH = state.document.height;
    const mask = new Uint8ClampedArray(docW * docH);
    let minX = docW, minY = docH, maxX = -1, maxY = -1;
    for (let y = 0; y < pixels.height; y++) {
      for (let x = 0; x < pixels.width; x++) {
        const a = pixels.data[(y * pixels.width + x) * 4 + 3] ?? 0;
        if (a < 1) continue;
        const dx = x + layer.x;
        const dy = y + layer.y;
        if (dx < 0 || dx >= docW || dy < 0 || dy >= docH) continue;
        mask[dy * docW + dx] = a;
        if (dx < minX) minX = dx;
        if (dy < minY) minY = dy;
        if (dx > maxX) maxX = dx;
        if (dy > maxY) maxY = dy;
      }
    }
    if (maxX < 0) return;
    state.setSelection(
      { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      mask,
      docW,
      docH,
    );
  }, layerId);
  await page.waitForTimeout(100);
}

async function setActiveLayer(page: Page, layerId: string) {
  await page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { setActiveLayer: (id: string) => void };
    };
    store.getState().setActiveLayer(lid);
  }, layerId);
  await page.waitForTimeout(100);
}

// =====================================================================

test.describe('Brush across selection boundary', () => {
  test('red stroke through selected circle persists after mouseup', async ({ page }) => {
    await setup(page);

    // Circle layer has a black circle at center; selection follows its alpha.
    const circleLayerId = await addTransparentLayerAndActivate(page);
    await paintCircle(page, 200, 200, 60, { r: 0, g: 0, b: 0, a: 255 }, circleLayerId);
    await selectLayerAlpha(page, circleLayerId);

    // Sanity: selection is active.
    const selState = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });
    expect(selState).toBe(true);

    await selectBrushWithRed(page);

    // Draw across the selection (left-outside → right-outside, through the circle).
    await drawStroke(page, { x: 80, y: 200 }, { x: 320, y: 200 }, 20);

    // After release, the stroke inside the selection must still be visible.
    // Center of circle — well inside the selection — should be red.
    const center = await readCompositedPixelAt(page, 200, 200);
    expect(center.r).toBeGreaterThan(200);
    expect(center.g).toBeLessThan(60);
    expect(center.b).toBeLessThan(60);

    // Outside the selection the background (opaque white) must remain — the
    // brush must NOT bleed into non-selected area.
    const outsideLeft = await readCompositedPixelAt(page, 100, 200);
    expect(outsideLeft.r).toBeGreaterThan(200);
    expect(outsideLeft.g).toBeGreaterThan(200);
    expect(outsideLeft.b).toBeGreaterThan(200);
  });

  test('drawing on background layer with foreign-layer selection still paints', async ({ page }) => {
    await setup(page);

    // Build a circle on a top layer, then turn it into a selection.
    const circleLayerId = await addTransparentLayerAndActivate(page);
    await paintCircle(page, 200, 200, 60, { r: 0, g: 0, b: 0, a: 255 }, circleLayerId);
    await selectLayerAlpha(page, circleLayerId);

    // Switch to background layer (index 0 in layerOrder).
    const bgLayerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layerOrder: string[] } };
      };
      return store.getState().document.layerOrder[0]!;
    });
    await setActiveLayer(page, bgLayerId);

    // Confirm selection is still active after the switch.
    const selActive = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { active: boolean } };
      };
      return store.getState().selection.active;
    });
    expect(selActive).toBe(true);

    await selectBrushWithRed(page);

    // Draw anywhere inside the selection — the stroke should land on the bg layer.
    await drawStroke(page, { x: 150, y: 200 }, { x: 250, y: 200 }, 10);

    // Hide the top circle layer so we can read the bg layer through the composite.
    await page.evaluate((lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { toggleLayerVisibility: (id: string) => void };
      };
      store.getState().toggleLayerVisibility(lid);
    }, circleLayerId);
    await page.waitForTimeout(100);

    // Sample at the center of where the red was drawn (inside the selection).
    const center = await readCompositedPixelAt(page, 200, 200);
    expect(center.r).toBeGreaterThan(200);
    expect(center.g).toBeLessThan(60);
    expect(center.b).toBeLessThan(60);

    // Outside the selection (far left) must remain the bg white — the selection
    // from the now-inactive layer still clips the stroke to bg.
    const outside = await readCompositedPixelAt(page, 50, 200);
    expect(outside.r).toBeGreaterThan(200);
    expect(outside.g).toBeGreaterThan(200);
    expect(outside.b).toBeGreaterThan(200);
  });
});
