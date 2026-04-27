import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, setBrushModalOption, closeBrushModal } from './helpers';

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

async function drawStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 30) {
  const start = await docToScreen(page, from.x, from.y);
  const end = await docToScreen(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

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

      const px = Math.round(screenX);
      const py = result.height - 1 - Math.round(screenY);

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

async function setupBrush(page: Page, opts: { size: number; opacity: number; hardness: number; fade: number }) {
  await page.keyboard.press('b');
  await page.waitForTimeout(100);
  await setToolOption(page, 'Size', opts.size);
  await setToolOption(page, 'Opacity', opts.opacity);
  await setToolOption(page, 'Hardness', opts.hardness);
  await setBrushModalOption(page, 'Spacing', 0);
  await closeBrushModal(page);
  await setToolOption(page, 'Fade', opts.fade);
  await setForegroundColor(page, 255, 0, 0);
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
    const startPixel = await readCompositedPixelAt(page, 60, 100);
    const midPixel = await readCompositedPixelAt(page, 150, 100);
    const endPixel = await readCompositedPixelAt(page, 280, 100);

    console.log('\n=== Brush Fade Results ===');
    console.log(`Start (x=60):  r=${startPixel.r} g=${startPixel.g} b=${startPixel.b} a=${startPixel.a}`);
    console.log(`Mid   (x=150): r=${midPixel.r} g=${midPixel.g} b=${midPixel.b} a=${midPixel.a}`);
    console.log(`End   (x=280): r=${endPixel.r} g=${endPixel.g} b=${endPixel.b} a=${endPixel.a}`);

    // On an opaque composited view, brush fade shows in color channels.
    // A red brush on white bg: start should be nearly pure red, end nearly white.
    // Red channel stays high at start, green/blue are low (near 0).
    // As brush fades, green/blue increase toward background white (255).
    expect(startPixel.r).toBeGreaterThan(200);
    expect(startPixel.g).toBeLessThan(50);

    // Middle should show partial fade: green channel higher than start
    expect(midPixel.g).toBeGreaterThan(startPixel.g);

    // End should be nearly background (past 200px fade distance)
    expect(endPixel.g).toBeGreaterThan(midPixel.g);

    // Verify monotonic fade: green increases as brush fades out
    expect(startPixel.g).toBeLessThan(midPixel.g);
    expect(midPixel.g).toBeLessThan(endPixel.g);
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
    const startPixel = await readCompositedPixelAt(page, 60, 100);
    const midPixel = await readCompositedPixelAt(page, 200, 100);
    const endPixel = await readCompositedPixelAt(page, 340, 100);

    console.log('\n=== No Fade Results ===');
    console.log(`Start (x=60):  r=${startPixel.r} g=${startPixel.g} b=${startPixel.b} a=${startPixel.a}`);
    console.log(`Mid   (x=200): r=${midPixel.r} g=${midPixel.g} b=${midPixel.b} a=${midPixel.a}`);
    console.log(`End   (x=340): r=${endPixel.r} g=${endPixel.g} b=${endPixel.b} a=${endPixel.a}`);

    // All points should be solid red (no fade): red high, green/blue low
    expect(startPixel.r).toBeGreaterThan(200);
    expect(midPixel.r).toBeGreaterThan(200);
    expect(endPixel.r).toBeGreaterThan(200);
    expect(startPixel.g).toBeLessThan(50);
    expect(midPixel.g).toBeLessThan(50);
    expect(endPixel.g).toBeLessThan(50);

    // Green channel should be roughly consistent (within tolerance)
    const tolerance = 30;
    expect(Math.abs(startPixel.g - midPixel.g)).toBeLessThan(tolerance);
    expect(Math.abs(midPixel.g - endPixel.g)).toBeLessThan(tolerance);
  });
});
