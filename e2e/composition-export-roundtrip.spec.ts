/**
 * Composition Test: Export Round-Trip
 *
 * Builds a 20+ layer composition with groups, text (Google Fonts),
 * blend modes, layer effects, filters, and undo/redo cycles.
 * Exports to PNG and PSD, reloads, reimports each, and verifies
 * pixel-level consistency and layer structure.
 *
 * Theme: "Neon City" — geometric shapes, glowing text, vibrant overlays.
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

async function createDocument(page: Page, width = 800, height = 600, transparent = false) {
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

async function callStore(page: Page, method: string, ...args: unknown[]) {
  return page.evaluate(
    ({ method, args }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, (...a: unknown[]) => unknown>;
      };
      return store.getState()[method]!(...args);
    },
    { method, args },
  );
}

async function addLayer(page: Page, name?: string): Promise<string> {
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
    if (n) store.getState().renameLayer(id, n);
    return id;
  }, name ?? null);
}

async function addGroup(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        addGroup: (name: string) => void;
        document: { activeLayerId: string };
      };
    };
    store.getState().addGroup(n);
    return store.getState().document.activeLayerId;
  }, name);
}

async function setActiveLayer(page: Page, layerId: string) {
  await page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { setActiveLayer: (id: string) => void };
    };
    store.getState().setActiveLayer(id);
  }, layerId);
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
          document: {
            activeLayerId: string;
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
      const id = lid ?? state.document.activeLayerId;
      state.pushHistory('Paint');
      const existing = pixelData.get(id);
      const layer = state.document.layers.find((l) => l.id === id);
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
      state.updateLayerPixelData(id, data);
    },
    { x, y, w, h, color, lid: layerId ?? null },
  );
}

async function paintCircle(
  page: Page,
  cx: number, cy: number, radius: number,
  color: { r: number; g: number; b: number; a: number },
  layerId?: string,
) {
  await page.evaluate(
    ({ cx, cy, radius, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: {
            activeLayerId: string;
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
      const id = lid ?? state.document.activeLayerId;
      state.pushHistory('Paint Circle');
      const existing = pixelData.get(id);
      const layer = state.document.layers.find((l) => l.id === id);
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
      state.updateLayerPixelData(id, data);
    },
    { cx, cy, radius, color, lid: layerId ?? null },
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

async function setLayerOpacity(page: Page, layerId: string, opacity: number) {
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

async function setLayerEffects(
  page: Page,
  layerId: string,
  effects: Record<string, unknown>,
) {
  await page.evaluate(
    ({ id, effects }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { updateLayerEffects: (id: string, effects: Record<string, unknown>) => void };
      };
      store.getState().updateLayerEffects(id, effects);
    },
    { id: layerId, effects },
  );
}

async function moveLayer(page: Page, layerId: string, x: number, y: number) {
  await page.evaluate(
    ({ id, x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (label?: string) => void;
          updateLayerPosition: (id: string, x: number, y: number) => void;
        };
      };
      const state = store.getState();
      state.pushHistory('Move');
      state.updateLayerPosition(id, x, y);
    },
    { id: layerId, x, y },
  );
}

async function undo(page: Page) {
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
}

async function redo(page: Page) {
  await page.keyboard.press('Meta+Shift+z');
  await page.waitForTimeout(400);
}

async function pushHistory(page: Page, label = 'Action') {
  await page.evaluate((lbl) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory(lbl);
  }, label);
}

type PixelSnapshot = { width: number; height: number; pixels: number[] };

async function snapshot(page: Page): Promise<PixelSnapshot> {
  const result = await page.evaluate(async () => {
    // Wait for a render frame to ensure the compositor has processed
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
      Promise<PixelSnapshot | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

function pixelDiff(a: PixelSnapshot, b: PixelSnapshot): number {
  let count = 0;
  const len = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0));
    const dg = Math.abs((a.pixels[i + 1] ?? 0) - (b.pixels[i + 1] ?? 0));
    const db = Math.abs((a.pixels[i + 2] ?? 0) - (b.pixels[i + 2] ?? 0));
    if (dr + dg + db > 30) count++;
  }
  return count;
}

interface DocSnapshot {
  width: number;
  height: number;
  layers: Array<{
    id: string;
    name: string;
    type: string;
    visible: boolean;
    opacity: number;
    blendMode: string;
    x: number;
    y: number;
  }>;
  layerOrder: string[];
  activeLayerId: string;
  undoStackLength: number;
  redoStackLength: number;
}

async function getDocSnapshot(page: Page): Promise<DocSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          width: number;
          height: number;
          layers: Array<{
            id: string;
            name: string;
            type: string;
            visible: boolean;
            opacity: number;
            blendMode: string;
            x: number;
            y: number;
          }>;
          layerOrder: string[];
          activeLayerId: string;
        };
        undoStack: unknown[];
        redoStack: unknown[];
      };
    };
    const s = store.getState();
    return {
      width: s.document.width,
      height: s.document.height,
      layers: s.document.layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        x: l.x,
        y: l.y,
      })),
      layerOrder: s.document.layerOrder,
      activeLayerId: s.document.activeLayerId,
      undoStackLength: s.undoStack.length,
      redoStackLength: s.redoStack.length,
    };
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

async function setActiveTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    store.getState().setActiveTool(t);
  }, tool);
  await page.waitForTimeout(100);
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
      getState: () => { setForegroundColor: (c: { r: number; g: number; b: number; a: number }) => void };
    };
    store.getState().setForegroundColor(c);
  }, color);
}

async function drawStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 15,
) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function dragAtDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function clickAtDoc(page: Page, docX: number, docY: number) {
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
}

async function loadGoogleFont(page: Page, family: string, weights: number[]) {
  await page.evaluate(
    async ({ family, weights }) => {
      const weightsStr = weights.join(';');
      const encoded = encodeURIComponent(family);
      const href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weightsStr}&display=swap`;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      await new Promise<void>((resolve, reject) => {
        link.onload = () => { document.fonts.ready.then(() => resolve()); };
        link.onerror = () => reject(new Error(`Failed to load font: ${family}`));
        document.head.appendChild(link);
      });
    },
    { family, weights },
  );
}

async function createTextLayer(
  page: Page,
  text: string,
  x: number,
  y: number,
  opts: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    textAlign?: 'left' | 'center' | 'right';
    color?: { r: number; g: number; b: number; a: number };
    areaWidth?: number;
  } = {},
): Promise<string> {
  // Configure tool settings before entering text mode
  if (opts.fontFamily) await setToolSetting(page, 'setTextFontFamily', opts.fontFamily);
  if (opts.fontSize) await setToolSetting(page, 'setTextFontSize', opts.fontSize);
  if (opts.fontWeight) await setToolSetting(page, 'setTextFontWeight', opts.fontWeight);
  if (opts.fontStyle) await setToolSetting(page, 'setTextFontStyle', opts.fontStyle);
  if (opts.textAlign) await setToolSetting(page, 'setTextAlign', opts.textAlign);
  if (opts.color) await setForegroundColor(page, opts.color);

  await setActiveTool(page, 'text');

  if (opts.areaWidth) {
    await dragAtDoc(page, { x, y }, { x: x + opts.areaWidth, y: y + 100 });
  } else {
    await clickAtDoc(page, x, y);
  }

  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(300);

  // Return the text layer ID
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { layers: Array<{ id: string; type: string }> };
      };
    };
    const textLayers = store.getState().document.layers.filter((l) => l.type === 'text');
    return textLayers[textLayers.length - 1]?.id ?? '';
  });
}

async function flushRenderAndWait(page: Page) {
  await page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { notifyRender: () => void };
    };
    store.getState().notifyRender();
    // Wait several frames for sync loop to pick up all pending data
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  });
  await page.waitForTimeout(500);
}

async function waitForLayerCount(page: Page, count: number, timeout = 10_000) {
  await page.waitForFunction(
    (expected) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { layers: unknown[] } };
      };
      return store.getState().document.layers.length >= expected;
    },
    count,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Composition: Neon City — Export Round-Trip', () => {
  test('builds 20+ layer composition and verifies PNG/PSD export round-trip', async ({ page, allowConsoleErrors }) => {
    // Vite HMR WebSocket can disconnect during reload
    (allowConsoleErrors as RegExp[]).push(/WebSocket connection/);
    test.setTimeout(300_000);

    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // Track layer IDs as we build the composition
    const layerIds: Record<string, string> = {};

    // =================================================================
    // PHASE 1: Background gradient
    // =================================================================
    const doc0 = await getDocSnapshot(page);
    layerIds['bg'] = doc0.layers[0]!.id;

    // Paint a dark gradient background manually
    await paintRect(page, 0, 0, 800, 600, { r: 15, g: 10, b: 35, a: 255 }, layerIds['bg']);
    // Add some gradient feel — lighter at bottom
    await paintRect(page, 0, 400, 800, 200, { r: 25, g: 15, b: 55, a: 255 }, layerIds['bg']);


    // =================================================================
    // PHASE 2: Create "Buildings" group
    // =================================================================
    layerIds['buildingsGroup'] = await addGroup(page, 'Buildings');

    // Add building layers inside the group
    layerIds['building1'] = await addLayer(page, 'Tower Left');
    await paintRect(page, 50, 200, 120, 400, { r: 20, g: 20, b: 40, a: 255 }, layerIds['building1']);

    layerIds['building2'] = await addLayer(page, 'Tower Center');
    await paintRect(page, 300, 150, 150, 450, { r: 25, g: 22, b: 45, a: 255 }, layerIds['building2']);

    layerIds['building3'] = await addLayer(page, 'Tower Right');
    await paintRect(page, 580, 250, 130, 350, { r: 18, g: 18, b: 38, a: 255 }, layerIds['building3']);

    layerIds['building4'] = await addLayer(page, 'Low Block');
    await paintRect(page, 200, 350, 180, 250, { r: 22, g: 20, b: 42, a: 255 }, layerIds['building4']);


    // =================================================================
    // PHASE 3: Building windows (dots of light)
    // =================================================================
    layerIds['windows'] = await addLayer(page, 'Windows');
    const windowColor = { r: 255, g: 230, b: 150, a: 200 };
    // Left tower windows
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 3; col++) {
        await paintRect(page, 70 + col * 30, 220 + row * 40, 8, 12, windowColor, layerIds['windows']);
      }
    }
    // Center tower windows
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 4; col++) {
        await paintRect(page, 320 + col * 30, 170 + row * 40, 8, 12, windowColor, layerIds['windows']);
      }
    }
    await pushHistory(page, 'Windows blend');
    await setBlendMode(page, layerIds['windows'], 'screen');


    // =================================================================
    // PHASE 4: Undo/redo cycle 1 — undo and redo via state checks
    // =================================================================
    const docBeforeUndo = await getDocSnapshot(page);
    expect(docBeforeUndo.undoStackLength).toBeGreaterThan(3);

    for (let i = 0; i < 3; i++) await undo(page);

    const docAfterUndo = await getDocSnapshot(page);
    expect(docAfterUndo.undoStackLength).toBe(docBeforeUndo.undoStackLength - 3);
    expect(docAfterUndo.redoStackLength).toBe(docBeforeUndo.redoStackLength + 3);

    for (let i = 0; i < 3; i++) await redo(page);

    const docAfterRedo = await getDocSnapshot(page);
    expect(docAfterRedo.undoStackLength).toBe(docBeforeUndo.undoStackLength);
    expect(docAfterRedo.redoStackLength).toBe(docBeforeUndo.redoStackLength);

    // =================================================================
    // PHASE 5: Create "Neon Signs" group
    // =================================================================
    // Navigate back to root level before creating group
    const rootDoc = await getDocSnapshot(page);
    const rootGroup = rootDoc.layers.find((l) => l.type === 'group' && l.name === 'Project');
    if (rootGroup) await setActiveLayer(page, rootGroup.id);

    layerIds['neonGroup'] = await addGroup(page, 'Neon Signs');

    // Neon accent bars
    layerIds['neonBar1'] = await addLayer(page, 'Neon Pink Bar');
    await paintRect(page, 60, 280, 100, 6, { r: 255, g: 20, b: 147, a: 255 }, layerIds['neonBar1']);
    await pushHistory(page, 'Neon glow');
    await setLayerEffects(page, layerIds['neonBar1'], {
      outerGlow: {
        enabled: true,
        color: { r: 255, g: 20, b: 147, a: 1 },
        size: 15,
        spread: 0,
        opacity: 0.8,
      },
    });

    layerIds['neonBar2'] = await addLayer(page, 'Neon Cyan Bar');
    await paintRect(page, 590, 310, 100, 6, { r: 0, g: 255, b: 255, a: 255 }, layerIds['neonBar2']);
    await pushHistory(page, 'Cyan glow');
    await setLayerEffects(page, layerIds['neonBar2'], {
      outerGlow: {
        enabled: true,
        color: { r: 0, g: 255, b: 255, a: 1 },
        size: 15,
        spread: 0,
        opacity: 0.8,
      },
    });


    // =================================================================
    // PHASE 6: Neon circle
    // =================================================================
    layerIds['neonCircle'] = await addLayer(page, 'Neon Circle');
    await paintCircle(page, 400, 200, 60, { r: 255, g: 100, b: 255, a: 255 }, layerIds['neonCircle']);
    await pushHistory(page, 'Circle effects');
    await setLayerEffects(page, layerIds['neonCircle'], {
      outerGlow: {
        enabled: true,
        color: { r: 255, g: 100, b: 255, a: 1 },
        size: 20,
        spread: 0,
        opacity: 0.9,
      },
      innerGlow: {
        enabled: true,
        color: { r: 255, g: 200, b: 255, a: 1 },
        size: 8,
        spread: 0,
        opacity: 0.6,
      },
    });
    await setBlendMode(page, layerIds['neonCircle'], 'screen');


    // =================================================================
    // PHASE 7: Undo/redo cycle 2 — undo several steps, redo all
    // =================================================================
    const docBeforeUndoBatch = await getDocSnapshot(page);
    expect(docBeforeUndoBatch.undoStackLength).toBeGreaterThan(5);

    for (let i = 0; i < 5; i++) await undo(page);
    const docAfterUndoBatch = await getDocSnapshot(page);
    expect(docAfterUndoBatch.undoStackLength).toBe(docBeforeUndoBatch.undoStackLength - 5);

    for (let i = 0; i < 5; i++) await redo(page);
    const docAfterRedoBatch = await getDocSnapshot(page);
    expect(docAfterRedoBatch.undoStackLength).toBe(docBeforeUndoBatch.undoStackLength);


    // =================================================================
    // PHASE 8: Text layers with Google Fonts
    // =================================================================
    // Load Google Fonts
    await loadGoogleFont(page, 'Orbitron', [400, 700, 900]);
    await loadGoogleFont(page, 'Pacifico', [400]);

    // Navigate to neon group for text placement
    await setActiveLayer(page, layerIds['neonGroup']);

    layerIds['titleText'] = await createTextLayer(page, 'NEON CITY', 220, 40, {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: 64,
      fontWeight: 900,
      color: { r: 255, g: 0, b: 200, a: 1 },
      textAlign: 'center',
      areaWidth: 360,
    });


    // Add glow to title
    await pushHistory(page, 'Title glow');
    await setLayerEffects(page, layerIds['titleText'], {
      outerGlow: {
        enabled: true,
        color: { r: 255, g: 0, b: 200, a: 1 },
        size: 12,
        spread: 0,
        opacity: 0.7,
      },
    });

    // Switch away from text tool to prevent hit-testing existing text
    await setActiveTool(page, 'move');
    await page.waitForTimeout(100);

    layerIds['subtitleText'] = await createTextLayer(page, 'after midnight', 250, 470, {
      fontFamily: 'Pacifico, cursive',
      fontSize: 32,
      fontWeight: 400,
      color: { r: 0, g: 255, b: 255, a: 1 },
      textAlign: 'center',
      areaWidth: 300,
    });


    // =================================================================
    // PHASE 9: Street / ground layer
    // =================================================================
    await setActiveLayer(page, rootGroup!.id);

    layerIds['street'] = await addLayer(page, 'Street');
    await paintRect(page, 0, 500, 800, 100, { r: 30, g: 25, b: 35, a: 255 }, layerIds['street']);
    // Street line
    await paintRect(page, 100, 540, 600, 4, { r: 200, g: 200, b: 200, a: 180 }, layerIds['street']);


    // =================================================================
    // PHASE 10: Reflection / puddle effect
    // =================================================================
    layerIds['puddle'] = await addLayer(page, 'Puddle');
    await paintRect(page, 200, 550, 400, 40, { r: 80, g: 40, b: 120, a: 100 }, layerIds['puddle']);
    await pushHistory(page, 'Puddle blend');
    await setBlendMode(page, layerIds['puddle'], 'overlay');
    await setLayerOpacity(page, layerIds['puddle'], 0.6);


    // =================================================================
    // PHASE 11: Add more layers to the buildings group (late additions)
    // =================================================================
    await setActiveLayer(page, layerIds['buildingsGroup']);

    layerIds['antenna'] = await addLayer(page, 'Antenna');
    await paintRect(page, 370, 100, 6, 50, { r: 40, g: 40, b: 60, a: 255 }, layerIds['antenna']);
    // Blinking light on antenna
    await paintCircle(page, 373, 100, 4, { r: 255, g: 0, b: 0, a: 255 }, layerIds['antenna']);

    layerIds['buildingDetail'] = await addLayer(page, 'Building Accents');
    await paintRect(page, 50, 200, 120, 4, { r: 100, g: 80, b: 140, a: 200 }, layerIds['buildingDetail']);
    await paintRect(page, 300, 150, 150, 4, { r: 100, g: 80, b: 140, a: 200 }, layerIds['buildingDetail']);
    await paintRect(page, 580, 250, 130, 4, { r: 100, g: 80, b: 140, a: 200 }, layerIds['buildingDetail']);


    // =================================================================
    // PHASE 12: Color overlay layer with blend mode
    // =================================================================
    await setActiveLayer(page, rootGroup!.id);

    layerIds['colorWash'] = await addLayer(page, 'Purple Wash');
    await paintRect(page, 0, 0, 800, 600, { r: 80, g: 0, b: 120, a: 60 }, layerIds['colorWash']);
    await pushHistory(page, 'Color wash blend');
    await setBlendMode(page, layerIds['colorWash'], 'color');
    await setLayerOpacity(page, layerIds['colorWash'], 0.3);


    // =================================================================
    // PHASE 13: Stars in the sky
    // =================================================================
    layerIds['stars'] = await addLayer(page, 'Stars');
    const starPositions = [
      [120, 40], [250, 25], [400, 50], [550, 30], [680, 55],
      [80, 80], [350, 90], [500, 70], [650, 100], [200, 110],
      [720, 45], [180, 60], [460, 35], [600, 85], [300, 45],
    ];
    for (const [sx, sy] of starPositions) {
      await paintCircle(page, sx!, sy!, 2, { r: 255, g: 255, b: 255, a: 200 }, layerIds['stars']);
    }
    await pushHistory(page, 'Stars blend');
    await setBlendMode(page, layerIds['stars'], 'screen');


    // =================================================================
    // PHASE 14: Moon
    // =================================================================
    layerIds['moon'] = await addLayer(page, 'Moon');
    await paintCircle(page, 680, 80, 30, { r: 220, g: 220, b: 240, a: 255 }, layerIds['moon']);
    await pushHistory(page, 'Moon glow');
    await setLayerEffects(page, layerIds['moon'], {
      outerGlow: {
        enabled: true,
        color: { r: 200, g: 200, b: 255, a: 1 },
        size: 25,
        spread: 0,
        opacity: 0.5,
      },
    });


    // =================================================================
    // PHASE 15: Undo/redo cycle 3 — deep undo and recovery
    // =================================================================
    const docBeforeDeepUndo = await getDocSnapshot(page);
    expect(docBeforeDeepUndo.undoStackLength).toBeGreaterThan(10);

    for (let i = 0; i < 10; i++) await undo(page);
    const docAfterDeepUndo = await getDocSnapshot(page);
    expect(docAfterDeepUndo.undoStackLength).toBe(docBeforeDeepUndo.undoStackLength - 10);
    expect(docAfterDeepUndo.redoStackLength).toBe(docBeforeDeepUndo.redoStackLength + 10);


    for (let i = 0; i < 10; i++) await redo(page);
    const docAfterDeepRedo = await getDocSnapshot(page);
    expect(docAfterDeepRedo.undoStackLength).toBe(docBeforeDeepUndo.undoStackLength);
    expect(docAfterDeepRedo.redoStackLength).toBe(docBeforeDeepUndo.redoStackLength);


    // =================================================================
    // PHASE 16: Add a drop shadow to a building
    // =================================================================
    await pushHistory(page, 'Building effects');
    await setLayerEffects(page, layerIds['building2'], {
      dropShadow: {
        enabled: true,
        color: { r: 0, g: 0, b: 0, a: 1 },
        offsetX: 8,
        offsetY: 8,
        blur: 15,
        spread: 0,
        opacity: 0.6,
      },
    });


    // =================================================================
    // PHASE 17: Fog / atmosphere layer
    // =================================================================
    layerIds['fog'] = await addLayer(page, 'Fog');
    await paintRect(page, 0, 300, 800, 150, { r: 100, g: 80, b: 140, a: 40 }, layerIds['fog']);
    await pushHistory(page, 'Fog blend');
    await setBlendMode(page, layerIds['fog'], 'screen');
    await setLayerOpacity(page, layerIds['fog'], 0.4);


    // =================================================================
    // PHASE 18: Additional text — small sign on building
    // =================================================================
    await setActiveLayer(page, layerIds['neonGroup']);
    await setActiveTool(page, 'move');
    await page.waitForTimeout(100);

    layerIds['signText'] = await createTextLayer(page, 'OPEN 24/7', 310, 340, {
      fontFamily: 'Orbitron, sans-serif',
      fontSize: 14,
      fontWeight: 700,
      color: { r: 255, g: 100, b: 100, a: 1 },
    });


    // =================================================================
    // PHASE 19: Verify composition structure
    // =================================================================
    const finalDoc = await getDocSnapshot(page);
    const layerCount = finalDoc.layers.length;
    expect(layerCount).toBeGreaterThanOrEqual(20);

    const groups = finalDoc.layers.filter((l) => l.type === 'group');
    // Root group + Buildings + Neon Signs = at least 3
    expect(groups.length).toBeGreaterThanOrEqual(3);

    const textLayers = finalDoc.layers.filter((l) => l.type === 'text');
    expect(textLayers.length).toBeGreaterThanOrEqual(3);

    await page.screenshot({ path: 'e2e/screenshots/comp-neon-city-final.png' });

    // =================================================================
    // PHASE 20: Capture reference pixel snapshot
    // =================================================================
    await page.waitForTimeout(500);
    const referenceSnapshot = await snapshot(page);
    expect(referenceSnapshot.width).toBeGreaterThan(0);
    expect(referenceSnapshot.height).toBeGreaterThan(0);

    // Capture layer names in order for PSD comparison
    const referenceLayerNames = finalDoc.layers.map((l) => l.name);
    const referenceLayerOrder = finalDoc.layerOrder;

    // =================================================================
    // PHASE 21: Export PNG
    // =================================================================
    // Switch to move tool and flush all pending data before export
    await setActiveTool(page, 'move');
    await flushRenderAndWait(page);

    const pngDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Export PNG' }).click();
    const pngDownload = await pngDownloadPromise;
    expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);

    const pngStream = await pngDownload.createReadStream();
    const pngChunks: Buffer[] = [];
    for await (const chunk of pngStream) {
      pngChunks.push(chunk as Buffer);
    }
    const pngBuffer = Buffer.concat(pngChunks);
    expect(pngBuffer.length).toBeGreaterThan(1000);

    // Verify PNG magic bytes
    expect(pngBuffer[0]).toBe(0x89);
    expect(pngBuffer.subarray(1, 4).toString('ascii')).toBe('PNG');


    // =================================================================
    // PHASE 22: Export PSD
    // =================================================================
    await flushRenderAndWait(page);

    const psdDownloadPromise = page.waitForEvent('download');
    // Call exportPsdFile directly to avoid render loop re-entrancy
    await page.evaluate(() => {
      const { exportPsdFile } = window as unknown as {
        exportPsdFile: (depth: number) => void;
      };
      // It's re-exported on the module scope; import it
      return import('/src/io/psd.ts').then((mod) => {
        mod.exportPsdFile(16);
      });
    });
    const psdDownload = await psdDownloadPromise;
    expect(psdDownload.suggestedFilename()).toMatch(/\.psd$/);

    const psdStream = await psdDownload.createReadStream();
    const psdChunks: Buffer[] = [];
    for await (const chunk of psdStream) {
      psdChunks.push(chunk as Buffer);
    }
    const psdBuffer = Buffer.concat(psdChunks);
    expect(psdBuffer.length).toBeGreaterThan(1000);

    // Verify PSD magic: "8BPS"
    expect(psdBuffer.subarray(0, 4).toString('ascii')).toBe('8BPS');


    // =================================================================
    // PHASE 23: Refresh page and open PNG
    // =================================================================
    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });

    // Open the exported PNG via file blob
    const pngBase64 = pngBuffer.toString('base64');
    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/png' });
      const { pasteOrOpenBlob } = await import('/src/app/paste-or-open.ts');
      await pasteOrOpenBlob(blob, 'neon-city', true);
    }, pngBase64);

    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15_000 });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/comp-neon-city-png-reimport.png' });

    // Compare composited pixels — PNG should match closely
    const pngReimportSnapshot = await snapshot(page);
    expect(pngReimportSnapshot.width).toBeGreaterThan(0);
    expect(pngReimportSnapshot.height).toBeGreaterThan(0);
    const pngDiffCount = pixelDiff(referenceSnapshot, pngReimportSnapshot);
    const totalPixels = Math.min(
      referenceSnapshot.width * referenceSnapshot.height,
      pngReimportSnapshot.width * pngReimportSnapshot.height,
    );
    // Allow some tolerance for color space round-trip
    expect(pngDiffCount).toBeLessThan(totalPixels * 0.05);

    // =================================================================
    // PHASE 24: Refresh page and open PSD
    // =================================================================
    await page.reload();
    await waitForStore(page);
    await page.waitForSelector('h2:has-text("New Document")', { timeout: 15_000 });

    // Open the exported PSD
    const psdBase64 = psdBuffer.toString('base64');
    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const data = bytes;
      const { importPsdFile } = await import('/src/io/psd.ts');
      await importPsdFile(data, 'neon-city');
    }, psdBase64);

    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15_000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'e2e/screenshots/comp-neon-city-psd-reimport.png' });

    // Compare composited pixels — PSD should match reasonably
    const psdReimportSnapshot = await snapshot(page);
    expect(psdReimportSnapshot.width).toBeGreaterThan(0);
    expect(psdReimportSnapshot.height).toBeGreaterThan(0);
    const psdTotalPixels = Math.min(
      referenceSnapshot.width * referenceSnapshot.height,
      psdReimportSnapshot.width * psdReimportSnapshot.height,
    );
    const psdDiffCount = pixelDiff(referenceSnapshot, psdReimportSnapshot);
    // PSD round-trip loses effects, so allow more tolerance
    // But basic layer pixel data should survive
    expect(psdDiffCount).toBeLessThan(psdTotalPixels * 0.15);

    // =================================================================
    // PHASE 25: Verify PSD layer structure
    // =================================================================
    const psdDoc = await getDocSnapshot(page);

    // Verify layer count (PSD import loses groups' nesting semantics
    // but should preserve individual layers)
    expect(psdDoc.layers.length).toBeGreaterThanOrEqual(15);

    // Verify layer order is preserved by checking names
    // PSD layers come in bottom-to-top — the import should preserve stacking
    const psdLayerNames = psdDoc.layers
      .filter((l) => l.type !== 'group')
      .map((l) => l.name);

    // The original non-group layer names in layerOrder (bottom-to-top)
    const originalNonGroupNames = referenceLayerOrder
      .map((id) => finalDoc.layers.find((l) => l.id === id))
      .filter((l): l is NonNullable<typeof l> => l != null && l.type !== 'group')
      .map((l) => l.name);

    // PSD import should have layers in the same relative order
    // Check that the sequence of shared names preserves order
    const sharedNames = psdLayerNames.filter((n) => originalNonGroupNames.includes(n));
    const originalSharedOrder = originalNonGroupNames.filter((n) => sharedNames.includes(n));
    expect(sharedNames).toEqual(originalSharedOrder);

  });
});
