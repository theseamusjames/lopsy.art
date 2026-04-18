import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 600, height = 600, transparent = false) {
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

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
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
    const colorSetters = new Set(['setForegroundColor', 'setBackgroundColor', 'swapColors', 'resetColors', 'addRecentColor']);
    const storeKey = colorSetters.has(setter) ? '__toolSettingsStore' : '__uiStore';
    const store = (window as unknown as Record<string, unknown>)[storeKey] as {
      getState: () => Record<string, (v: unknown) => void>;
    };
    store.getState()[setter]!(value);
  }, { setter, value });
}

async function addLayer(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addLayer: () => void };
    };
    store.getState().addLayer();
  });
  await page.waitForTimeout(200);
}

/**
 * Read the composited pixel at a document coordinate by using the
 * __readCompositedPixels helper exposed in dev mode. This renders a
 * fresh frame and reads back the WebGL buffer before swap.
 */
async function readCompositedPixelAt(page: Page, docX: number, docY: number): Promise<{ r: number; g: number; b: number; a: number }> {
  return page.evaluate(
    async ({ docX, docY }) => {
      const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
        () => Promise<{ width: number; height: number; pixels: number[] } | null>;
      const result = await readFn();
      if (!result) return { r: 0, g: 0, b: 0, a: 0 };

      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { width: number; height: number };
          viewport: { zoom: number; panX: number; panY: number };
        };
      };
      const state = store.getState();
      const container = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      if (!container) return { r: 0, g: 0, b: 0, a: 0 };

      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const screenX = (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx;
      const screenY = (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy;

      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(screenX * dpr);
      // WebGL readPixels returns bottom-up, so flip Y
      const py = result.height - 1 - Math.round(screenY * dpr);

      if (px < 0 || px >= result.width || py < 0 || py >= result.height) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      const idx = (py * result.width + px) * 4;
      return {
        r: result.pixels[idx] ?? 0,
        g: result.pixels[idx + 1] ?? 0,
        b: result.pixels[idx + 2] ?? 0,
        a: result.pixels[idx + 3] ?? 0,
      };
    },
    { docX, docY },
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Brush Opacity Range', () => {
  test('opacity produces smooth transition from background to foreground color', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);

    // Create 600x600 white document
    await createDocument(page, 600, 600, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(500);

    // Select brush tool
    await page.keyboard.press('b');
    await page.waitForTimeout(100);

    // Set up brush: 50px, hard, full opacity, no spacing
    await setToolSetting(page, 'setBrushSize', 50);
    await setToolSetting(page, 'setBrushHardness', 100);
    await setToolSetting(page, 'setBrushOpacity', 100);
    await setToolSetting(page, 'setBrushSpacing', 0);

    // Set foreground color to black
    await setUIState(page, 'setForegroundColor', { r: 0, g: 0, b: 0, a: 1 });

    // Draw vertical black line at x=300, from y=20 to y=580
    await drawStroke(page, { x: 300, y: 20 }, { x: 300, y: 580 }, 30);

    // Set foreground color to red
    await setUIState(page, 'setForegroundColor', { r: 255, g: 0, b: 0, a: 1 });

    // Add new layer for red strokes
    await addLayer(page);
    await page.waitForTimeout(200);

    // Draw 11 horizontal lines at different opacities: 1, 10, 20, 30, ... 100
    const opacities = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const yPositions: number[] = [];

    for (let i = 0; i < opacities.length; i++) {
      const opacity = opacities[i]!;
      const y = 30 + i * 50; // Spaced 50px apart: y = 30, 80, 130, ...
      yPositions.push(y);

      await setToolSetting(page, 'setBrushOpacity', opacity);
      await drawStroke(page, { x: 50, y }, { x: 550, y }, 20);
    }

    // Wait for rendering to settle
    await page.waitForTimeout(500);

    // Take screenshot for visual reference
    await page.screenshot({ path: 'test-results/screenshots/opacity-range-test.png' });

    // Sample multiple points per stripe: crossing (x=300), and off-crossing (x=150)
    const results: Array<{ opacity: number; crossing: { r: number; g: number; b: number; a: number }; offCross: { r: number; g: number; b: number; a: number } }> = [];

    for (let i = 0; i < opacities.length; i++) {
      const crossing = await readCompositedPixelAt(page, 300, yPositions[i]!);
      const offCross = await readCompositedPixelAt(page, 150, yPositions[i]!);
      results.push({ opacity: opacities[i]!, crossing, offCross });
    }

    // Log all results for debugging
    console.log('\n=== Brush Opacity Range Results ===');
    console.log('Opacity | Cross R  G  B  A | Off R  G  B  A | Exp Cross R | Exp Off R');
    console.log('--------|------------------|----------------|-------------|----------');
    for (const r of results) {
      const expectedCrossR = Math.round(255 * r.opacity / 100);
      // Off-crossing: red over white = 255*opacity + 255*(1-opacity) = 255 for R,
      // but G = 0*opacity + 255*(1-opacity) = 255*(1-opacity)
      const expectedOffG = Math.round(255 * (1 - r.opacity / 100));
      console.log(
        `${String(r.opacity).padStart(7)} | ${String(r.crossing.r).padStart(4)} ${String(r.crossing.g).padStart(3)} ${String(r.crossing.b).padStart(3)} ${String(r.crossing.a).padStart(3)} | ${String(r.offCross.r).padStart(3)} ${String(r.offCross.g).padStart(3)} ${String(r.offCross.b).padStart(3)} ${String(r.offCross.a).padStart(3)} | ${String(expectedCrossR).padStart(11)} | ${String(expectedOffG).padStart(8)}`,
      );
    }

    // Verify: crossing R values should increase monotonically
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.crossing.r).toBeGreaterThanOrEqual(results[i - 1]!.crossing.r);
    }

    // Verify: 1% opacity at crossing should be very close to 0
    expect(results[0]!.crossing.r).toBeLessThan(20);

    // Verify: 50% opacity at crossing should be roughly half red
    const mid = results[5]!;
    expect(mid.crossing.r).toBeGreaterThan(90);
    expect(mid.crossing.r).toBeLessThan(170);

    // Verify: 100% opacity at crossing should be fully red
    expect(results[10]!.crossing.r).toBeGreaterThan(230);

    // Verify: off-crossing G values should decrease (white → red transition)
    // At 1% red over white: G ≈ 252. At 100% red over white: G ≈ 0.
    expect(results[0]!.offCross.g).toBeGreaterThan(230);
    expect(results[10]!.offCross.g).toBeLessThan(20);
  });
});
