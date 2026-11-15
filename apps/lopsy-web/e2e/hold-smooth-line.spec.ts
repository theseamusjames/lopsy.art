import { test, expect, type Page } from './fixtures';
import { setToolOption, setForegroundColor, setBrushModalOption, closeBrushModal } from './helpers';

// ---------------------------------------------------------------------------
// Helpers (same pattern as other e2e tests)
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

type Snap = { width: number; height: number; pixels: number[] };

async function readComposited(page: Page): Promise<Snap> {
  const result = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__readCompositedPixels!() as
      Promise<Snap | null>;
  });
  return result ?? { width: 0, height: 0, pixels: [] };
}

/**
 * Read the composited pixel at the given document coordinate.
 * Handles the screen-space transform and WebGL Y-flip.
 */
async function readPixelAtDoc(page: Page, docX: number, docY: number) {
  return page.evaluate(async ({ docX, docY }) => {
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
    const container = document.querySelector('[data-testid="canvas-container"]');
    if (!container) return { r: 0, g: 0, b: 0, a: 0 };
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const sx = Math.round(
      (docX - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + cx,
    );
    const canvas = container.querySelector('canvas');
    const sy = (canvas?.height ?? 0) - 1 - Math.round(
      (docY - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + cy,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const idx = (sy * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { docX, docY });
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

test.describe('Hold to smooth line (#94)', () => {
  test('wobbling horizontal stroke smooths into a straight line after 1.5s hold', async ({ page }) => {
    // Create a transparent document so we can check pixels precisely
    await createDocument(page, 200, 100, true);

    // Select brush tool, set up a small black brush
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 8);
    await setToolOption(page, 'Opacity', 100);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 0);
    await setBrushModalOption(page, 'Scatter', 0);
    await closeBrushModal(page);
    await setToolOption(page, 'Fade', 0);
    // Set foreground color to black
    await setForegroundColor(page, 0, 0, 0);

    // Draw a wobbly horizontal line from left to right across the middle.
    // Use document coordinates for precise wobble: draw at y=50 ± 12px
    const startDoc = { x: 30, y: 50 };
    const endDoc = { x: 170, y: 50 };

    const waypoints: Array<{ x: number; y: number }> = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wobble = Math.sin(t * Math.PI * 6) * 12; // sinusoidal wobble, ±12px
      waypoints.push({
        x: startDoc.x + (endDoc.x - startDoc.x) * t,
        y: startDoc.y + wobble,
      });
    }

    // Convert first waypoint to screen and start drawing
    const sp = await docToScreen(page, waypoints[0]!.x, waypoints[0]!.y);
    await page.mouse.move(sp.x, sp.y);
    await page.mouse.down();

    // Move through all waypoints using steps:5 so each segment generates
    // multiple intermediate mousemove events — "real UI motion" that ensures
    // the React onMouseMove handler fires frequently and strokePoints is
    // populated with enough samples for a meaningful smooth.
    for (let i = 1; i < waypoints.length; i++) {
      const wp = await docToScreen(page, waypoints[i]!.x, waypoints[i]!.y);
      await page.mouse.move(wp.x, wp.y, { steps: 5 });
    }

    // End at the final point — keep the mouse held DOWN
    const ep = await docToScreen(page, endDoc.x, endDoc.y);
    await page.mouse.move(ep.x, ep.y, { steps: 3 });

    // Read composited pixels BEFORE smoothing
    // The wobbly stroke should paint dark pixels above and below y=50
    await page.waitForTimeout(500);

    // Sample pixels along the wobble peaks — these should be dark (painted)
    // The wobble goes ±12px from y=50, so check at y=38 and y=62
    let wobblePixelsFound = 0;
    for (const y of [38, 42, 58, 62]) {
      for (const x of [60, 100, 140]) {
        const p = await readPixelAtDoc(page, x, y);
        if (p.a > 0 && p.r < 128) wobblePixelsFound++;
      }
    }
    // At least some wobble positions should have paint
    expect(wobblePixelsFound).toBeGreaterThan(0);

    // Hold the cursor still (mouse still held down) for 1.5s + render buffer
    await page.waitForTimeout(2500);

    // Take a screenshot for visual inspection
    await page.screenshot({ path: 'test-results/screenshots/hold-smooth-after.png' });

    // Read composited pixels AFTER smoothing
    // The stroke should now be a straight line along y=50
    // Far-off-center positions should no longer have paint
    let offCenterAfter = 0;
    for (const y of [30, 35, 65, 70]) {
      for (const x of [60, 100, 140]) {
        const p = await readPixelAtDoc(page, x, y);
        if (p.a > 0 && p.r < 128) offCenterAfter++;
      }
    }

    // STRICT CHECK: after smoothing a wobbly stroke to straight,
    // off-center positions must have ZERO dark pixels (not just fewer)
    expect(offCenterAfter).toBe(0);

    // Verify the center line still has dark paint (not just non-transparent)
    const centerPx = await readPixelAtDoc(page, 100, 50);
    expect(centerPx.a).toBeGreaterThan(0);
    expect(centerPx.r).toBeLessThan(128);

    // Release the mouse after smoothing
    await page.mouse.up();
  });

  test('releasing mouse during hold cancels smoothing', async ({ page }) => {
    await createDocument(page, 200, 100, true);

    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 6);
    await setToolOption(page, 'Opacity', 100);
    await setToolOption(page, 'Hardness', 100);
    await setBrushModalOption(page, 'Spacing', 0);
    await setBrushModalOption(page, 'Scatter', 0);
    await closeBrushModal(page);
    await setToolOption(page, 'Fade', 0);
    await setForegroundColor(page, 0, 0, 0);

    // Draw a wobbly stroke using steps for realistic motion
    const start = await docToScreen(page, 20, 50);
    const end = await docToScreen(page, 180, 50);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      const wobble = (i % 2 === 0) ? 8 : -8;
      await page.mouse.move(
        start.x + (end.x - start.x) * t,
        start.y + (end.y - start.y) * t + wobble,
        { steps: 3 },
      );
    }
    await page.mouse.move(end.x, end.y, { steps: 3 });

    await page.waitForTimeout(300);

    // Sample a wobble peak position to confirm the stroke exists
    const peakBefore = await readPixelAtDoc(page, 100, 42);
    expect(peakBefore.a).toBeGreaterThan(0);

    // Release the mouse before the 2s hold — this cancels the timer
    await page.mouse.up();

    // Wait past the timer duration
    await page.waitForTimeout(2000);

    // The wobble peak should still have paint (smoothing was cancelled by mouseup)
    const peakAfter = await readPixelAtDoc(page, 100, 42);
    expect(peakAfter.a).toBeGreaterThan(0);
  });
});
