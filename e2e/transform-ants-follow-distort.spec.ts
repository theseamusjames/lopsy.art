/**
 * The marching ants follow a pending Move-tool transform. They used to be
 * drawn through a Canvas 2D translate / rotate / scale only, so in Skew,
 * Distort and Perspective modes they stayed on the original outline while
 * the blue handle box (and the pixels) showed the new shape.
 *
 * The selection is an ellipse, so its ants never sit under the blue handle
 * box. Each probe finds the edge of the black piece in the composite and
 * checks the 2D overlay there: the ants are black and white dashes, the box
 * is #00aaff, so opaque neutral pixels near a point mean the ants pass there.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  addLayer,
  setForegroundColor,
  docToScreen,
} from './helpers';

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 12): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Number of opaque black/white (ant) pixels in a 5×5 box around a doc point. */
async function antPixelsNear(page: Page, docX: number, docY: number): Promise<number> {
  const s = await docToScreen(page, docX, docY);
  return page.evaluate(({ x, y }) => {
    const c = Array.from(document.querySelectorAll('canvas')).find((el) => /overlayCanvas/.test(el.className)) as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const d = c.getContext('2d')!.getImageData(Math.round((x - r.left) * k) - 2, Math.round((y - r.top) * k) - 2, 5, 5).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const isOpaque = d[i + 3]! > 200;
      const isNeutral = Math.abs(d[i]! - d[i + 2]!) < 24 && Math.abs(d[i + 1]! - d[i + 2]!) < 24;
      if (isOpaque && isNeutral) n++;
    }
    return n;
  }, s);
}

/**
 * First dark composited pixel walking from `from` towards `to` along a
 * doc row (axis 'x') or column (axis 'y') — the edge of the black piece.
 */
async function firstDark(page: Page, axis: 'x' | 'y', fixed: number, from: number, to: number): Promise<number> {
  return page.evaluate(async ({ axis, fixed, from, to }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const p = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const step = to > from ? 1 : -1;
    for (let v = from; v !== to; v += step) {
      const x = axis === 'x' ? v : fixed;
      const y = axis === 'x' ? fixed : v;
      const sx = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + p.width / 2);
      const sy = Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + p.height / 2);
      const i = ((p.height - 1 - sy) * p.width + sx) * 4;
      if ((p.pixels[i] ?? 255) < 128) return v;
    }
    return Number.NaN;
  }, { axis, fixed, from, to });
}

/** Black ellipse filling (100..300, 100..200), still selected, Move tool active. */
async function selectedBlackEllipse(page: Page): Promise<void> {
  await createDocument(page, 400, 300, false);
  await page.waitForTimeout(300);
  await addLayer(page);
  await setForegroundColor(page, 0, 0, 0);
  await page.locator('[data-tool-id="marquee-ellipse"]').click();
  await drag(page, 100, 100, 300, 200);
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
}

async function transformMode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: { mode: string } | null };
    };
    return ui.getState().transform?.mode ?? null;
  });
}

test.describe('Marching ants follow the pending transform', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'transform handles need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('Distort: ants trace the distorted piece, not the old outline', async ({ page }) => {
    await selectedBlackEllipse(page);
    // Column x = 250: the ellipse's top edge, with the ants on it.
    const oldTop = await firstDark(page, 'y', 250, 0, 300);
    expect(oldTop).toBeGreaterThan(100);
    expect(await antPixelsNear(page, 250, oldTop)).toBeGreaterThan(0);

    await page.locator('button:has-text("Distort")').click();
    await page.waitForTimeout(150);
    // Top-right corner (300, 100) up to (300, 40).
    await drag(page, 300, 100, 300, 40);
    expect(await transformMode(page)).toBe('distort');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/transform-ants-follow-distort.png' });

    const newTop = await firstDark(page, 'y', 250, 0, 300);
    expect(oldTop - newTop).toBeGreaterThan(15);
    expect(await antPixelsNear(page, 250, newTop)).toBeGreaterThan(0);
    // The old edge is now inside the piece: no ants there.
    expect(await antPixelsNear(page, 250, oldTop)).toBe(0);
  });

  test('Skew: ants lean with the skewed piece', async ({ page }) => {
    await selectedBlackEllipse(page);
    // Row y = 125: the ellipse's left edge.
    const oldLeft = await firstDark(page, 'x', 125, 0, 400);
    expect(oldLeft).toBeGreaterThan(100);
    expect(await antPixelsNear(page, oldLeft, 125)).toBeGreaterThan(0);

    await page.locator('button:has-text("Skew")').click();
    await page.waitForTimeout(150);
    // Drag the top edge handle sideways: a horizontal skew.
    await drag(page, 200, 100, 230, 100);
    expect(await transformMode(page)).toBe('skew');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/transform-ants-follow-skew.png' });

    const newLeft = await firstDark(page, 'x', 125, 0, 400);
    expect(Math.abs(newLeft - oldLeft)).toBeGreaterThan(15);
    expect(await antPixelsNear(page, newLeft, 125)).toBeGreaterThan(0);
    expect(await antPixelsNear(page, oldLeft, 125)).toBe(0);
  });
});
