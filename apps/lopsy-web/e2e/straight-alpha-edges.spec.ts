/**
 * #815 — Anti-aliased edges written by the Shape tool and by rotating a
 * selection with the transform handles must be stored as straight alpha,
 * like every other layer-texture producer. Both paths used to write
 * premultiplied RGB into partially covered pixels (the shape via
 * `ONE, ONE_MINUS_SRC_ALPHA` hardware blending, the transform via
 * bilinear filtering of straight alpha against transparent black), which
 * blend.glsl then treated as straight — a dark ring around every edge.
 *
 * The probes read the GPU layer texture directly: at partial alpha, a
 * straight-alpha teal pixel still has teal RGB. A premultiplied one has
 * RGB scaled down by its alpha (e.g. a≈128 → 20,84,79).
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setForegroundColor,
  docToScreen,
  addLayer,
} from './helpers';

const TEAL = { r: 0x2b, g: 0xb3, b: 0xa8 };
// Straight alpha decoded from an 8-bit/FP16 readback of an edge pixel is
// quantised by the alpha itself, so allow a few levels of slack.
const RGB_TOLERANCE = 8;

interface PixelSnap {
  width: number;
  height: number;
  pixels: number[];
}

async function readLayer(page: Page, layerId: string): Promise<PixelSnap> {
  const result = await page.evaluate((lid) => {
    const fn = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id?: string,
    ) => Promise<PixelSnap | null>;
    return fn(lid);
  }, layerId);
  return result ?? { width: 0, height: 0, pixels: [] };
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

interface EdgeStats {
  edgeCount: number;
  worstDelta: number;
  worstPixel: [number, number, number, number] | null;
}

/** Compare the RGB of every partially transparent pixel against `color`. */
function edgeStats(snap: PixelSnap, color: { r: number; g: number; b: number }): EdgeStats {
  let edgeCount = 0;
  let worstDelta = 0;
  let worstPixel: [number, number, number, number] | null = null;
  for (let i = 0; i < snap.pixels.length; i += 4) {
    const a = snap.pixels[i + 3]!;
    // Skip near-transparent pixels: their RGB is quantised too coarsely
    // (and irrelevant visually) to compare against the fill colour.
    if (a < 24 || a > 235) continue;
    edgeCount++;
    const r = snap.pixels[i]!;
    const g = snap.pixels[i + 1]!;
    const b = snap.pixels[i + 2]!;
    const delta = Math.max(Math.abs(r - color.r), Math.abs(g - color.g), Math.abs(b - color.b));
    if (delta > worstDelta) {
      worstDelta = delta;
      worstPixel = [r, g, b, a];
    }
  }
  return { edgeCount, worstDelta, worstPixel };
}

async function setShapeMode(page: Page, mode: 'ellipse' | 'polygon'): Promise<void> {
  await page.locator('[aria-labelledby="shape-mode-label"]').selectOption(mode);
}

/** Shape-tool drag: the drag starts at the shape centre, the pointer sets the radius. */
async function dragShape(page: Page, cx: number, cy: number, ex: number, ey: number): Promise<void> {
  const start = await docToScreen(page, cx, cy);
  const end = await docToScreen(page, ex, ey);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function drawTealSquare(page: Page): Promise<string> {
  await setForegroundColor(page, TEAL.r, TEAL.g, TEAL.b);
  await selectTool(page, 'shape');
  await setShapeMode(page, 'polygon');
  await page.locator('#polygon-sides').fill('4');
  // 240×240 square centred on (300, 200).
  await dragShape(page, 300, 200, 420, 320);
  return activeLayerId(page);
}

/** Drag the rotate handle of the active transform by `angle` radians. */
async function dragRotate(page: Page, angle: number): Promise<void> {
  const info = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: Record<string, unknown> | null };
    };
    const t = ui.getState().transform;
    if (!t) return null;
    const ob = t.originalBounds as { x: number; y: number; width: number; height: number };
    const cx = ob.x + ob.width / 2 + (t.translateX as number);
    const cy = ob.y + ob.height / 2 + (t.translateY as number);
    const hw = (ob.width * Math.abs(t.scaleX as number)) / 2;
    const hh = (ob.height * Math.abs(t.scaleY as number)) / 2;
    const rotOff = 20;
    return { cx, cy, hx: cx + hw + rotOff, hy: cy - hh - rotOff };
  });
  if (!info) throw new Error('No transform handles after marquee selection');

  const radius = Math.hypot(info.hx - info.cx, info.hy - info.cy);
  const startAngle = Math.atan2(info.hy - info.cy, info.hx - info.cx);
  const handle = await docToScreen(page, info.hx, info.hy);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (angle * i) / steps;
    const p = await docToScreen(page, info.cx + radius * Math.cos(a), info.cy + radius * Math.sin(a));
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('#815 — straight-alpha anti-aliased edges', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'shape options bar and layer panel need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForTimeout(200);
  });

  test('shape edges keep the fill colour — a same-colour circle over a square is invisible', async ({ page }) => {
    const squareId = await drawTealSquare(page);

    await addLayer(page);
    await setShapeMode(page, 'ellipse');
    // r=30 circle centred on (380, 280), entirely inside the square.
    await dragShape(page, 380, 280, 410, 310);
    const circleId = await activeLayerId(page);
    expect(circleId).not.toBe(squareId);

    await page.screenshot({ path: 'e2e/screenshots/straight-alpha-shape-edges.png' });

    const circle = edgeStats(await readLayer(page, circleId), TEAL);
    // A 60px circle has a full ring of anti-aliased pixels.
    expect(circle.edgeCount).toBeGreaterThan(60);
    expect(circle.worstDelta, `worst edge pixel ${JSON.stringify(circle.worstPixel)}`)
      .toBeLessThanOrEqual(RGB_TOLERANCE);

    const square = edgeStats(await readLayer(page, squareId), TEAL);
    expect(square.worstDelta, `worst edge pixel ${JSON.stringify(square.worstPixel)}`)
      .toBeLessThanOrEqual(RGB_TOLERANCE);

    // The composite across the circle's rim is flat teal — no dark ring.
    const composite = await page.evaluate(async () => {
      const fn = (window as unknown as Record<string, unknown>).__readCompositedPixels as () => Promise<PixelSnap | null>;
      return fn();
    });
    expect(composite).not.toBeNull();
    const vp = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number; panX: number; panY: number } };
      };
      return store.getState().viewport;
    });
    let darkest = 255;
    for (let deg = 0; deg < 360; deg += 5) {
      for (const r of [29, 29.5, 30, 30.5]) {
        const docX = 380 + r * Math.cos((deg * Math.PI) / 180);
        const docY = 280 + r * Math.sin((deg * Math.PI) / 180);
        const sx = Math.round((docX - 300) * vp.zoom + vp.panX + composite!.width / 2);
        const sy = Math.round((docY - 200) * vp.zoom + vp.panY + composite!.height / 2);
        const idx = ((composite!.height - 1 - sy) * composite!.width + sx) * 4;
        darkest = Math.min(darkest, composite!.pixels[idx + 1]!);
      }
    }
    // Teal's green channel is 179; the old ring dropped it to ~150.
    expect(darkest).toBeGreaterThanOrEqual(TEAL.g - RGB_TOLERANCE);
  });

  test('rotating a selection resamples edges in premultiplied space', async ({ page }) => {
    const squareId = await drawTealSquare(page);

    // Marquee around the square, rotate 30° with the handle, commit.
    await selectTool(page, 'marquee-rect');
    const a = await docToScreen(page, 170, 70);
    const b = await docToScreen(page, 430, 330);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const before = await readLayer(page, squareId);
    const opaqueBefore = before.pixels.filter((v, i) => i % 4 === 3 && v > 10).length;

    // With a selection tool active the handles transform only the marquee;
    // the Move tool's handles transform the selected pixels.
    await selectTool(page, 'move');
    await dragRotate(page, Math.PI / 6);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/straight-alpha-rotated-edges.png' });

    const after = await readLayer(page, squareId);
    const opaqueAfter = after.pixels.filter((v, i) => i % 4 === 3 && v > 10).length;
    expect(opaqueAfter).toBeGreaterThan(opaqueBefore * 0.5);
    expect(opaqueAfter).toBeLessThan(opaqueBefore * 3);

    const stats = edgeStats(after, TEAL);
    // Four rotated 240px edges are anti-aliased along their whole length.
    expect(stats.edgeCount).toBeGreaterThan(400);
    expect(stats.worstDelta, `worst edge pixel ${JSON.stringify(stats.worstPixel)}`)
      .toBeLessThanOrEqual(RGB_TOLERANCE);
  });
});
