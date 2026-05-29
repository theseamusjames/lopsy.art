import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

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

async function getActiveTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function readLayer(page: Page, layerId?: string): Promise<PixelSnapshot> {
  const result = await page.evaluate((lid) => {
    return ((window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<PixelSnapshot | null>)(lid ?? undefined);
  }, layerId ?? null);
  return result ?? { width: 0, height: 0, pixels: [] };
}

/** Read a pixel from a layer snapshot in doc coordinates. */
function snapshotPixelAt(
  snap: PixelSnapshot,
  docX: number,
  docY: number,
  layerX: number,
  layerY: number,
) {
  const localX = docX - layerX;
  const localY = docY - layerY;
  if (localX < 0 || localX >= snap.width || localY < 0 || localY >= snap.height) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const idx = (localY * snap.width + localX) * 4;
  return {
    r: snap.pixels[idx] ?? 0,
    g: snap.pixels[idx + 1] ?? 0,
    b: snap.pixels[idx + 2] ?? 0,
    a: snap.pixels[idx + 3] ?? 0,
  };
}

/** Count opaque pixels in a snapshot. */
function countOpaque(snap: PixelSnapshot, threshold = 10): number {
  let count = 0;
  for (let i = 3; i < snap.pixels.length; i += 4) {
    if ((snap.pixels[i] ?? 0) > threshold) count++;
  }
  return count;
}

/** Paint a filled rectangle onto the active layer via store. */
async function paintDocRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number },
) {
  await page.evaluate(
    ({ x, y, w, h, color }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: () => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const dw = state.document.width;
      const dh = state.document.height;
      const data = new ImageData(dw, dh);
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px < 0 || px >= dw || py < 0 || py >= dh) continue;
          const idx = (py * dw + px) * 4;
          data.data[idx] = color.r;
          data.data[idx + 1] = color.g;
          data.data[idx + 2] = color.b;
          data.data[idx + 3] = 255;
        }
      }
      state.pushHistory();
      state.updateLayerPixelData(id, data);
    },
    { x, y, w, h, color },
  );
  // Wait for GPU upload
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Healing Brush Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('healing brush tool is visible in the toolbox', async ({ page }) => {
    const healingButton = page.locator('[data-tool-id="healing"]');
    await expect(healingButton).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/healing-brush-01-toolbox.png' });
  });

  test('keyboard shortcut h activates healing brush', async ({ page }) => {
    await page.keyboard.press('h');
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('healing');
    await page.screenshot({ path: 'e2e/screenshots/healing-brush-02-active-options.png' });
  });

  test('clicking healing brush button in toolbox activates it', async ({ page }) => {
    await page.locator('[data-tool-id="healing"]').click();
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('healing');
  });

  test('options bar shows Size and Opacity sliders when healing brush is active', async ({ page }) => {
    await page.keyboard.press('h');
    await page.waitForTimeout(100);

    // The Slider component renders the label as a <span>, not <label>
    const sizeSlider = page.locator('input[aria-label="Size"]');
    await expect(sizeSlider).toBeVisible();

    const opacitySlider = page.locator('input[aria-label="Opacity"]');
    await expect(opacitySlider).toBeVisible();
  });

  test('options bar shows Alt+click hint when healing brush is active', async ({ page }) => {
    await page.keyboard.press('h');
    await page.waitForTimeout(100);

    const hint = page.locator('[class*="hint"]', { hasText: 'Alt' });
    await expect(hint).toBeVisible();
  });

  test('healing brush paints onto the layer when source and destination are set', async ({ page }) => {
    test.setTimeout(120_000);

    // Paint a blue background with a red "blemish" patch in a single ImageData
    // so both regions coexist on the same layer texture.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: () => void;
        };
      };
      const state = store.getState();
      const id = state.document.activeLayerId;
      const dw = state.document.width;
      const dh = state.document.height;
      const data = new ImageData(dw, dh);
      // Fill entire canvas blue
      for (let py = 0; py < dh; py++) {
        for (let px = 0; px < dw; px++) {
          const idx = (py * dw + px) * 4;
          data.data[idx] = 0;
          data.data[idx + 1] = 0;
          data.data[idx + 2] = 200;
          data.data[idx + 3] = 255;
        }
      }
      // Overwrite center with red blemish (150,100)–(250,200)
      for (let py = 100; py < 200; py++) {
        for (let px = 150; px < 250; px++) {
          const idx = (py * dw + px) * 4;
          data.data[idx] = 200;
          data.data[idx + 1] = 0;
          data.data[idx + 2] = 0;
          data.data[idx + 3] = 255;
        }
      }
      state.pushHistory();
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(300);

    // Activate the healing brush
    await page.keyboard.press('h');
    await page.waitForTimeout(100);
    expect(await getActiveTool(page)).toBe('healing');

    // Alt+click to set source point at doc (50, 50) — the blue area
    const sourceScreen = await docToScreen(page, 50, 50);
    await page.mouse.move(sourceScreen.x, sourceScreen.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(100);

    // Take a before screenshot of the layer
    const activeLayerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });

    const before = await readLayer(page, activeLayerId);

    // Now heal the center of the red area at doc (200, 150) with a short stroke
    const healStart = await docToScreen(page, 190, 140);
    const healEnd = await docToScreen(page, 210, 160);
    await page.mouse.move(healStart.x, healStart.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      await page.mouse.move(
        healStart.x + (healEnd.x - healStart.x) * t,
        healStart.y + (healEnd.y - healStart.y) * t,
      );
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Push history to merge pending GPU/JS writes
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: () => void };
      };
      store.getState().pushHistory();
    });
    await page.waitForTimeout(200);

    const after = await readLayer(page, activeLayerId);

    await page.screenshot({ path: 'e2e/screenshots/healing-brush-03-after-heal.png' });

    // Verify the layer has opaque pixels (the healing brush wrote something)
    const opaqueBefore = countOpaque(before);
    const opaqueAfter = countOpaque(after);
    expect(opaqueBefore).toBeGreaterThan(0);
    expect(opaqueAfter).toBeGreaterThan(0);

    // The number of opaque pixels should be approximately preserved
    expect(opaqueAfter).toBeGreaterThan(opaqueBefore * 0.5);

    // At the heal point (200, 150), verify the pixel changed compared to
    // the pre-heal snapshot. The layer is at (0,0) after updateLayerPixelData.
    const layerX = 0;
    const layerY = 0;
    const beforePixel = snapshotPixelAt(before, 200, 150, layerX, layerY);
    const afterPixel = snapshotPixelAt(after, 200, 150, layerX, layerY);

    // Before: center of red patch was red
    expect(beforePixel.r).toBeGreaterThan(100);
    expect(beforePixel.b).toBeLessThan(100);

    // After healing: the pixel should have moved toward the destination blue tone
    // (healing reduces the red channel and increases blue)
    const redDiff = beforePixel.r - afterPixel.r;
    const blueDiff = afterPixel.b - beforePixel.b;
    // At least some color shift must have occurred
    expect(redDiff + blueDiff).toBeGreaterThan(0);
  });
});
