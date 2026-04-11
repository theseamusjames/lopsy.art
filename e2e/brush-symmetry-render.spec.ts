import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, getPixelAt, getEditorState } from './helpers';

test.describe('Brush symmetry renders immediately (#119)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, true);
    await page.waitForTimeout(300);
  });

  test('symmetry strokes are committed when switching layers', async ({ page }) => {
    // Enable both symmetry axes
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryHorizontal: (v: boolean) => void;
          setSymmetryVertical: (v: boolean) => void;
          setBrushSize: (v: number) => void;
          setBrushOpacity: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setSymmetryHorizontal(true);
      state.setSymmetryVertical(true);
      state.setBrushSize(20);
      state.setBrushOpacity(100);
    });

    // Select brush tool
    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    // Draw a stroke in the top-left quadrant
    const docToScreen = async (docX: number, docY: number) => {
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
          const screenX =
            (docX - state.document.width / 2) * state.viewport.zoom +
            state.viewport.panX + cx;
          const screenY =
            (docY - state.document.height / 2) * state.viewport.zoom +
            state.viewport.panY + cy;
          return { x: rect.left + screenX, y: rect.top + screenY };
        },
        { docX, docY },
      );
    };

    // Draw a stroke from (30, 30) to (70, 70)
    const start = await docToScreen(30, 30);
    const end = await docToScreen(70, 70);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/brush-symmetry-render.png' });

    // Now switch to a different layer — this should finalize the pending stroke
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }>; activeLayerId: string };
          addLayer: () => void;
        };
      };
      store.getState().addLayer();
    });
    await page.waitForTimeout(300);

    // Switch back to the original layer
    const originalLayerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { layers: Array<{ id: string; type: string }> };
        };
      };
      const layers = store.getState().document.layers;
      // Find the first raster layer (not the newly added one)
      const rasterLayers = layers.filter((l) => l.type === 'raster');
      return rasterLayers[0]?.id ?? '';
    });

    await page.evaluate(
      (id) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { setActiveLayer: (id: string) => void };
        };
        store.getState().setActiveLayer(id);
      },
      originalLayerId,
    );
    await page.waitForTimeout(200);

    // The stroke should be committed to the layer texture now
    // Verify there's content in the top-left quadrant
    const topLeft = await getPixelAt(page, 50, 50, originalLayerId);
    expect(topLeft.a).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/brush-symmetry-committed.png' });
  });

  test('effects apply to brush strokes after layer switch', async ({ page }) => {
    // Enable symmetry
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => {
          setSymmetryHorizontal: (v: boolean) => void;
          setSymmetryVertical: (v: boolean) => void;
          setBrushSize: (v: number) => void;
          setBrushOpacity: (v: number) => void;
        };
      };
      const state = store.getState();
      state.setSymmetryHorizontal(true);
      state.setSymmetryVertical(true);
      state.setBrushSize(20);
      state.setBrushOpacity(100);
    });

    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    // Draw a stroke
    const docToScreen = async (docX: number, docY: number) => {
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
    };

    const start = await docToScreen(40, 40);
    const end = await docToScreen(60, 60);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Apply effects — this should finalize the pending stroke first
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { activeLayerId: string; layers: Array<{ id: string; effects: Record<string, unknown> }> };
          updateLayerEffects: (id: string, effects: Record<string, unknown>) => void;
        };
      };
      const state = store.getState();
      const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
      if (layer) {
        state.updateLayerEffects(state.document.activeLayerId, {
          ...layer.effects,
          dropShadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 0.75 }, offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 0.75 },
        });
      }
    });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/brush-symmetry-effects.png' });

    // Verify the drop shadow effect is enabled on the active layer
    const editorState = await getEditorState(page);
    const activeLayer = editorState.document.layers.find(
      (l) => l.id === editorState.document.activeLayerId,
    );
    expect(activeLayer).toBeTruthy();
    expect(activeLayer!.effects.dropShadow.enabled).toBe(true);

    // Verify the layer has pixel content from the brush stroke
    const pixel = await getPixelAt(page, 50, 50);
    expect(pixel.a).toBeGreaterThan(0);
  });
});
