import { test, expect, type Page } from '@playwright/test';
import { waitForStore, createDocument, getPixelAt } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 20) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function fillActiveLayer(page: Page, color: { r: number; g: number; b: number; a: number }) {
  await page.evaluate(
    ({ color }) => {
      const editor = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          layerPixelData: Map<string, ImageData>;
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label: string) => void;
        };
      };
      const state = editor.getState();
      const id = state.document.activeLayerId;
      state.pushHistory('Fill White');
      const w = state.document.width;
      const h = state.document.height;
      const data = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        data.data[i * 4] = color.r;
        data.data[i * 4 + 1] = color.g;
        data.data[i * 4 + 2] = color.b;
        data.data[i * 4 + 3] = color.a;
      }
      state.updateLayerPixelData(id, data);
    },
    { color },
  );
  await page.waitForTimeout(200);
}

async function setSourceToLabel(page: Page, label: string) {
  await page.evaluate((lbl) => {
    const editor = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        undoStack: Array<{ id: string; label: string }>;
      };
    };
    const ts = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => { setHistoryBrushSourceId: (id: string | null) => void };
    };
    const snap = editor.getState().undoStack.find((s) => s.label === lbl);
    if (snap) ts.getState().setHistoryBrushSourceId(snap.id);
  }, label);
}

async function setTool(page: Page, tool: string) {
  await page.evaluate((t) => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool(t);
  }, tool);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('History Brush', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('reveals photo painted in snapshot under a white overlay', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');

    // "Load photo": paint a colorful pattern as the active document state.
    // Rows are red (y<100), green (100<=y<200), blue (y>=200).
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; width: number; height: number };
          updateLayerPixelData: (id: string, data: ImageData) => void;
          pushHistory: (label: string) => void;
        };
      };
      const state = editor.getState();
      const id = state.document.activeLayerId;
      const w = state.document.width;
      const h = state.document.height;
      state.pushHistory('Load Photo');
      const data = new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (y < 100) {
            data.data[idx] = 220; data.data[idx + 1] = 40; data.data[idx + 2] = 40;
          } else if (y < 200) {
            data.data[idx] = 40; data.data[idx + 1] = 200; data.data[idx + 2] = 80;
          } else {
            data.data[idx] = 40; data.data[idx + 1] = 80; data.data[idx + 2] = 220;
          }
          data.data[idx + 3] = 255;
        }
      }
      state.updateLayerPixelData(id, data);
    });
    await page.waitForTimeout(200);

    // Before screenshot: the "photo" state.
    await page.screenshot({ path: 'e2e/__screenshots__/history-brush-photo.png' });

    const photoPixel = await getPixelAt(page, 200, 50);
    expect(photoPixel.r).toBeGreaterThan(180);
    expect(photoPixel.g).toBeLessThan(100);

    // Fill the entire layer white. pushHistory inside captures the photo
    // state as undoStack snapshot labeled 'Fill White'.
    await fillActiveLayer(page, { r: 255, g: 255, b: 255, a: 255 });

    const whitePixel = await getPixelAt(page, 200, 50);
    expect(whitePixel.r).toBeGreaterThan(240);
    expect(whitePixel.g).toBeGreaterThan(240);
    expect(whitePixel.b).toBeGreaterThan(240);

    await page.screenshot({ path: 'e2e/__screenshots__/history-brush-white.png' });

    // Pick the 'Fill White' snapshot as the history source — that snapshot
    // holds the pixel data of the photo (the state that was saved before
    // the fill was applied).
    await setSourceToLabel(page, 'Fill White');
    await setTool(page, 'history-brush');
    await setToolSetting(page, 'setHistoryBrushSize', 80);
    await setToolSetting(page, 'setHistoryBrushHardness', 100);
    await setToolSetting(page, 'setHistoryBrushOpacity', 100);
    await page.waitForTimeout(200);

    // Paint a horizontal swath through the middle of the document.
    await drawStroke(page, { x: 60, y: 150 }, { x: 340, y: 150 }, 24);

    await page.screenshot({ path: 'e2e/__screenshots__/history-brush-revealed.png' });

    // The swath through y=150 should show the green photo row.
    const revealed = await getPixelAt(page, 200, 150);
    expect(revealed.g).toBeGreaterThan(120);
    expect(revealed.r).toBeLessThan(120);
    expect(revealed.b).toBeLessThan(180);

    // Above and below the stroke the canvas should remain white.
    const above = await getPixelAt(page, 200, 40);
    expect(above.r).toBeGreaterThan(240);
    expect(above.b).toBeGreaterThan(240);

    const below = await getPixelAt(page, 200, 260);
    expect(below.r).toBeGreaterThan(240);
    expect(below.b).toBeGreaterThan(240);
  });
});
