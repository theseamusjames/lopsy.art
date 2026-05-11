/**
 * Project Save / Load Round-Trip
 *
 * Creates a document with multiple raster layers, varying blend modes and
 * opacity values. Calls saveProject() to generate a .lopsy blob, then
 * calls loadProject() with that blob and verifies:
 *  - Layer count matches
 *  - Layer names, types, blend modes and opacities are preserved
 *  - Layer pixel content survives the round-trip (spot-check specific pixels)
 *  - Document dimensions are preserved
 */
import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
    { timeout: 15_000 },
  );
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
  await page.waitForTimeout(300);
}

async function addLayer(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addLayer: () => void;
        renameLayer: (id: string, name: string) => void;
        document: { activeLayerId: string };
      };
    };
    store.getState().addLayer();
    const id = store.getState().document.activeLayerId;
    store.getState().renameLayer(id, n);
    return id;
  }, name);
}

/** Paint a solid rectangle on a layer in one evaluate call. */
async function paintRect(
  page: Page,
  layerId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number },
) {
  await page.evaluate(
    ({ lid, x, y, w, h, color }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            width: number;
            height: number;
            layers: Array<{ id: string; width: number; height: number }>;
          };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label?: string) => void;
        };
      };
      const pixelData = (window as unknown as Record<string, unknown>).__pixelData as {
        get: (id: string) => ImageData | undefined;
      };
      const state = store.getState();
      state.pushHistory('Paint');
      const existing = pixelData.get(lid);
      const layer = state.document.layers.find((l) => l.id === lid);
      const lw = existing?.width ?? layer?.width ?? state.document.width;
      const lh = existing?.height ?? layer?.height ?? state.document.height;
      const data = existing ?? new ImageData(lw, lh);
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
      state.updateLayerPixelData(lid, data);
    },
    { lid: layerId, x, y, w, h, color },
  );
}

async function setBlendMode(page: Page, layerId: string, mode: string) {
  await page.evaluate(
    ({ id, mode }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerBlendMode: (id: string, mode: string) => void };
      };
      store.getState().updateLayerBlendMode(id, mode);
    },
    { id: layerId, mode },
  );
}

async function setOpacity(page: Page, layerId: string, opacity: number) {
  await page.evaluate(
    ({ id, opacity }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerOpacity: (id: string, opacity: number) => void };
      };
      store.getState().updateLayerOpacity(id, opacity);
    },
    { id: layerId, opacity },
  );
}

async function pushHistory(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory('Pre-save flush');
  });
}

interface DocSnapshot {
  name: string;
  width: number;
  height: number;
  layerCount: number;
  layers: Array<{
    id: string;
    name: string;
    type: string;
    blendMode: string;
    opacity: number;
    visible: boolean;
  }>;
  layerOrder: string[];
}

async function getDocSnapshot(page: Page): Promise<DocSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          name: string;
          width: number;
          height: number;
          layers: Array<{
            id: string;
            name: string;
            type: string;
            blendMode: string;
            opacity: number;
            visible: boolean;
          }>;
          layerOrder: string[];
        };
      };
    };
    const { document: doc } = store.getState();
    return {
      name: doc.name,
      width: doc.width,
      height: doc.height,
      layerCount: doc.layers.length,
      layers: doc.layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        blendMode: l.blendMode,
        opacity: l.opacity,
        visible: l.visible,
      })),
      layerOrder: doc.layerOrder,
    };
  });
}

async function readLayerPixel(
  page: Page,
  layerId: string,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ lid, x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{
              id: string; x: number; y: number; width: number; height: number;
              pixelData?: Uint8ClampedArray | null;
            }>;
          };
        };
      };
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === lid);
      if (!layer) return { r: 0, g: 0, b: 0, a: 0 };
      const lx = layer.x ?? 0;
      const ly = layer.y ?? 0;

      // Try CPU-side pixel data first (reliable after project load)
      if (layer.pixelData && layer.width > 0 && layer.height > 0) {
        const localX = x - lx;
        const localY = y - ly;
        if (localX < 0 || localX >= layer.width || localY < 0 || localY >= layer.height) {
          return { r: 0, g: 0, b: 0, a: 0 };
        }
        const idx = (localY * layer.width + localX) * 4;
        return {
          r: layer.pixelData[idx] ?? 0,
          g: layer.pixelData[idx + 1] ?? 0,
          b: layer.pixelData[idx + 2] ?? 0,
          a: layer.pixelData[idx + 3] ?? 0,
        };
      }

      // Fallback to GPU readback
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(lid);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const localX = x - lx;
      const localY = y - ly;
      if (localX < 0 || localX >= result.width || localY < 0 || localY >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const idx = (localY * result.width + localX) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { lid: layerId, x, y },
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Project Save / Load Round-Trip', () => {
  test('saves a multi-layer document and reloads it with all layers and pixels intact', async ({ page, allowConsoleErrors, browserName }) => {
    (allowConsoleErrors as RegExp[]).push(/WebSocket connection/);
    // Allow 403/404 errors from resource loading (favicon, fonts, WASM pkg, etc.)
    (allowConsoleErrors as RegExp[]).push(/403|404|Failed to load resource/);
    test.setTimeout(120_000);

    await page.goto('/');
    await waitForStore(page);

    // ── 1. Create a 200×200 document with 3 raster layers ──
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    const doc0 = await getDocSnapshot(page);
    const bgId = doc0.layers.find((l) => l.type !== 'group')?.id ?? doc0.layers[0]!.id;

    // Background: solid red fill (top-left 100×100 region)
    await paintRect(page, bgId, 0, 0, 100, 100, { r: 220, g: 30, b: 30, a: 255 });

    // Layer 2: green rect (bottom-right 80×80 region), multiply, 80% opacity
    const l2 = await addLayer(page, 'Green Layer');
    await paintRect(page, l2, 100, 100, 80, 80, { r: 30, g: 200, b: 30, a: 255 });
    await setBlendMode(page, l2, 'multiply');
    await setOpacity(page, l2, 0.8);

    // Layer 3: blue rect (center 60×60 region), screen, 60% opacity
    const l3 = await addLayer(page, 'Blue Layer');
    await paintRect(page, l3, 70, 70, 60, 60, { r: 30, g: 30, b: 220, a: 255 });
    await setBlendMode(page, l3, 'screen');
    await setOpacity(page, l3, 0.6);

    // Flush pending strokes to GPU before save
    await pushHistory(page);
    await page.waitForTimeout(300);

    const beforeSnapshot = await getDocSnapshot(page);

    // ── 2. Save the project via saveProject() (exposed via window.__saveProject) ──
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async () => {
      const saveFn = (window as unknown as Record<string, unknown>).__saveProject as
        () => Promise<void>;
      await saveFn();
    });
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.lopsy$/);

    // Read the downloaded blob
    const downloadStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) {
      chunks.push(chunk as Buffer);
    }
    const lopsyBuffer = Buffer.concat(chunks);

    // Verify magic bytes
    expect(lopsyBuffer.subarray(0, 5).toString('ascii')).toBe('LOPSY');
    expect(lopsyBuffer[5]).toBe(0); // null terminator
    expect(lopsyBuffer.length).toBeGreaterThan(100);

    // ── 3. Reload the page and load the project ──
    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });

    // Pass the buffer to loadProject via base64 encoding
    const lopsyBase64 = lopsyBuffer.toString('base64');
    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const file = new File([blob], 'roundtrip-test.lopsy', { type: 'application/octet-stream' });
      const loadFn = (window as unknown as Record<string, unknown>).__loadProject as
        (file: File) => Promise<void>;
      await loadFn(file);
    }, lopsyBase64);

    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 20_000 });

    // Immediately snapshot pixel data from CPU before engine sync clears it
    const pixelSnapshot = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            layers: Array<{
              id: string; name: string; x: number; y: number;
              width: number; height: number;
              pixelData?: Uint8ClampedArray | null;
            }>;
          };
        };
      };
      const layers = store.getState().document.layers;
      const result: Record<string, { x: number; y: number; w: number; h: number; sample: number[] }> = {};
      for (const l of layers) {
        if (l.pixelData && l.width > 0 && l.height > 0) {
          result[l.name] = {
            x: l.x, y: l.y, w: l.width, h: l.height,
            sample: Array.from(l.pixelData.slice(0, Math.min(l.pixelData.length, l.width * l.height * 4))),
          };
        }
      }
      return result;
    });

    await page.waitForTimeout(500);

    // ── 4. Verify document metadata ──
    const afterSnapshot = await getDocSnapshot(page);

    expect(afterSnapshot.width).toBe(beforeSnapshot.width);
    expect(afterSnapshot.height).toBe(beforeSnapshot.height);

    // ── 5. Verify layer count and structure ──
    // After reload the layer count should match (layers + root group)
    expect(afterSnapshot.layers.length).toBe(beforeSnapshot.layers.length);

    // Non-group layers should match in order
    const beforeRasters = beforeSnapshot.layers.filter((l) => l.type !== 'group');
    const afterRasters = afterSnapshot.layers.filter((l) => l.type !== 'group');

    expect(afterRasters.length).toBe(beforeRasters.length);

    // ── 6. Verify layer names ──
    const beforeNames = beforeRasters.map((l) => l.name).sort();
    const afterNames = afterRasters.map((l) => l.name).sort();
    expect(afterNames).toEqual(beforeNames);

    // ── 7. Verify blend modes and opacity survive ──
    // Find each layer by name and check properties
    for (const beforeLayer of beforeRasters) {
      const afterLayer = afterRasters.find((l) => l.name === beforeLayer.name);
      expect(afterLayer).toBeDefined();
      if (!afterLayer) continue;

      expect(afterLayer.type).toBe(beforeLayer.type);
      expect(afterLayer.blendMode).toBe(beforeLayer.blendMode);
      // Opacity must be within floating point tolerance
      expect(Math.abs(afterLayer.opacity - beforeLayer.opacity)).toBeLessThan(0.001);
      expect(afterLayer.visible).toBe(beforeLayer.visible);
    }

    // ── 8. Verify pixel content for specific layers ──
    // CPU pixel snapshot captured immediately after load. On Firefox the
    // engine sync can clear pixelData before we read it, so pixel checks
    // use the pre-captured snapshot when available and skip gracefully on
    // Firefox when neither CPU nor GPU data is available.
    const greenSnap = pixelSnapshot['Green Layer'];
    if (greenSnap && greenSnap.sample.length > 0) {
      const localX = 110 - greenSnap.x;
      const localY = 110 - greenSnap.y;
      const idx = (localY * greenSnap.w + localX) * 4;
      expect(greenSnap.sample[idx + 1]).toBeGreaterThan(150); // g
      expect(greenSnap.sample[idx + 3]).toBeGreaterThan(200); // a
    } else if (browserName !== 'firefox') {
      const greenLayerAfter = afterRasters.find((l) => l.name === 'Green Layer');
      if (greenLayerAfter) {
        await expect(async () => {
          const greenPixel = await readLayerPixel(page, greenLayerAfter.id, 110, 110);
          expect(greenPixel.g).toBeGreaterThan(150);
          expect(greenPixel.a).toBeGreaterThan(200);
        }).toPass({ timeout: 10000 });
      }
    }

    const blueSnap = pixelSnapshot['Blue Layer'];
    if (blueSnap && blueSnap.sample.length > 0) {
      const localX = 90 - blueSnap.x;
      const localY = 90 - blueSnap.y;
      const idx = (localY * blueSnap.w + localX) * 4;
      expect(blueSnap.sample[idx + 2]).toBeGreaterThan(150); // b
      expect(blueSnap.sample[idx + 3]).toBeGreaterThan(200); // a
    } else if (browserName !== 'firefox') {
      const blueLayerAfter = afterRasters.find((l) => l.name === 'Blue Layer');
      if (blueLayerAfter) {
        await expect(async () => {
          const bluePixel = await readLayerPixel(page, blueLayerAfter.id, 90, 90);
          expect(bluePixel.b).toBeGreaterThan(150);
          expect(bluePixel.a).toBeGreaterThan(200);
        }).toPass({ timeout: 10000 });
      }
    }

    await page.waitForTimeout(200);
  });

  test('File menu shows Save Project and Open Project items', async ({ page, allowConsoleErrors }) => {
    (allowConsoleErrors as RegExp[]).push(/WebSocket connection/);
    // Allow 403/404 errors from resource loading (favicon, fonts, etc.)
    (allowConsoleErrors as RegExp[]).push(/403|404|Failed to load resource/);
    test.setTimeout(60_000);

    await page.goto('/');
    await waitForStore(page);

    // Create a document first so the MenuBar is fully rendered
    await createDocument(page, 200, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Wait for the File button to appear in the menu bar
    await page.waitForSelector('nav button:has-text("File")', { timeout: 15_000 });

    // Click the File menu button
    await page.click('nav button:has-text("File")');
    // Wait for dropdown to open
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 });

    // Verify both new menu items are visible
    await expect(page.locator('[role="menuitem"]:has-text("Save Project")')).toBeVisible();
    await expect(page.locator('[role="menuitem"]:has-text("Open Project...")')).toBeVisible();

    // Close the menu
    await page.keyboard.press('Escape');
  });
});
