import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor } from './helpers';

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 200, transparent = false) {
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

/**
 * Draw a zigzag stroke to test smoothing — a series of points that move
 * forward along x while oscillating on y.
 */
async function drawZigzagStroke(page: Page, startX: number, y: number, amplitude: number, steps: number) {
  const start = await docToScreen(page, startX, y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const docX = startX + (i / steps) * 300;
    const docY = y + (i % 2 === 0 ? amplitude : -amplitude);
    const pt = await docToScreen(page, docX, docY);
    await page.mouse.move(pt.x, pt.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/**
 * Measure the vertical variance of painted pixels on the active layer.
 * Uses __readLayerPixels which returns raw layer texture data in
 * layer-local coordinates (no viewport transform needed).
 */
async function measureVerticalVariance(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { activeLayerId: string; layers: Array<{ id: string }> };
      };
    };
    const state = store.getState();
    const layerId = state.document.activeLayerId;

    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn(layerId);
    if (!result || result.width === 0) return 0;

    const allY: number[] = [];
    for (let y = 0; y < result.height; y++) {
      for (let x = 0; x < result.width; x++) {
        const idx = (y * result.width + x) * 4;
        const a = result.pixels[idx + 3] ?? 0;
        if (a > 10) {
          allY.push(y);
        }
      }
    }

    if (allY.length === 0) return 0;
    const mean = allY.reduce((s, v) => s + v, 0) / allY.length;
    const variance = allY.reduce((s, v) => s + (v - mean) ** 2, 0) / allY.length;
    return Math.sqrt(variance);
  });
}

test.describe('Brush stroke stabilizer', () => {
  test('stabilizer smooths a zigzag stroke compared to no stabilizer', async ({ page }) => {
    // --- First: draw WITHOUT stabilizer ---
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await page.keyboard.press('b');
    await page.waitForTimeout(100);
    await setToolOption(page, 'Size', 6);
    await setToolOption(page, 'Opacity', 100);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Smooth', 0);
    await setForegroundColor(page, 255, 0, 0);

    await drawZigzagStroke(page, 30, 60, 25, 20);

    // Finalize the stroke so composited pixels include it
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: (label: string) => void };
      };
      store.getState().pushHistory('Brush');
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/stabilizer-before.png' });
    const unstableVariance = await measureVerticalVariance(page);

    // --- Second: fresh document, draw WITH stabilizer ---
    await createDocument(page, 400, 200, true);
    await page.waitForTimeout(300);

    await page.keyboard.press('b');
    await page.waitForTimeout(100);
    await setToolOption(page, 'Size', 6);
    await setToolOption(page, 'Opacity', 100);
    await setToolOption(page, 'Hardness', 100);
    await setToolOption(page, 'Smooth', 80);
    await setForegroundColor(page, 255, 0, 0);

    await drawZigzagStroke(page, 30, 60, 25, 20);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { pushHistory: (label: string) => void };
      };
      store.getState().pushHistory('Brush');
    });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/stabilizer-after.png' });
    const stableVariance = await measureVerticalVariance(page);

    console.log('\n=== Stabilizer Results ===');
    console.log(`Unstabilized y-variance: ${unstableVariance.toFixed(2)}`);
    console.log(`Stabilized y-variance:   ${stableVariance.toFixed(2)}`);

    // The stabilized stroke should have lower vertical variance
    // because the smoothing dampens the zigzag amplitude.
    expect(stableVariance).toBeLessThan(unstableVariance);
  });

  test('stabilizer slider appears in brush options bar', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    await page.keyboard.press('b');
    await page.waitForTimeout(200);

    const smoothSlider = page.locator('text=Smooth');
    await expect(smoothSlider).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/stabilizer-ui.png' });
  });
});
