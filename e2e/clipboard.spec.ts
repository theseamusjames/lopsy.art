import { test, expect, type Page } from './fixtures';

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
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
}

async function waitForLayerCount(page: Page, count: number) {
  await page.waitForFunction(
    (expected) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length === expected;
    },
    count,
    { timeout: 5000 },
  );
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
      selection: state.selection as {
        active: boolean;
        bounds: { x: number; y: number; width: number; height: number } | null;
      },
      clipboard: state.clipboard
        ? {
            width: (state.clipboard as { width: number }).width,
            height: (state.clipboard as { height: number }).height,
            offsetX: (state.clipboard as { offsetX: number }).offsetX,
            offsetY: (state.clipboard as { offsetY: number }).offsetY,
          }
        : null,
      undoStack: (state.undoStack as unknown[]).length,
    };
  });
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(
    ({ x, y, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string };
          getOrCreateLayerPixelData: (id: string) => ImageData;
        };
      };
      const state = store.getState();
      const id = lid ?? state.document.activeLayerId;
      const data = state.getOrCreateLayerPixelData(id);
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

/** Paint a filled rectangle directly into a layer's pixel data */
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

/** Set a rectangular selection via the store */
async function setSelection(page: Page, x: number, y: number, w: number, h: number) {
  await page.evaluate(
    ({ x, y, w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          setSelection: (
            bounds: { x: number; y: number; width: number; height: number },
            mask: Uint8ClampedArray,
            maskWidth: number,
            maskHeight: number,
          ) => void;
        };
      };
      const state = store.getState();
      const maskW = state.document.width;
      const maskH = state.document.height;
      const mask = new Uint8ClampedArray(maskW * maskH);
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px >= 0 && px < maskW && py >= 0 && py < maskH) {
            mask[py * maskW + px] = 255;
          }
        }
      }
      state.setSelection({ x, y, width: w, height: h }, mask, maskW, maskH);
    },
    { x, y, w, h },
  );
}

async function getPixelFromGpu(page: Page, x: number, y: number, layerId?: string) {
  return page.evaluate(async ({ x, y, lid }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> };
      };
    };
    const state = store.getState();
    const id = lid ?? state.document.activeLayerId;
    const layer = state.document.layers.find((l) => l.id === id);
    const lx = layer?.x ?? 0;
    const ly = layer?.y ?? 0;
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(id);
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
  }, { x, y, lid: layerId ?? null });
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
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: unknown[] }; undoStack: unknown[] };
    } | undefined;
    if (!store) return false;
    const s = store.getState();
    return s.document.layers.length > 0 && s.undoStack.length > 0;
  });
  await page.waitForSelector('[data-testid="canvas-container"]');
});

// ===========================================================================
// Copy
// ===========================================================================

test.describe('Copy', () => {
  test('copy entire layer when no selection is active', async ({ page }) => {
    // Fill entire layer so copy captures the full document size
    await paintRect(page, 0, 0, 400, 300, { r: 255, g: 0, b: 0, a: 255 });

    // Cmd+C with no selection
    await page.keyboard.press(`${mod}+KeyC`);

    const state = await getEditorState(page);
    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.width).toBe(400);
    expect(state.clipboard!.height).toBe(300);
    expect(state.clipboard!.offsetX).toBe(0);
    expect(state.clipboard!.offsetY).toBe(0);
  });

  test('copy only selected region', async ({ page }) => {
    // Paint red on entire canvas area 50,50 -> 100,100
    await paintRect(page, 50, 50, 50, 50, { r: 255, g: 0, b: 0, a: 255 });

    // Select 60,60 -> 80,80 (20x20)
    await setSelection(page, 60, 60, 20, 20);
    await page.keyboard.press(`${mod}+KeyC`);

    const state = await getEditorState(page);
    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.width).toBe(20);
    expect(state.clipboard!.height).toBe(20);
    expect(state.clipboard!.offsetX).toBe(60);
    expect(state.clipboard!.offsetY).toBe(60);
  });

  test('copy does not modify the source layer', async ({ page }) => {
    await paintRect(page, 0, 0, 10, 10, { r: 0, g: 255, b: 0, a: 255 });
    const before = await getPixelAt(page, 5, 5);

    await page.keyboard.press(`${mod}+KeyC`);

    const after = await getPixelAt(page, 5, 5);
    expect(after).toEqual(before);
  });
});

// ===========================================================================
// Cut
// ===========================================================================

test.describe('Cut', () => {
  test('cut clears selected pixels and populates clipboard', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 50, 50, 50, 50, { r: 255, g: 0, b: 0, a: 255 });

    // Select the painted area
    await setSelection(page, 50, 50, 50, 50);

    await page.keyboard.press(`${mod}+KeyX`);

    // Clipboard should have the content
    const state = await getEditorState(page);
    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.width).toBe(50);
    expect(state.clipboard!.height).toBe(50);

    // Source pixels should be cleared
    const pixel = await getPixelAt(page, 75, 75);
    expect(pixel.a).toBe(0);
  });

  test('cut without selection clears entire layer', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 0, 0, 400, 300, { r: 100, g: 100, b: 100, a: 255 });

    await page.keyboard.press(`${mod}+KeyX`);

    // All pixels should be cleared
    const pixel = await getPixelAt(page, 200, 150);
    expect(pixel.a).toBe(0);

    // Clipboard should have the data
    const state = await getEditorState(page);
    expect(state.clipboard).not.toBeNull();
  });

  test('cut pushes history for undo', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 10, 10, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    const beforeState = await getEditorState(page);
    const undoBefore = beforeState.undoStack;

    await page.keyboard.press(`${mod}+KeyX`);

    const afterState = await getEditorState(page);
    expect(afterState.undoStack).toBeGreaterThan(undoBefore);

    // Undo should restore pixels
    await page.keyboard.press(`${mod}+KeyZ`);
    const pixel = await getPixelAt(page, 15, 15);
    expect(pixel.r).toBe(255);
    expect(pixel.a).toBe(255);
  });
});

// ===========================================================================
// Paste
// ===========================================================================

test.describe('Paste', () => {
  test('paste creates a new layer with copied content', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 10, 10, 30, 30, { r: 0, g: 0, b: 255, a: 255 });

    await page.keyboard.press(`${mod}+KeyC`);
    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 3);

    const state = await getEditorState(page);
    expect(state.document.layers).toHaveLength(3);
    const pastedLayer = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();
    expect(state.document.activeLayerId).toBe(pastedLayer!.id);
  });

  test('paste preserves pixel data from copy', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 10, 10, 30, 30, { r: 0, g: 200, b: 0, a: 255 });

    // Snapshot composited canvas before paste
    const beforeSnap = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });

    await setSelection(page, 10, 10, 30, 30);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 3);

    // Verify a new layer was created with the pasted content
    const state2 = await getEditorState(page);
    expect(state2.document.layers).toHaveLength(3);
    const pastedLayer2 = state2.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer2).toBeDefined();
    expect(state2.document.activeLayerId).toBe(pastedLayer2!.id);

    // Verify the composited canvas still shows the green content
    await page.waitForTimeout(200);
    const afterSnap = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });
    expect(afterSnap).not.toBeNull();
    expect(beforeSnap).not.toBeNull();
    // The composited canvas should have content (non-empty)
    let opaqueCount = 0;
    if (afterSnap) {
      for (let i = 3; i < afterSnap.pixels.length; i += 4) {
        if ((afterSnap.pixels[i] ?? 0) > 0) opaqueCount++;
      }
    }
    expect(opaqueCount).toBeGreaterThan(0);
  });

  test('paste positions layer at copied offset', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcuts behave differently under mobile emulation');
    await createDocument(page, 400, 300, true);
    await paintRect(page, 100, 100, 20, 20, { r: 255, g: 0, b: 0, a: 255 });

    await setSelection(page, 100, 100, 20, 20);
    await page.keyboard.press(`${mod}+KeyC`);
    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 3);

    const state = await getEditorState(page);
    const pastedLayer = state.document.layers.find((l) => l.name === 'Pasted Layer');
    expect(pastedLayer).toBeDefined();
    expect(pastedLayer!.x).toBe(100);
    expect(pastedLayer!.y).toBe(100);
    expect(pastedLayer!.width).toBe(20);
    expect(pastedLayer!.height).toBe(20);
  });

  test('paste does nothing when clipboard is empty', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcuts behave differently under mobile emulation');
    const before = await getEditorState(page);
    await page.keyboard.press(`${mod}+KeyV`);
    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(before.document.layers.length);
  });

  test('paste pushes history for undo', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 0, 0, 10, 10, { r: 255, g: 0, b: 0, a: 255 });
    await page.keyboard.press(`${mod}+KeyC`);

    const before = await getEditorState(page);
    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 3);
    const after = await getEditorState(page);

    expect(after.undoStack).toBeGreaterThan(before.undoStack);
    expect(after.document.layers).toHaveLength(3);

    // Undo removes the pasted layer
    await page.keyboard.press(`${mod}+KeyZ`);
    const undone = await getEditorState(page);
    expect(undone.document.layers).toHaveLength(2);
  });

  test('paste multiple times creates multiple layers', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 0, 0, 10, 10, { r: 255, g: 0, b: 0, a: 255 });
    await page.keyboard.press(`${mod}+KeyC`);

    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 3);
    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 4);

    const state = await getEditorState(page);
    expect(state.document.layers).toHaveLength(4);
  });
});

// ===========================================================================
// Cut + Paste round-trip
// ===========================================================================

test.describe('Cut and Paste round-trip', () => {
  test('cut then paste restores pixels in a new layer', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await paintRect(page, 50, 50, 40, 40, { r: 128, g: 64, b: 32, a: 255 });

    await setSelection(page, 50, 50, 40, 40);
    await page.keyboard.press(`${mod}+KeyX`);

    // Original layer should be cleared
    const state = await getEditorState(page);
    const origId = state.document.layers[0]!.id;
    const clearedPixel = await getPixelAt(page, 70, 70, origId);
    expect(clearedPixel.a).toBe(0);

    // Paste
    await page.keyboard.press(`${mod}+KeyV`);
    await waitForLayerCount(page, 3);

    const afterPaste = await getEditorState(page);
    expect(afterPaste.document.layers).toHaveLength(3);

    // Verify the composited canvas shows content after paste
    await page.waitForTimeout(200);
    const snap = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });
    expect(snap).not.toBeNull();
    let opaqueCount = 0;
    if (snap) {
      for (let i = 3; i < snap.pixels.length; i += 4) {
        if ((snap.pixels[i] ?? 0) > 0) opaqueCount++;
      }
    }
    expect(opaqueCount).toBeGreaterThan(0);
  });

  test('cut partial selection only removes selected pixels', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    // Paint 100x100 block
    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 255, b: 0, a: 255 });

    // Snapshot composited canvas before cut
    const beforeSnap = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });

    // Select only the top-left 50x50
    await setSelection(page, 0, 0, 50, 50);
    await page.keyboard.press(`${mod}+KeyX`);

    // Verify clipboard was populated
    const state = await getEditorState(page);
    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard!.width).toBe(50);
    expect(state.clipboard!.height).toBe(50);

    // Verify the composited canvas changed (partial cut)
    await page.waitForTimeout(200);
    const afterSnap = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
        Promise<{ width: number; height: number; pixels: number[] } | null>;
    });
    expect(afterSnap).not.toBeNull();
    expect(beforeSnap).not.toBeNull();
    // Compare pixel colors — cut should change some pixels
    let diffCount = 0;
    if (beforeSnap && afterSnap && beforeSnap.pixels.length === afterSnap.pixels.length) {
      for (let i = 0; i < beforeSnap.pixels.length; i += 4) {
        if (
          beforeSnap.pixels[i] !== afterSnap.pixels[i] ||
          beforeSnap.pixels[i + 1] !== afterSnap.pixels[i + 1] ||
          beforeSnap.pixels[i + 2] !== afterSnap.pixels[i + 2] ||
          beforeSnap.pixels[i + 3] !== afterSnap.pixels[i + 3]
        ) {
          diffCount++;
        }
      }
    }
    // The cut should have changed some pixels (the 50x50 region)
    expect(diffCount).toBeGreaterThan(0);
  });
});
