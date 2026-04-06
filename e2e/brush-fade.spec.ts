import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (same pattern as brush-opacity-range.spec.ts)
// ---------------------------------------------------------------------------

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
  await page.waitForTimeout(300);
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

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 30) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function setToolSetting(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__toolSettingsStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function setUIState(page: Page, setter: string, value: unknown) {
  await page.evaluate(({ setter, value }) => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function readLayerPixelAt(page: Page, x: number, y: number, layerId?: string): Promise<{ r: number; g: number; b: number; a: number }> {
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

async function setupBrush(page: Page, opts: { size: number; opacity: number; hardness: number; fade: number }) {
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolSetting(page, 'setBrushSize', opts.size);
  await setToolSetting(page, 'setBrushOpacity', opts.opacity);
  await setToolSetting(page, 'setBrushHardness', opts.hardness);
  await setToolSetting(page, 'setBrushSpacing', 0);
  await setToolSetting(page, 'setBrushFade', opts.fade);
  await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Brush fade (#58)', () => {
  test('stroke opacity decreases with fade enabled', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);

    // Transparent document so alpha directly reflects brush output
    await createDocument(page, 400, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    // Brush: size 20, 100% opacity, full hardness, fade 200px
    await setupBrush(page, { size: 20, opacity: 100, hardness: 100, fade: 200 });

    // Draw a horizontal stroke from x=50 to x=350 (300px length) at y=100
    // With fade=200, the stroke should fully fade out after 200px of travel
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 30);

    await page.screenshot({ path: 'test-results/screenshots/brush-fade-stroke.png' });

    // Sample alpha at the start, middle, and end of the stroke
    const startPixel = await readLayerPixelAt(page, 60, 100);
    const midPixel = await readLayerPixelAt(page, 150, 100);
    const endPixel = await readLayerPixelAt(page, 280, 100);

    console.log('\n=== Brush Fade Results ===');
    console.log(`Start (x=60):  r=${startPixel.r} g=${startPixel.g} b=${startPixel.b} a=${startPixel.a}`);
    console.log(`Mid   (x=150): r=${midPixel.r} g=${midPixel.g} b=${midPixel.b} a=${midPixel.a}`);
    console.log(`End   (x=280): r=${endPixel.r} g=${endPixel.g} b=${endPixel.b} a=${endPixel.a}`);

    // Start of the stroke should have high alpha (near full opacity)
    expect(startPixel.a).toBeGreaterThan(180);

    // Middle should be reduced relative to the start
    expect(midPixel.a).toBeLessThan(startPixel.a);

    // End should be very low or zero (past the 200px fade distance)
    expect(endPixel.a).toBeLessThan(midPixel.a);

    // Verify the monotonic decrease: start > mid > end
    expect(startPixel.a).toBeGreaterThan(midPixel.a);
    expect(midPixel.a).toBeGreaterThan(endPixel.a);
  });

  test('no fade when fade is set to 0', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);

    await createDocument(page, 400, 200, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    // Brush with fade=0 (disabled)
    await setupBrush(page, { size: 20, opacity: 100, hardness: 100, fade: 0 });

    // Draw a horizontal stroke from x=50 to x=350 at y=100
    await drawStroke(page, { x: 50, y: 100 }, { x: 350, y: 100 }, 30);

    await page.screenshot({ path: 'test-results/screenshots/brush-no-fade.png' });

    // Sample alpha at the start, middle, and end
    const startPixel = await readLayerPixelAt(page, 60, 100);
    const midPixel = await readLayerPixelAt(page, 200, 100);
    const endPixel = await readLayerPixelAt(page, 340, 100);

    console.log('\n=== No Fade Results ===');
    console.log(`Start (x=60):  r=${startPixel.r} g=${startPixel.g} b=${startPixel.b} a=${startPixel.a}`);
    console.log(`Mid   (x=200): r=${midPixel.r} g=${midPixel.g} b=${midPixel.b} a=${midPixel.a}`);
    console.log(`End   (x=340): r=${endPixel.r} g=${endPixel.g} b=${endPixel.b} a=${endPixel.a}`);

    // All points should have high alpha (near full opacity)
    expect(startPixel.a).toBeGreaterThan(200);
    expect(midPixel.a).toBeGreaterThan(200);
    expect(endPixel.a).toBeGreaterThan(200);

    // Opacity should be roughly consistent along the stroke (within tolerance)
    const tolerance = 30;
    expect(Math.abs(startPixel.a - midPixel.a)).toBeLessThan(tolerance);
    expect(Math.abs(midPixel.a - endPixel.a)).toBeLessThan(tolerance);
  });
});
