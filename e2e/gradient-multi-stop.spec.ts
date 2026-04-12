/**
 * E2E tests for multi-step gradient support.
 *
 * Verifies that:
 * 1. A 3-stop gradient (red → green → blue) renders distinct color bands
 * 2. The gradient tool uses stops from the tool-settings store
 * 3. A 2-stop gradient still works (regression)
 *
 * All tests use real UI interactions and GPU pixel readback.
 */
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__editorStore,
  );
}

async function createDocument(page: Page, width = 200, height = 200, transparent = false) {
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
      const screenX =
        (docX - state.document.width / 2) * state.viewport.zoom +
        state.viewport.panX +
        cx;
      const screenY =
        (docY - state.document.height / 2) * state.viewport.zoom +
        state.viewport.panY +
        cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
}

async function activateGradientTool(page: Page) {
  await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { setActiveTool: (t: string) => void };
    };
    ui.getState().setActiveTool('gradient');
  });
  await page.waitForTimeout(100);
}

async function setGradientStops(
  page: Page,
  stops: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>,
) {
  await page.evaluate(
    (stops) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setGradientStops: (s: typeof stops) => void };
      };
      store.getState().setGradientStops(stops);
    },
    stops,
  );
}

async function setGradientType(page: Page, type: 'linear' | 'radial') {
  await page.evaluate(
    (t) => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { setGradientType: (t: string) => void };
      };
      store.getState().setGradientType(t);
    },
    type,
  );
}

async function dragGradient(
  page: Page,
  fromDoc: { x: number; y: number },
  toDoc: { x: number; y: number },
  steps = 10,
) {
  const start = await docToScreen(page, fromDoc.x, fromDoc.y);
  const end = await docToScreen(page, toDoc.x, toDoc.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function pushHistory(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { pushHistory: (label?: string) => void };
    };
    store.getState().pushHistory('gradient');
  });
}

async function getPixelAt(page: Page, x: number, y: number, layerId?: string) {
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
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
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
    },
    { x, y, lid: layerId ?? null },
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 200, 200, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Multi-step gradient', () => {
  test('3-stop linear gradient renders red, green, and blue bands', async ({ page }) => {
    await activateGradientTool(page);
    await setGradientType(page, 'linear');
    await setGradientStops(page, [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 0, g: 255, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ]);

    // Draw horizontal gradient across the full document width
    await dragGradient(page, { x: 0, y: 100 }, { x: 199, y: 100 });

    await page.screenshot({ path: 'e2e/screenshots/gradient-3-stop-linear.png' });

    // Near the left edge (t≈0): should be predominantly red
    const leftPixel = await getPixelAt(page, 10, 100);
    expect(leftPixel.a).toBeGreaterThan(200);
    expect(leftPixel.r).toBeGreaterThan(200);
    expect(leftPixel.g).toBeLessThan(50);
    expect(leftPixel.b).toBeLessThan(50);

    // Near the center (t≈0.5): should be predominantly green
    const centerPixel = await getPixelAt(page, 100, 100);
    expect(centerPixel.a).toBeGreaterThan(200);
    expect(centerPixel.g).toBeGreaterThan(200);
    expect(centerPixel.r).toBeLessThan(50);
    expect(centerPixel.b).toBeLessThan(50);

    // Near the right edge (t≈1): should be predominantly blue
    const rightPixel = await getPixelAt(page, 189, 100);
    expect(rightPixel.a).toBeGreaterThan(200);
    expect(rightPixel.b).toBeGreaterThan(200);
    expect(rightPixel.r).toBeLessThan(50);
    expect(rightPixel.g).toBeLessThan(50);
  });

  test('2-stop gradient still works (regression check)', async ({ page }) => {
    await activateGradientTool(page);
    await setGradientType(page, 'linear');
    await setGradientStops(page, [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ]);

    await dragGradient(page, { x: 0, y: 100 }, { x: 199, y: 100 });

    await page.screenshot({ path: 'e2e/screenshots/gradient-2-stop-regression.png' });

    // Left side should be dark
    const leftPixel = await getPixelAt(page, 10, 100);
    expect(leftPixel.a).toBeGreaterThan(200);
    expect(leftPixel.r).toBeLessThan(30);
    expect(leftPixel.g).toBeLessThan(30);
    expect(leftPixel.b).toBeLessThan(30);

    // Right side should be bright
    const rightPixel = await getPixelAt(page, 189, 100);
    expect(rightPixel.a).toBeGreaterThan(200);
    expect(rightPixel.r).toBeGreaterThan(225);
    expect(rightPixel.g).toBeGreaterThan(225);
    expect(rightPixel.b).toBeGreaterThan(225);

    // Middle should be mid-gray
    const midPixel = await getPixelAt(page, 100, 100);
    expect(midPixel.r).toBeGreaterThan(100);
    expect(midPixel.r).toBeLessThan(170);
  });

  test('4-stop gradient has distinct color transitions', async ({ page }) => {
    await activateGradientTool(page);
    await setGradientType(page, 'linear');
    await setGradientStops(page, [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.33, color: { r: 255, g: 255, b: 0, a: 1 } },
      { position: 0.66, color: { r: 0, g: 255, b: 255, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ]);

    await dragGradient(page, { x: 0, y: 100 }, { x: 199, y: 100 });

    await page.screenshot({ path: 'e2e/screenshots/gradient-4-stop-linear.png' });

    // Near position 0: red
    const p1 = await getPixelAt(page, 5, 100);
    expect(p1.r).toBeGreaterThan(200);
    expect(p1.g).toBeLessThan(50);

    // Near position 0.33: yellow (R high, G high, B low)
    const p2 = await getPixelAt(page, 66, 100);
    expect(p2.r).toBeGreaterThan(200);
    expect(p2.g).toBeGreaterThan(200);
    expect(p2.b).toBeLessThan(50);

    // Near position 0.66: cyan (R low, G high, B high)
    const p3 = await getPixelAt(page, 132, 100);
    expect(p3.r).toBeLessThan(50);
    expect(p3.g).toBeGreaterThan(200);
    expect(p3.b).toBeGreaterThan(200);

    // Near position 1: blue
    const p4 = await getPixelAt(page, 194, 100);
    expect(p4.b).toBeGreaterThan(200);
    expect(p4.r).toBeLessThan(50);
  });

  test('store gradient stops state is correctly exposed', async ({ page }) => {
    // Set 3 stops via store and verify they are readable
    await setGradientStops(page, [
      { position: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 0, g: 255, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
    ]);

    const stopCount = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
        getState: () => { gradientStops: Array<{ position: number }> };
      };
      return store.getState().gradientStops.length;
    });

    expect(stopCount).toBe(3);
  });
});
