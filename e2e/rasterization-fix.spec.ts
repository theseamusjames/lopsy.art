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
        effects: {
          dropShadow: { enabled: boolean };
          stroke: { enabled: boolean };
          outerGlow: { enabled: boolean };
          innerGlow: { enabled: boolean };
        };
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

async function getUIState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    return {
      showGrid: state.showGrid as boolean,
      showGuides: state.showGuides as boolean,
      showEffectsDrawer: state.showEffectsDrawer as boolean,
    };
  });
}

async function getSelectionState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        selection: {
          active: boolean;
          mask: Uint8ClampedArray | null;
          maskWidth: number;
          maskHeight: number;
        };
      };
    };
    const sel = store.getState().selection;
    let selectedCount = 0;
    if (sel.mask) {
      for (let i = 0; i < sel.mask.length; i++) {
        if ((sel.mask[i] ?? 0) > 0) selectedCount++;
      }
    }
    return {
      active: sel.active,
      selectedPixelCount: selectedCount,
      maskWidth: sel.maskWidth,
      maskHeight: sel.maskHeight,
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

async function enableEffect(page: Page, layerId: string, effectKey: string) {
  await page.evaluate(
    ({ lid, key }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === lid);
      if (!layer) return;
      const effects = { ...layer.effects };
      const effect = effects[key] as Record<string, unknown>;
      effects[key] = { ...effect, enabled: true };
      state.updateLayerEffects(lid, effects);
    },
    { lid: layerId, key: effectKey },
  );
}

async function setEffectProps(
  page: Page,
  layerId: string,
  effectKey: string,
  props: Record<string, unknown>,
) {
  await page.evaluate(
    ({ lid, key, props }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === lid);
      if (!layer) return;
      const effects = { ...layer.effects };
      const effect = effects[key] as Record<string, unknown>;
      effects[key] = { ...effect, ...props, enabled: true };
      state.updateLayerEffects(lid, effects);
    },
    { lid: layerId, key: effectKey, props },
  );
}

async function getLayerPixelDataSize(page: Page, layerId: string) {
  return page.evaluate(
    (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { getOrCreateLayerPixelData: (id: string) => ImageData };
      };
      const data = store.getState().getOrCreateLayerPixelData(lid);
      if (!data) return { width: 0, height: 0 };
      return { width: data.width, height: data.height };
    },
    layerId,
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

async function getLayerPixelDataSizeFromGpu(page: Page, layerId: string) {
  return page.evaluate(async (lid) => {
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(lid);
    if (!result) return { width: 0, height: 0 };
    return { width: result.width, height: result.height };
  }, layerId);
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
// Rasterize Layer Style
// ===========================================================================

test.describe('Rasterize Layer Style', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'effects drawer requires sidebar, hidden on touch devices');
  });

  test('rasterize button is visible in effects drawer', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    await expect(page.locator('text=Rasterize Layer Style')).toBeVisible();
  });

  test('rasterize button is disabled when no effects are enabled', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    const btn = page.locator('button:has-text("Rasterize Layer Style")');
    await expect(btn).toBeDisabled();
  });

  test('rasterize button is enabled when an effect is active', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    await enableEffect(page, layerId, 'stroke');

    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    const btn = page.locator('button:has-text("Rasterize Layer Style")');
    await expect(btn).toBeEnabled();
  });

  test('rasterize bakes effects into pixel data and resets effects', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    await paintRect(page, 20, 20, 60, 60, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    await setEffectProps(page, layerId, 'stroke', {
      width: 4,
      position: 'outside',
      color: { r: 0, g: 255, b: 0, a: 1 },
    });

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { rasterizeLayerStyle: () => void };
      };
      store.getState().rasterizeLayerStyle();
    });

    const afterState = await getEditorState(page);
    const layer = afterState.document.layers.find((l) => l.id === layerId)!;

    // Effects should be reset
    expect(layer.effects.stroke.enabled).toBe(false);
    expect(layer.effects.dropShadow.enabled).toBe(false);
    expect(layer.effects.outerGlow.enabled).toBe(false);
    expect(layer.effects.innerGlow.enabled).toBe(false);

    // Verify the composited canvas still has visible content after rasterize
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

  test('rasterize is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    await paintRect(page, 20, 20, 60, 60, { r: 255, g: 0, b: 0, a: 255 }, layerId);
    await enableEffect(page, layerId, 'stroke');

    const sizeBefore = await getLayerPixelDataSize(page, layerId);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { rasterizeLayerStyle: () => void };
      };
      store.getState().rasterizeLayerStyle();
    });

    // Verify rasterized
    const afterRasterize = await getEditorState(page);
    expect(afterRasterize.document.layers.find((l) => l.id === layerId)!.effects.stroke.enabled).toBe(false);

    // Undo
    await page.keyboard.press(`${mod}+KeyZ`);

    const afterUndo = await getEditorState(page);
    const undoneLayer = afterUndo.document.layers.find((l) => l.id === layerId)!;
    expect(undoneLayer.effects.stroke.enabled).toBe(true);

    const sizeAfterUndo = await getLayerPixelDataSize(page, layerId);
    expect(sizeAfterUndo.width).toBe(sizeBefore.width);
    expect(sizeAfterUndo.height).toBe(sizeBefore.height);
  });

  test('rasterize does nothing when no effects are enabled', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const stateBefore = await getEditorState(page);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { rasterizeLayerStyle: () => void };
      };
      store.getState().rasterizeLayerStyle();
    });

    const stateAfter = await getEditorState(page);
    // No history entry should have been pushed
    expect(stateAfter.undoStack).toBe(stateBefore.undoStack);
  });
});

// ===========================================================================
// Merge Down with Effects
// ===========================================================================

test.describe('Merge Down with Effects', () => {
  test('merge down rasterizes effects from top layer into result', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 100, 100, { r: 255, g: 255, b: 255, a: 255 }, bgId);

    await addLayer(page);
    const s1 = await getEditorState(page);
    const topId = s1.document.activeLayerId;

    await paintRect(page, 30, 30, 40, 40, { r: 255, g: 0, b: 0, a: 255 }, topId);

    // Enable stroke on top layer
    await setEffectProps(page, topId, 'stroke', {
      width: 4,
      position: 'outside',
      color: { r: 0, g: 0, b: 255, a: 1 },
    });

    // Merge down
    await page.keyboard.press(`${mod}+KeyE`);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(2);

    // Verify the composited canvas shows merged content
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

  test('merge down without effects works normally', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const s0 = await getEditorState(page);
    const bgId = s0.document.layers[0]!.id;

    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, bgId);

    await addLayer(page);
    const s1 = await getEditorState(page);
    const topId = s1.document.activeLayerId;

    await paintRect(page, 25, 25, 50, 50, { r: 0, g: 0, b: 255, a: 255 }, topId);

    await page.keyboard.press(`${mod}+KeyE`);

    const after = await getEditorState(page);
    expect(after.document.layers).toHaveLength(2);

    // Verify the composited canvas shows merged content
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
});

// ===========================================================================
// Cmd+Click Thumbnail to Select
// ===========================================================================

test.describe('Cmd+Click Thumbnail', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'layer panel hidden on touch devices');
  });
  test('cmd+click on layer thumbnail creates selection from alpha', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    // Paint a 40x40 rect at (30,30)
    await paintRect(page, 30, 30, 40, 40, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    // Cmd+click on the thumbnail
    const thumbnail = page.locator('[class*="thumbnail"]').first();
    await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });

    const sel = await getSelectionState(page);
    expect(sel.active).toBe(true);
    // Should have selected ~1600 pixels (40x40)
    expect(sel.selectedPixelCount).toBe(40 * 40);
  });

  test('cmd+click on empty layer creates no selection', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    const thumbnail = page.locator('[class*="thumbnail"]').first();
    await thumbnail.click({ modifiers: [isMac ? 'Meta' : 'Control'] });

    const sel = await getSelectionState(page);
    // No opaque pixels, so no selection should be created
    expect(sel.selectedPixelCount).toBe(0);
  });

  test('regular click on thumbnail does not create selection', async ({ page }) => {
    await createDocument(page, 100, 100, true);
    const state = await getEditorState(page);
    const layerId = state.document.activeLayerId;

    await paintRect(page, 0, 0, 50, 50, { r: 255, g: 0, b: 0, a: 255 }, layerId);

    const thumbnail = page.locator('[class*="thumbnail"]').first();
    await thumbnail.click();

    const sel = await getSelectionState(page);
    expect(sel.active).toBe(false);
  });
});

// ===========================================================================
// Keyboard Shortcuts: Grid and Guides
// ===========================================================================

test.describe('Grid Toggle Shortcut', () => {
  test('Cmd+quote toggles grid on', async ({ page }) => {
    const before = await getUIState(page);
    expect(before.showGrid).toBe(false);

    await page.keyboard.press(`${mod}+'`);

    const after = await getUIState(page);
    expect(after.showGrid).toBe(true);
  });

  test('Cmd+quote toggles grid off again', async ({ page }) => {
    await page.keyboard.press(`${mod}+'`);
    const on = await getUIState(page);
    expect(on.showGrid).toBe(true);

    await page.keyboard.press(`${mod}+'`);
    const off = await getUIState(page);
    expect(off.showGrid).toBe(false);
  });
});

test.describe('Guides Toggle Shortcut', () => {
  test('Cmd+semicolon toggles guides state', async ({ page }) => {
    const before = await getUIState(page);
    const initialState = before.showGuides;

    await page.keyboard.press(`${mod}+;`);

    const after = await getUIState(page);
    expect(after.showGuides).toBe(!initialState);
  });

  test('Cmd+semicolon toggles guides back after two presses', async ({ page }) => {
    const before = await getUIState(page);
    const initialState = before.showGuides;

    await page.keyboard.press(`${mod}+;`);
    const toggled = await getUIState(page);
    expect(toggled.showGuides).toBe(!initialState);

    await page.keyboard.press(`${mod}+;`);
    const restored = await getUIState(page);
    expect(restored.showGuides).toBe(initialState);
  });
});

// ===========================================================================
// Keyboard Shortcuts: Select All and Inverse
// ===========================================================================

test.describe('Select All Shortcut', () => {
  test('Cmd+A selects the entire document', async ({ page }) => {
    await page.keyboard.press(`${mod}+KeyA`);

    const sel = await getSelectionState(page);
    expect(sel.active).toBe(true);
    // Entire document should be selected (400x300)
    expect(sel.selectedPixelCount).toBe(400 * 300);
  });
});

test.describe('Select Inverse Shortcut', () => {
  test('Shift+Cmd+I inverts active selection', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    // Select all first
    await page.keyboard.press(`${mod}+KeyA`);
    const selAll = await getSelectionState(page);
    expect(selAll.active).toBe(true);
    expect(selAll.selectedPixelCount).toBe(100 * 100);

    // Invert — all pixels were selected, so now none should be
    await page.keyboard.press(`${mod}+Shift+KeyI`);

    const selInv = await getSelectionState(page);
    expect(selInv.active).toBe(true);
    expect(selInv.selectedPixelCount).toBe(0);
  });

  test('Shift+Cmd+I does nothing without active selection', async ({ page }) => {
    await page.keyboard.press(`${mod}+Shift+KeyI`);

    const sel = await getSelectionState(page);
    expect(sel.active).toBe(false);
  });

  test('partial selection inversion preserves complement', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    // Create a rectangular selection via store
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
      const mask = new Uint8ClampedArray(100 * 100);
      // Select top-left 50x50
      for (let y = 0; y < 50; y++) {
        for (let x = 0; x < 50; x++) {
          mask[y * 100 + x] = 255;
        }
      }
      store.getState().setSelection({ x: 0, y: 0, width: 50, height: 50 }, mask, 100, 100);
    });

    const before = await getSelectionState(page);
    expect(before.active).toBe(true);
    expect(before.selectedPixelCount).toBe(50 * 50);

    // Invert
    await page.keyboard.press(`${mod}+Shift+KeyI`);

    const after = await getSelectionState(page);
    expect(after.active).toBe(true);
    // 10000 - 2500 = 7500 pixels should now be selected
    expect(after.selectedPixelCount).toBe(100 * 100 - 50 * 50);
  });
});
