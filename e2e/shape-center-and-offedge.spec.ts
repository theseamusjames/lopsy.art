/**
 * Regressions surfaced by the store-refactor pass:
 *
 *   1. Clicking once with the shape tool opens the ShapeSizeModal. Confirming
 *      should create a shape centered on the click point. After the refactor
 *      the shape was drawn offset — the click coordinates were being
 *      interpreted in the wrong space.
 *
 *   2. Moving a layer with the move tool cropped the layer to content bounds
 *      on mouse-down. If the user subsequently dragged part of the layer off
 *      the canvas and back, the off-edge pixels were permanently clipped and
 *      lost on the return trip.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore, getPixelAt, selectTool, setForegroundColor } from './helpers';

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
      const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
      const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;
      return { x: rect.left + screenX, y: rect.top + screenY };
    },
    { docX, docY },
  );
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

async function setShapeMode(page: Page, mode: string) {
  const select = page.locator('[aria-labelledby="shape-mode-label"]');
  await select.selectOption(mode);
}

async function getActiveLayer(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: {
          activeLayerId: string;
          layers: Array<{ id: string; name: string; x: number; y: number; width?: number; height?: number; type: string }>;
        };
      };
    };
    const state = store.getState();
    const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
    return layer ?? null;
  });
}

async function countOpaquePixels(page: Page, layerId?: string) {
  return page.evaluate(
    async (lid) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      const id = lid ?? store.getState().document.activeLayerId;
      const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
        id?: string,
      ) => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn(id);
      if (!result || result.width === 0) return 0;
      let count = 0;
      for (let i = 3; i < result.pixels.length; i += 4) {
        if ((result.pixels[i] ?? 0) > 0) count++;
      }
      return count;
    },
    layerId ?? null,
  );
}

test.describe('Shape tool click-to-size centering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('click + ShapeSizeModal Create centers the shape on the click point', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await selectTool(page, 'shape');
    await setShapeMode(page, 'ellipse');
    await setToolSetting(page, 'setShapeStrokeColor', null);

    // Click (no drag) at doc center (200, 150). The shape tool interprets
    // sub-threshold pointer-ups as "please open the ShapeSizeModal".
    const clickScreen = await docToScreen(page, 200, 150);
    await page.mouse.move(clickScreen.x, clickScreen.y);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.locator('h2:has-text("Shape Size")')).toBeVisible({ timeout: 3000 });

    // Pick a size smaller than the document so the shape fits entirely and
    // doesn't hug the canvas edges (would mask a centering bug).
    const modal = page.locator('h2:has-text("Shape Size")').locator('xpath=ancestor::*[contains(@class,"modal")][1]');
    const inputs = modal.locator('input[type="number"]');
    await expect(inputs).toHaveCount(2);
    await inputs.nth(0).fill('100');
    await inputs.nth(1).fill('100');

    await modal.locator('button:has-text("Create")').click();
    await expect(page.locator('h2:has-text("Shape Size")')).toHaveCount(0, { timeout: 3000 });
    await page.waitForTimeout(200);

    const layer = await getActiveLayer(page);
    expect(layer).not.toBeNull();
    expect(layer!.type).toBe('raster');
    // After updateLayerPixelData, the layer is cropped to its bounding box.
    // For a 100×100 ellipse centered on (200, 150) the bounding box is
    // (150, 100, 100, 100) with ~1 px slack for anti-aliasing.
    const centerX = layer!.x + (layer!.width ?? 0) / 2;
    const centerY = layer!.y + (layer!.height ?? 0) / 2;
    expect(Math.abs(centerX - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(centerY - 150)).toBeLessThanOrEqual(2);

    // Pixel checks: dead-center must be red, points well outside the ellipse
    // must be transparent.
    const center = await getPixelAt(page, 200, 150);
    expect(center.r).toBe(255);
    expect(center.a).toBeGreaterThan(0);

    const farOutside = await getPixelAt(page, 20, 20);
    expect(farOutside.a).toBe(0);

    // Just outside the ellipse on the major axis: x = 200 + 55 > rx = 50.
    const justOutside = await getPixelAt(page, 255, 150);
    expect(justOutside.a).toBe(0);
  });
});

test.describe('Move tool off-edge pixel preservation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('dragging a shape partially off-canvas and back does not clip its pixels', async ({ page }) => {
    // Create an opaque shape on the active layer via drag (reliably centred,
    // no modal indirection — this test is about the *move* regression).
    await setForegroundColor(page, 0, 255, 0);
    await selectTool(page, 'shape');
    await setShapeMode(page, 'ellipse');
    await setToolSetting(page, 'setShapeStrokeColor', null);

    const dragFrom = await docToScreen(page, 200, 150);
    const dragTo = await docToScreen(page, 260, 200);
    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
    await page.mouse.move(dragTo.x, dragTo.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const initialOpaque = await countOpaquePixels(page);
    expect(initialOpaque).toBeGreaterThan(1000);

    // Switch to move tool and drag far enough right that roughly half the
    // shape leaves the canvas.
    await page.keyboard.press('v');
    await page.waitForTimeout(50);

    const moveStart = await docToScreen(page, 200, 150);
    const moveOffEdge = await docToScreen(page, 380, 150); // shape center near right edge
    await page.mouse.move(moveStart.x, moveStart.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveStart.x + (moveOffEdge.x - moveStart.x) * t,
        moveStart.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Drag back to the original position.
    const moveBackStart = await docToScreen(page, 380, 150);
    const moveBackEnd = await docToScreen(page, 200, 150);
    await page.mouse.move(moveBackStart.x, moveBackStart.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(
        moveBackStart.x + (moveBackEnd.x - moveBackStart.x) * t,
        moveBackStart.y,
      );
    }
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Every pixel that was opaque before the round-trip must still be
    // opaque. If cropLayerToContent ran during the off-edge segment and
    // discarded off-canvas pixels, the count would drop.
    const afterOpaque = await countOpaquePixels(page);
    console.log(`  before: ${initialOpaque}, after: ${afterOpaque}`);
    expect(afterOpaque).toBeGreaterThanOrEqual(initialOpaque * 0.98);

    // And the shape is back where it started.
    const center = await getPixelAt(page, 200, 150);
    expect(center.g).toBe(255);
    expect(center.a).toBeGreaterThan(0);
  });
});
