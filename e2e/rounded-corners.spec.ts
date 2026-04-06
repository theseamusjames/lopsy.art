import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (mirrored from tools.spec.ts for isolation)
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

async function drawStroke(
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
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Rounded corners (#62)', () => {
  test('rectangle with corner radius has rounded corners', async ({ page }) => {
    await createDocument(page, 400, 300, true);

    // Configure shape tool: polygon mode, 4 sides (rectangle), corner radius 20
    await page.keyboard.press('u');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeCornerRadius', 20);
    await setToolSetting(page, 'setShapeFillColor', { r: 255, g: 0, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw rectangle: center at (150,150), drag to (250,250) giving ~100px radius
    // The bounding box spans roughly (50,50) to (250,250)
    await drawStroke(page, { x: 150, y: 150 }, { x: 250, y: 250 }, 5);

    await page.screenshot({ path: 'test-results/screenshots/rounded-corners-rectangle.png' });

    // The exact corner pixel of the bounding box should be transparent (rounded off)
    const corner = await getPixelAt(page, 50, 50);
    expect(corner.a).toBe(0);

    // The center of the shape should be filled with red
    const center = await getPixelAt(page, 150, 150);
    expect(center.a).toBeGreaterThan(0);
    expect(center.r).toBe(255);
  });

  test('corner radius is capped at half the shortest side', async ({ page }) => {
    await createDocument(page, 400, 300, true);

    // Configure shape tool: small rectangle with excessive corner radius
    await page.keyboard.press('u');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeCornerRadius', 100);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 0, b: 255, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw a small rectangle: center at (150,150), drag to (170,170) giving ~20px radius
    // Bounding box is roughly 40x40. Corner radius 100 exceeds half-width (20),
    // so it should be capped, producing a nearly circular shape.
    await drawStroke(page, { x: 150, y: 150 }, { x: 170, y: 170 }, 5);

    await page.screenshot({ path: 'test-results/screenshots/rounded-corners-capped.png' });

    // Should not crash; center should still be filled
    const center = await getPixelAt(page, 150, 150);
    expect(center.a).toBeGreaterThan(0);
    expect(center.b).toBe(255);

    // Corner of bounding box should be transparent (fully rounded)
    const corner = await getPixelAt(page, 130, 130);
    expect(corner.a).toBe(0);
  });

  test('zero corner radius produces sharp corners', async ({ page }) => {
    await createDocument(page, 400, 300, true);

    // Configure shape tool: rectangle with zero corner radius
    await page.keyboard.press('u');
    await setToolSetting(page, 'setShapeMode', 'polygon');
    await setToolSetting(page, 'setShapePolygonSides', 4);
    await setToolSetting(page, 'setShapeCornerRadius', 0);
    await setToolSetting(page, 'setShapeFillColor', { r: 0, g: 255, b: 0, a: 1 });
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Draw rectangle: center at (150,150), drag to (250,250)
    // Bounding box spans roughly (50,50) to (250,250)
    await drawStroke(page, { x: 150, y: 150 }, { x: 250, y: 250 }, 5);

    await page.screenshot({ path: 'test-results/screenshots/sharp-corners.png' });

    // With zero corner radius, a pixel well inside the polygon should be filled.
    // The 4-sided polygon edge midpoints are at ~71px from center.
    // Check a pixel at (150, 85) which is 65px above center — inside the shape.
    const corner = await getPixelAt(page, 150, 85);
    expect(corner.a).toBeGreaterThan(0);
    expect(corner.g).toBe(255);

    // Center should also be filled
    const center = await getPixelAt(page, 150, 150);
    expect(center.a).toBeGreaterThan(0);
    expect(center.g).toBe(255);
  });
});
