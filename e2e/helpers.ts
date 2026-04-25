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

export async function addLayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addLayer: () => void };
    };
    store.getState().addLayer();
  });
}

export async function setActiveLayer(page: Page, layerId: string): Promise<void> {
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
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undo: () => void };
    };
    store.getState().undo();
  });
}

export async function redo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { redo: () => void };
    };
    store.getState().redo();
  });
}
