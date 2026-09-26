import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getPixelAt,
  setForegroundColor,
  drawEllipse,
  applyFilter,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

/**
 * Regression coverage for #919: the blur filters (Gaussian, Box, Motion,
 * Radial) sampled the layer's straight-alpha texture and wrote back a
 * straight average of the RGB — which is a premultiplied result, not a
 * straight-alpha one, wherever alpha varies across the sampled taps. A
 * transparent tap's near-black RGB gets mixed straight into an opaque red
 * tap's RGB, dragging R down instead of leaving it untouched. blend.glsl
 * then composites that premultiplied-looking texture as straight alpha,
 * producing a dark grey halo on any blurred, partially-transparent edge
 * (the #815/#856 dark-fringe bug, on a path #856 didn't cover).
 *
 * A pure-red fill has only one non-transparent color, so a *correct*
 * straight-alpha blur must leave R at 255 for every pixel that has any
 * alpha at all — only alpha (and G/B, which start at 0 either side) can
 * change across the fade. If R dips well below 255 inside the
 * semi-transparent band, the filter is writing premultiplied data.
 */

const DOC_WIDTH = 400;
const DOC_HEIGHT = 300;
const CENTER_X = 200;
const CENTER_Y = 150;
const RADIUS_X = 40;
const RADIUS_Y = 40;
// R stays essentially exact (255) at moderate-to-high alpha, but at the
// very tail of the fade (alpha under ~20/255) 8-bit texture quantization on
// the premultiplied-then-divided value adds a few units of rounding noise
// even for a *correct* un-premultiply. Excluding that tail (MIN_ALPHA) keeps
// the assertion tight without being sensitive to that unrelated noise.
const MIN_ALPHA = 24;
const MAX_ALPHA = 240;
const MIN_R_IN_FADE = 245;
const MIN_SEMI_TRANSPARENT_SAMPLES = 5;

interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Creates a 400x300 white-background document with a red ellipse painted
 * (via the shape tool, like a user would) on the transparent draw layer
 * above it, and returns the draw layer's id plus its actual bounds — the
 * shape tool's drag-to-ellipse mapping isn't corner-to-corner, so the
 * resulting bounds are read back rather than assumed from (cx, cy, rx, ry). */
async function setupRedEllipseOnWhite(page: Page): Promise<{ layerId: string; bounds: LayerBounds }> {
  await createDocument(page, DOC_WIDTH, DOC_HEIGHT, false);
  const layerId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
  await setForegroundColor(page, 255, 0, 0);
  await drawEllipse(page, CENTER_X, CENTER_Y, RADIUS_X, RADIUS_Y, { r: 255, g: 0, b: 0 });
  const bounds = await page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id);
    return layer ? { x: layer.x, y: layer.y, width: layer.width, height: layer.height } : null;
  }, layerId);
  if (!bounds) throw new Error('ellipse layer not found after drawEllipse');
  return { layerId, bounds };
}

interface ScanSample {
  x: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Scans a horizontal row through the vertical center of the ellipse's
 * bounds, centered on its left edge, wide enough to catch the blurred
 * fade on both sides for every filter/param combination below. */
async function scanLeftEdge(page: Page, layerId: string, bounds: LayerBounds): Promise<ScanSample[]> {
  const scanY = bounds.y + Math.floor(bounds.height / 2);
  const edgeX = bounds.x;
  const startX = Math.max(0, edgeX - 60);
  const endX = Math.min(DOC_WIDTH - 1, edgeX + 60);
  const samples: ScanSample[] = [];
  for (let x = startX; x <= endX; x++) {
    const px = await getPixelAt(page, x, scanY, layerId);
    samples.push({ x, ...px });
  }
  return samples;
}

function assertNoHalo(samples: ScanSample[], screenshotName: string): void {
  const semiTransparent = samples.filter((s) => s.a > MIN_ALPHA && s.a < MAX_ALPHA);
  // If this is empty the filter didn't blur anything and the test would
  // pass vacuously — the radii/distances below are chosen to avoid that.
  expect(semiTransparent.length).toBeGreaterThanOrEqual(MIN_SEMI_TRANSPARENT_SAMPLES);
  for (const s of semiTransparent) {
    expect(
      s.r,
      `pixel at x=${s.x} (rgba=${s.r},${s.g},${s.b},${s.a}) — grey halo, see ` +
        `e2e/screenshots/${screenshotName}`,
    ).toBeGreaterThanOrEqual(MIN_R_IN_FADE);
  }
}

test.describe('Blur filters do not leave a premultiplied dark halo (#919)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('Gaussian Blur keeps R near 255 across the fade', async ({ page }) => {
    const { layerId, bounds } = await setupRedEllipseOnWhite(page);
    await applyFilter(page, 'Gaussian Blur...', { Radius: 30 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'blur-halo-gaussian.png') });
    const samples = await scanLeftEdge(page, layerId, bounds);
    assertNoHalo(samples, 'blur-halo-gaussian.png');
  });

  test('Box Blur keeps R near 255 across the fade', async ({ page }) => {
    const { layerId, bounds } = await setupRedEllipseOnWhite(page);
    await applyFilter(page, 'Box Blur...', { Radius: 30 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'blur-halo-box.png') });
    const samples = await scanLeftEdge(page, layerId, bounds);
    assertNoHalo(samples, 'blur-halo-box.png');
  });

  test('Motion Blur keeps R near 255 across the fade', async ({ page }) => {
    const { layerId, bounds } = await setupRedEllipseOnWhite(page);
    // Angle 0 blurs along the horizontal axis, matching the scan row.
    await applyFilter(page, 'Motion Blur...', { Angle: 0, Distance: 60 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'blur-halo-motion.png') });
    const samples = await scanLeftEdge(page, layerId, bounds);
    assertNoHalo(samples, 'blur-halo-motion.png');
  });

  test('Radial Blur keeps R near 255 across the fade', async ({ page }) => {
    const { layerId, bounds } = await setupRedEllipseOnWhite(page);
    // Radial blur's center is fixed at the document center, which does not
    // coincide with the ellipse's center, so its fade is narrower and only
    // on the side facing the document center — a generous Amount keeps the
    // fade band wide enough to sample reliably.
    await applyFilter(page, 'Radial Blur...', { Amount: 100 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'blur-halo-radial.png') });
    const samples = await scanLeftEdge(page, layerId, bounds);
    assertNoHalo(samples, 'blur-halo-radial.png');
  });
});
