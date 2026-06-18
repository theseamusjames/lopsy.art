import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import { waitForStore, createDocument } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OverlaySample {
  width: number;
  height: number;
  pixels: number[];
  panX: number;
  panY: number;
  zoom: number;
  docW: number;
  docH: number;
}

async function readOverlayCanvas(page: Page): Promise<OverlaySample> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
    const overlay = all.find((c) => /overlayCanvas/.test(c.className));
    if (!overlay) throw new Error('overlay canvas not found');
    const ctx = overlay.getContext('2d');
    if (!ctx) throw new Error('overlay 2d context not available');
    const img = ctx.getImageData(0, 0, overlay.width, overlay.height);
    const ed = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        viewport: { panX: number; panY: number; zoom: number };
        document: { width: number; height: number };
      };
    };
    const state = ed.getState();
    return {
      width: overlay.width,
      height: overlay.height,
      pixels: Array.from(img.data),
      panX: state.viewport.panX,
      panY: state.viewport.panY,
      zoom: state.viewport.zoom,
      docW: state.document.width,
      docH: state.document.height,
    };
  });
}

function alphaAt(s: OverlaySample, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= s.width || yi < 0 || yi >= s.height) return 0;
  return s.pixels[(yi * s.width + xi) * 4 + 3] ?? 0;
}

function hasMarkNear(s: OverlaySample, x: number, y: number, threshold = 20, radius = 2): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (alphaAt(s, x + dx, y + dy) > threshold) return true;
    }
  }
  return false;
}

/** Returns screen X for a doc-space x boundary line (at integer doc x) */
function docBoundaryToScreenX(s: OverlaySample, docX: number): number {
  const originX = s.panX + s.width / 2 - (s.docW / 2) * s.zoom;
  return originX + docX * s.zoom;
}

/** Returns screen Y for a doc-space y boundary line (at integer doc y) */
function docBoundaryToScreenY(s: OverlaySample, docY: number): number {
  const originY = s.panY + s.height / 2 - (s.docH / 2) * s.zoom;
  return originY + docY * s.zoom;
}

async function setZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { setZoom: (z: number) => void };
    };
    store.getState().setZoom(z);
  }, zoom);
  await page.waitForTimeout(200);
}

async function ensurePixelGridEnabled(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { showPixelGrid: boolean; togglePixelGrid: () => void };
    };
    if (!ui.getState().showPixelGrid) ui.getState().togglePixelGrid();
  });
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Pixel grid at high zoom', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'requires sidebar panels, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    // Small document — at 1000% zoom each pixel is 10 screen pixels wide
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(200);
  });

  test('pixel grid lines are visible at 1000% zoom', async ({ page }) => {
    await ensurePixelGridEnabled(page);
    // Set zoom to 10x (1000%)
    await setZoom(page, 10);

    const sample = await readOverlayCanvas(page);
    expect(sample.zoom).toBeCloseTo(10, 1);

    // At 1000% zoom every pixel boundary is 10 screen pixels apart.
    // Pick a scan row that sits in the middle of a document pixel (midway
    // between two horizontal pixel-grid lines) — this row should NOT show
    // a horizontal pixel-grid line, but it SHOULD have vertical lines at
    // every integer doc-x boundary that falls on-screen.
    //
    // Doc pixel at docY=50: its boundary lines are at docY=50 (top edge) and
    // docY=51 (bottom edge). The scan row sits at y=50.5 (midpoint).
    const midDocY = 50.5;
    const scanScreenY = docBoundaryToScreenY(sample, midDocY);

    // Verify vertical pixel-grid lines are present at doc-x boundaries
    // for a range of x values within the visible area.
    // We check a few integer doc-x boundaries that should be on-screen.
    let foundCount = 0;
    for (const docX of [40, 45, 50, 55, 60]) {
      const screenX = docBoundaryToScreenX(sample, docX);
      if (screenX >= 0 && screenX < sample.width) {
        if (hasMarkNear(sample, screenX, scanScreenY)) {
          foundCount++;
        }
      }
    }
    // At least 3 of the 5 probed boundaries must have a visible line
    expect(foundCount).toBeGreaterThanOrEqual(3);

    // Similarly verify horizontal lines along a vertical scan column
    const midDocX = 50.5;
    const scanScreenX = docBoundaryToScreenX(sample, midDocX);
    let hFoundCount = 0;
    for (const docY of [40, 45, 50, 55, 60]) {
      const screenY = docBoundaryToScreenY(sample, docY);
      if (screenY >= 0 && screenY < sample.height) {
        if (hasMarkNear(sample, scanScreenX, screenY)) {
          hFoundCount++;
        }
      }
    }
    expect(hFoundCount).toBeGreaterThanOrEqual(3);

    await page.screenshot({ path: 'e2e/screenshots/pixel-grid-visible.png' });
  });

  test('pixel grid is NOT visible at 400% zoom', async ({ page }) => {
    await ensurePixelGridEnabled(page);
    await setZoom(page, 4);

    const sample = await readOverlayCanvas(page);
    expect(sample.zoom).toBeCloseTo(4, 1);

    // At 400% zoom, no pixel-grid lines should appear.
    // Sample many candidate boundary positions — none should have marks.
    let foundCount = 0;
    const midDocY = 50.5;
    const scanScreenY = docBoundaryToScreenY(sample, midDocY);

    for (const docX of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
      const screenX = docBoundaryToScreenX(sample, docX);
      if (screenX >= 0 && screenX < sample.width) {
        if (hasMarkNear(sample, screenX, scanScreenY)) {
          foundCount++;
        }
      }
    }
    expect(foundCount).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/pixel-grid-hidden.png' });
  });

  test('pixel grid can be toggled off via showPixelGrid flag', async ({ page }) => {
    // Make sure pixel grid is on and zoom is high enough
    await ensurePixelGridEnabled(page);
    await setZoom(page, 10);

    // Verify it is visible first
    const sampleOn = await readOverlayCanvas(page);
    const midDocY = 50.5;
    const scanScreenY = docBoundaryToScreenY(sampleOn, midDocY);
    let onCount = 0;
    for (const docX of [45, 50, 55]) {
      const screenX = docBoundaryToScreenX(sampleOn, docX);
      if (screenX >= 0 && screenX < sampleOn.width) {
        if (hasMarkNear(sampleOn, screenX, scanScreenY)) onCount++;
      }
    }
    expect(onCount).toBeGreaterThanOrEqual(2);

    // Now disable the pixel grid
    await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { togglePixelGrid: () => void };
      };
      ui.getState().togglePixelGrid();
    });
    await page.waitForTimeout(200);

    // Sample again — pixel-grid lines should be absent
    const sampleOff = await readOverlayCanvas(page);
    let offCount = 0;
    const scanScreenYOff = docBoundaryToScreenY(sampleOff, midDocY);
    for (const docX of [45, 50, 55]) {
      const screenX = docBoundaryToScreenX(sampleOff, docX);
      if (screenX >= 0 && screenX < sampleOff.width) {
        if (hasMarkNear(sampleOff, screenX, scanScreenYOff)) offCount++;
      }
    }
    expect(offCount).toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/pixel-grid-toggled-off.png' });
  });
});
