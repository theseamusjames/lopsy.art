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
  docToOverlayX: (dx: number) => number;
  docToOverlayY: (dy: number) => number;
  zoom: number;
}

async function readOverlayCanvas(page: Page): Promise<OverlaySample> {
  const data = await page.evaluate(() => {
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
  const cx = data.panX + data.width / 2;
  const cy = data.panY + data.height / 2;
  return {
    width: data.width,
    height: data.height,
    pixels: data.pixels,
    zoom: data.zoom,
    docToOverlayX: (dx: number) => (dx - data.docW / 2) * data.zoom + cx,
    docToOverlayY: (dy: number) => (dy - data.docH / 2) * data.zoom + cy,
  };
}

function rgbaAt(
  s: OverlaySample,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= s.width || yi < 0 || yi >= s.height) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const idx = (yi * s.width + xi) * 4;
  return {
    r: s.pixels[idx] ?? 0,
    g: s.pixels[idx + 1] ?? 0,
    b: s.pixels[idx + 2] ?? 0,
    a: s.pixels[idx + 3] ?? 0,
  };
}

/**
 * Returns true if any pixel in a neighborhood has the expected blue-ish
 * artboard border color (high blue channel, moderate alpha).
 */
function hasArtboardBorderNear(
  s: OverlaySample,
  x: number,
  y: number,
  radius = 3,
): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = rgbaAt(s, x + dx, y + dy);
      // Artboard border is rendered as rgba(100, 160, 255, 0.9):
      // blue channel is dominant, alpha is high.
      if (px.a > 100 && px.b > px.r + 50) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Artboards panel and overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    // Use a 400×300 document so artboard coordinates are predictable.
    await createDocument(page, 400, 300, false);
    await page.waitForTimeout(200);
  });

  test('artboard appears in panel after clicking New Artboard', async ({ page }) => {
    // Open the Artboards panel via the toolbar icon.
    await page.locator('button[aria-label="Artboards"]').click();
    await page.waitForTimeout(100);

    // The panel should now be visible with the empty state message.
    await expect(page.locator('text=No artboards')).toBeVisible();

    // Click the "New Artboard" button.
    await page.locator('button[aria-label="New Artboard"]').click();
    await page.waitForTimeout(100);

    // Verify the artboard row appears in the panel.
    const artboardRow = page.locator('[data-artboard-id]');
    await expect(artboardRow).toHaveCount(1);

    // Verify the artboard name is shown.
    await expect(artboardRow.locator('span').first()).toContainText('Artboard 1');

    // Verify the artboard dimensions match the document size.
    await expect(artboardRow.locator('span').last()).toContainText('400×300');

    await page.screenshot({ path: 'e2e/screenshots/artboards-panel.png' });
  });

  test('artboard border is rendered on the overlay canvas', async ({ page }) => {
    // Open the Artboards panel and add an artboard.
    await page.locator('button[aria-label="Artboards"]').click();
    await page.waitForTimeout(100);
    await page.locator('button[aria-label="New Artboard"]').click();
    await page.waitForTimeout(300);

    // The default artboard covers the full document (0, 0, 400, 300).
    // Read the overlay canvas and verify the artboard border is rendered.
    const sample = await readOverlayCanvas(page);
    expect(sample.width).toBeGreaterThan(0);

    // Probe the top edge of the artboard (doc y=0) at doc x = 200 (mid-width).
    // At doc x=0 and doc x=400 we'd be at the corner — mid-edge is safer.
    const midTopX = sample.docToOverlayX(200);
    const topY = sample.docToOverlayY(0);
    expect(hasArtboardBorderNear(sample, midTopX, topY)).toBe(true);

    // Probe the left edge of the artboard (doc x=0) at doc y = 150 (mid-height).
    const leftX = sample.docToOverlayX(0);
    const midLeftY = sample.docToOverlayY(150);
    expect(hasArtboardBorderNear(sample, leftX, midLeftY)).toBe(true);

    // Probe a point clearly inside the artboard — there should be no
    // artboard border line in the interior.
    const interiorX = sample.docToOverlayX(200);
    const interiorY = sample.docToOverlayY(150);
    expect(hasArtboardBorderNear(sample, interiorX, interiorY, 1)).toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/artboards-overlay.png' });
  });

  test('artboard is removed from panel when delete button is clicked', async ({ page }) => {
    // Open panel and add an artboard.
    await page.locator('button[aria-label="Artboards"]').click();
    await page.waitForTimeout(100);
    await page.locator('button[aria-label="New Artboard"]').click();
    await page.waitForTimeout(100);

    // Verify it's there.
    await expect(page.locator('[data-artboard-id]')).toHaveCount(1);

    // Read the artboard id from the DOM.
    const artboardId = await page.locator('[data-artboard-id]').getAttribute('data-artboard-id');
    expect(artboardId).toBeTruthy();

    // Click the remove button.
    await page.locator(`[data-artboard-id="${artboardId}"] button[aria-label^="Remove artboard"]`).click();
    await page.waitForTimeout(100);

    // The panel should show "No artboards" again.
    await expect(page.locator('[data-artboard-id]')).toHaveCount(0);
    await expect(page.locator('text=No artboards')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/artboards-removed.png' });
  });

  test('artboard border disappears from overlay after deletion', async ({ page }) => {
    // Open panel and add an artboard.
    await page.locator('button[aria-label="Artboards"]').click();
    await page.waitForTimeout(100);
    await page.locator('button[aria-label="New Artboard"]').click();
    await page.waitForTimeout(300);

    // Confirm border is present.
    const before = await readOverlayCanvas(page);
    const midTopX = before.docToOverlayX(200);
    const topY = before.docToOverlayY(0);
    expect(hasArtboardBorderNear(before, midTopX, topY)).toBe(true);

    // Delete the artboard.
    const artboardId = await page.locator('[data-artboard-id]').getAttribute('data-artboard-id');
    await page.locator(`[data-artboard-id="${artboardId}"] button[aria-label^="Remove artboard"]`).click();
    await page.waitForTimeout(300);

    // Verify the border is gone from the overlay.
    const after = await readOverlayCanvas(page);
    const midTopX2 = after.docToOverlayX(200);
    const topY2 = after.docToOverlayY(0);
    expect(hasArtboardBorderNear(after, midTopX2, topY2)).toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/artboards-border-removed.png' });
  });
});
