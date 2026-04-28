import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Store access — typed wrapper to avoid repeating the cast boilerplate
// ---------------------------------------------------------------------------

type StoreShape = Record<string, unknown>;

/**
 * Run a callback against the editor store inside the browser context.
 * The callback receives `getState()` and can return a serialisable value.
 */
export async function withEditorStore<T>(
  page: Page,
  fn: (state: StoreShape) => T,
): Promise<Awaited<T>> {
  return page.evaluate((fnStr) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    // eslint-disable-next-line no-eval
    return (new Function('state', `return (${fnStr})(state)`))(state);
  }, fn.toString()) as Promise<Awaited<T>>;
}

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

export async function createDocument(page: Page, width = 400, height = 300, transparent = false): Promise<void> {
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

export async function waitForStore(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

// ---------------------------------------------------------------------------
// State inspection
// ---------------------------------------------------------------------------

interface EditorSnapshot {
  document: {
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
      mask: { id: string; enabled: boolean } | null;
    }>;
    layerOrder: string[];
    activeLayerId: string;
  };
  undoStackLength: number;
  redoStackLength: number;
}

export async function getEditorState(page: Page): Promise<EditorSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const doc = state.document as EditorSnapshot['document'];
    return {
      document: doc,
      undoStackLength: (state.undoStack as unknown[]).length,
      redoStackLength: (state.redoStack as unknown[]).length,
    };
  });
}

export async function getPixelAt(
  page: Page,
  x: number,
  y: number,
  layerId?: string,
): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ x, y, lid }) => {
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
      const lx = layer?.x ?? 0;
      const ly = layer?.y ?? 0;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return { r: 0, g: 0, b: 0, a: 0 };
      // Convert document coords to layer-local coords
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
    { x, y, lid: layerId ?? null },
  );
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function paintRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number },
  layerId?: string,
): Promise<void> {
  await page.evaluate(
    ({ x, y, w, h, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number; layers: Array<{ id: string; width: number; height: number }> };
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

export async function paintCircle(
  page: Page,
  cx: number,
  cy: number,
  radius: number,
  color: { r: number; g: number; b: number; a: number },
  layerId?: string,
): Promise<void> {
  await page.evaluate(
    ({ cx, cy, radius, color, lid }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number; layers: Array<{ id: string; width: number; height: number }> };
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

export async function addLayer(page: Page): Promise<string> {
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(200);
  const id = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
  return id;
}

export async function setActiveLayer(page: Page, layerId: string): Promise<void> {
  const locator = page.locator(`[data-layer-id="${layerId}"]`);
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.click();
}

export async function moveLayer(page: Page, layerId: string, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ id, x, y }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          pushHistory: (label?: string) => void;
          updateLayerPosition: (id: string, x: number, y: number) => void;
        };
      };
      const state = store.getState();
      state.pushHistory('Move Layer');
      state.updateLayerPosition(id, x, y);
    },
    { id: layerId, x, y },
  );
}

export async function undo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}

export async function redo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+z');
}

// ---------------------------------------------------------------------------
// UI interaction helpers
// ---------------------------------------------------------------------------

const TOOL_SHORTCUTS: Record<string, string> = {
  move: 'v', brush: 'b', pencil: 'n', eraser: 'e', fill: 'g',
  eyedropper: 'i', stamp: 's', dodge: 'o', smudge: 'r', spray: 'j',
  'marquee-rect': 'm', lasso: 'l', wand: 'w',
  shape: 'u', text: 't', crop: 'c', path: 'p',
};

export async function selectTool(page: Page, toolId: string): Promise<void> {
  const key = TOOL_SHORTCUTS[toolId];
  if (key) {
    await page.keyboard.press(key);
  } else {
    await page.locator(`[data-tool-id="${toolId}"]`).click();
  }
}

export async function setToolOption(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`role=toolbar >> [aria-label="${label} value"]`).first();
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

export async function setForegroundColor(page: Page, r: number, g: number, b: number, a?: number): Promise<void> {
  const hex = [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  const input = page.locator('[aria-label="Hex color value"]');
  await input.fill(hex);
  await input.press('Enter');
  if (a !== undefined && a < 1) {
    const alphaInput = page.locator('[aria-label="A value"]');
    await alphaInput.fill(String(Math.round(a * 100)));
    await alphaInput.press('Enter');
  }
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

export async function openBrushModal(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
  if (!(await dialog.isVisible())) {
    await page.locator('[aria-label="Open brush presets"]').click();
    await page.waitForTimeout(100);
  }
}

export async function closeBrushModal(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"][aria-label="Brushes"]');
  if (await dialog.isVisible()) {
    await dialog.locator('button:has-text("Close")').click();
  }
}

export async function setBrushModalOption(page: Page, label: string, value: number): Promise<void> {
  await openBrushModal(page);
  const input = page.locator(`[role="dialog"][aria-label="Brushes"] [aria-label="${label} value"]`);
  await input.fill(String(value));
  await input.press('Enter');
}

export async function setBlendMode(page: Page, mode: string): Promise<void> {
  const select = page.locator('[aria-labelledby="blend-mode-label"]');
  if (!(await select.isVisible())) {
    await page.locator('button[aria-label*="effects"]').first().click();
    await page.waitForTimeout(100);
  }
  await select.selectOption(mode);
}

export async function setLayerOpacity(page: Page, layerId: string, percent: number): Promise<void> {
  const row = page.locator(`[data-layer-id="${layerId}"]`);
  await row.locator('button[class*="opacityBtn"]').click();
  const slider = page.locator(`[aria-label*="opacity"][type="range"]`);
  await slider.fill(String(percent));
}

export async function applyFilter(
  page: Page,
  filterName: string,
  params?: Record<string, number>,
): Promise<void> {
  await page.click('text=Filter');
  await page.click(`text=${filterName}`);
  if (params) {
    const modal = page.locator(`h2:has-text("${filterName.replace('...', '')}")`)
      .locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    for (const [label, value] of Object.entries(params)) {
      const slider = modal.locator(`text=${label}`).locator('..').locator('input[type="range"]');
      await slider.fill(String(value));
    }
    await page.locator('button:has-text("Apply")').click();
  }
  await page.waitForTimeout(200);
}

export async function setAdjustment(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator(`[aria-label="${label} value"]`);
  if (!(await input.isVisible())) {
    const valuesSliders = ['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Vignette'];
    const tab = valuesSliders.includes(label) ? 'Values' : 'Colors';
    await page.locator(`role=tab[name="${tab}"]`).click();
  }
  await input.fill(String(value));
  await input.press('Enter');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

// ---------------------------------------------------------------------------
// Coordinate projection
// ---------------------------------------------------------------------------

export async function docToScreen(
  page: Page,
  docX: number,
  docY: number,
): Promise<{ x: number; y: number }> {
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

// ---------------------------------------------------------------------------
// Drawing via shape tool (replaces paintRect/paintCircle for UI-driven tests)
// ---------------------------------------------------------------------------

async function saveTool(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTool: string };
    };
    return store.getState().activeTool;
  });
}

export async function drawRect(
  page: Page,
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a?: number },
): Promise<void> {
  const prevTool = await saveTool(page);
  await setForegroundColor(page, color.r, color.g, color.b, color.a);
  await selectTool(page, 'marquee-rect');
  const start = await docToScreen(page, x, y);
  const end = await docToScreen(page, x + w, y + h);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await selectTool(page, 'fill');
  const center = await docToScreen(page, x + w / 2, y + h / 2);
  await page.mouse.click(center.x, center.y);
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
  await page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const s = store.getState();
    const id = s.document.activeLayerId;
    const gpu = await readFn(id);
    if (gpu && gpu.width > 0) {
      const img = new ImageData(gpu.width, gpu.height);
      for (let i = 0; i < gpu.pixels.length; i++) img.data[i] = gpu.pixels[i]!;
      s.updateLayerPixelData(id, img);
    }
  });
  await selectTool(page, prevTool);
}

export async function drawEllipse(
  page: Page,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: { r: number; g: number; b: number; a?: number },
): Promise<void> {
  const prevTool = await saveTool(page);
  await setForegroundColor(page, color.r, color.g, color.b, color.a);
  await selectTool(page, 'shape');
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
  const start = await docToScreen(page, cx - rx, cy - ry);
  const end = await docToScreen(page, cx + rx, cy + ry);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string };
        updateLayerPixelData: (id: string, data: ImageData) => void;
      };
    };
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const s = store.getState();
    const id = s.document.activeLayerId;
    const gpu = await readFn(id);
    if (gpu && gpu.width > 0) {
      const img = new ImageData(gpu.width, gpu.height);
      for (let i = 0; i < gpu.pixels.length; i++) img.data[i] = gpu.pixels[i]!;
      s.updateLayerPixelData(id, img);
    }
  });
  await selectTool(page, prevTool);
}

// ---------------------------------------------------------------------------
// Move layer via move tool drag (replaces moveLayer store call)
// ---------------------------------------------------------------------------

export async function moveLayerTo(
  page: Page,
  layerId: string,
  targetX: number,
  targetY: number,
): Promise<void> {
  const current = await page.evaluate((lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          layers: Array<{ id: string; x: number; y: number; width: number; height: number }>;
        };
        viewport: { zoom: number };
      };
    };
    const state = store.getState();
    const layer = state.document.layers.find((l) => l.id === lid);
    if (!layer) return { x: 0, y: 0, w: 0, h: 0, zoom: 1 };
    return { x: layer.x, y: layer.y, w: layer.width, h: layer.height, zoom: state.viewport.zoom };
  }, layerId);

  await setActiveLayer(page, layerId);
  await selectTool(page, 'move');

  const centerDocX = current.x + current.w / 2;
  const centerDocY = current.y + current.h / 2;
  const start = await docToScreen(page, centerDocX, centerDocY);

  const dx = (targetX - current.x) * current.zoom;
  const dy = (targetY - current.y) * current.zoom;

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Layer effects via effects panel UI
// ---------------------------------------------------------------------------

export async function openEffectsPanel(page: Page): Promise<void> {
  const panel = page.locator('[aria-labelledby="blend-mode-label"]');
  if (!(await panel.isVisible())) {
    const activeId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    const row = page.locator(`[data-layer-id="${activeId}"]`);
    await row.locator('button[aria-label*="effects"]').click();
    await panel.waitFor({ state: 'visible', timeout: 5000 });
  }
}

export async function closeEffectsPanel(page: Page): Promise<void> {
  const close = page.locator('[aria-label="Close effects"]');
  if (await close.isVisible()) {
    await close.click();
    await page.waitForTimeout(50);
  }
}

export async function enableEffect(page: Page, effectName: string): Promise<void> {
  await openEffectsPanel(page);
  const checkbox = page.locator(`[aria-label="Enable ${effectName}"]`);
  await checkbox.waitFor({ state: 'visible', timeout: 5000 });
  if (!(await checkbox.isChecked())) {
    await checkbox.click();
  }
  const row = page.locator(`[role="option"]`).filter({ hasText: effectName });
  await row.click();
  await page.waitForTimeout(50);
}

export async function configureEffect(
  page: Page,
  effectName: string,
  settings: Record<string, number>,
): Promise<void> {
  await enableEffect(page, effectName);
  for (const [label, value] of Object.entries(settings)) {
    const input = page.locator(`[aria-label="${label} value"]`);
    await input.waitFor({ state: 'visible', timeout: 3000 });
    await input.fill(String(value));
    await input.press('Enter');
  }
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

export async function setEffectColor(
  page: Page,
  ariaLabel: string,
  r: number,
  g: number,
  b: number,
): Promise<void> {
  const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  const input = page.locator(`[aria-label="${ariaLabel}"]`);
  await input.fill(hex);
}
