/**
 * #1177 — Halftone printed a soft dot (radius ≈ Softness) in every pure-white
 *         cell, because the smoothstep ramp straddled a zero dot radius.
 * #1171 — Voronoi used F2 − F1 as its "distance to the edge", which is not a
 *         distance: edges flared into soft dark wedges / bow-ties near cell
 *         corners instead of lines of uniform width.
 * #1167 — Pixelate point-sampled each block's centre, so partial blocks at
 *         the edge of the content vanished or grew (a 95×40 fill came out
 *         88×44), and a block's colour was whichever pixel sat at its centre.
 */
import { test, expect, type Page } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForStore,
  createDocument,
  getEditorState,
  setForegroundColor,
  docToScreen,
  applyFilter,
  getPixelAt,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

interface LayerRaster {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number[];
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): Promise<void> {
  await setForegroundColor(page, rgb[0], rgb[1], rgb[2]);
  await page.keyboard.press('m');
  await dragMarquee(page, x0, y0, x1, y1);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function activeLayerId(page: Page): Promise<string> {
  const state = await getEditorState(page);
  return state.document.activeLayerId;
}

async function readLayer(page: Page, layerId: string): Promise<LayerRaster> {
  return page.evaluate(async (lid) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === lid);
    const readFn = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const { width, height, pixels } = await readFn(lid);
    return { x: layer?.x ?? 0, y: layer?.y ?? 0, width, height, pixels: Array.from(pixels) };
  }, layerId);
}

function alphaAt(r: LayerRaster, i: number): number {
  return r.pixels[i * 4 + 3] ?? 0;
}

/** Number of pixels with alpha > 0, and their bounding box in doc space. */
function coverage(r: LayerRaster): {
  count: number;
  maxAlpha: number;
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
} {
  let count = 0;
  let maxAlpha = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const a = alphaAt(r, y * r.width + x);
      if (a === 0) continue;
      count++;
      maxAlpha = Math.max(maxAlpha, a);
      x0 = Math.min(x0, x + r.x);
      y0 = Math.min(y0, y + r.y);
      x1 = Math.max(x1, x + r.x + 1);
      y1 = Math.max(y1, y + r.y + 1);
    }
  }
  return { count, maxAlpha, bounds: count ? { x0, y0, x1, y1 } : null };
}

test.describe('Filter fixes #1167 #1171 #1177', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and marquee drags need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('#1177 Halftone leaves pure-white cells fully transparent', async ({ page }) => {
    await createDocument(page, 600, 400, true);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    await setForegroundColor(page, 255, 255, 255);
    await editFill(page);
    const filled = coverage(await readLayer(page, id));
    expect(filled.count).toBe(600 * 400);

    // Softness 1 left a dot of radius ~1 (alpha up to ~120) in every cell.
    await applyFilter(page, 'Halftone...', { 'Dot Size': 16, Softness: 1 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-white-softness-1.png') });
    const soft1 = coverage(await readLayer(page, id));
    expect(soft1.count, 'pixels with alpha > 0 after Softness 1').toBe(0);

    // Softness 4 covered ~18% of the layer with faint dots.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(coverage(await readLayer(page, id)).count).toBe(600 * 400);
    await applyFilter(page, 'Halftone...', { 'Dot Size': 16, Softness: 4 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-white-softness-4.png') });
    const soft4 = coverage(await readLayer(page, id));
    expect(soft4.count, 'pixels with alpha > 0 after Softness 4').toBe(0);
  });

  test('#1177 Halftone still prints full dots on black', async ({ page }) => {
    await createDocument(page, 320, 320, true);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    await setForegroundColor(page, 0, 0, 0);
    await editFill(page);

    // Angle 0 puts cell centres on the 16 px grid at (8 + 16i, 8 + 16j).
    await applyFilter(page, 'Halftone...', { 'Dot Size': 16, Angle: 0, Softness: 1 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'halftone-black-full-dots.png') });

    const r = await readLayer(page, id);
    let opaque = 0;
    for (let i = 0; i < r.width * r.height; i++) if (alphaAt(r, i) > 128) opaque++;
    // Black → dot radius = half the cell, so each dot is the inscribed
    // circle: π/4 ≈ 78.5% of the layer.
    const frac = opaque / (320 * 320);
    expect(frac).toBeGreaterThan(0.74);
    expect(frac).toBeLessThan(0.83);

    expect((await getPixelAt(page, 8, 8, id)).a).toBe(255);
    expect((await getPixelAt(page, 168, 104, id)).a).toBe(255);
    // Cell corners (between four dots) stay empty.
    expect((await getPixelAt(page, 16, 16, id)).a).toBe(0);
  });

  test('#1171 Voronoi draws uniform edge lines and flat cell interiors', async ({ page }) => {
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    await setForegroundColor(page, 0xe8, 0x64, 0x1e);
    await editFill(page);

    await applyFilter(page, 'Voronoi...', { Cells: 12, 'Edge Width': 5, Seed: 13 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'voronoi-uniform-edges.png') });

    const r = await readLayer(page, id);
    const { width: w, height: h } = r;
    const n = w * h;
    // flatSum is an integral image of "pixel is untouched orange".
    const flatSum = new Int32Array((w + 1) * (h + 1));
    let flat = 0;
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const isFlat =
          Math.abs((r.pixels[i] ?? 0) - 0xe8) <= 2 &&
          Math.abs((r.pixels[i + 1] ?? 0) - 0x64) <= 2 &&
          Math.abs((r.pixels[i + 2] ?? 0) - 0x1e) <= 2;
        if (isFlat) flat++;
        rowSum += isFlat ? 1 : 0;
        flatSum[(y + 1) * (w + 1) + x + 1] = (flatSum[y * (w + 1) + x + 1] ?? 0) + rowSum;
      }
    }
    // A 5 px line keeps every pixel within ~3 px of a flat cell interior.
    // The F2 − F1 wedges are solid dark/tinted regions 10+ px across, so
    // they contain pixels with no flat pixel anywhere in a 9×9 window.
    const R = 4;
    let deep = 0;
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const x0 = x - R;
        const y0 = y - R;
        const x1 = x + R + 1;
        const y1 = y + R + 1;
        const inBox =
          (flatSum[y1 * (w + 1) + x1] ?? 0) - (flatSum[y0 * (w + 1) + x1] ?? 0) -
          (flatSum[y1 * (w + 1) + x0] ?? 0) + (flatSum[y0 * (w + 1) + x0] ?? 0);
        if (inBox === 0) deep++;
      }
    }
    expect(flat / n).toBeGreaterThan(0.75);
    expect(deep, 'tinted pixels more than 4 px from any flat cell interior').toBe(0);
  });

  test('#1167 Pixelate keeps a partial-block fill at its exact footprint', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    await fillRect(page, 0, 0, 95, 40, [255, 0, 0]);
    const before = coverage(await readLayer(page, id));
    expect(before.bounds).toEqual({ x0: 0, y0: 0, x1: 95, y1: 40 });
    expect(before.count).toBe(95 * 40);

    await applyFilter(page, 'Pixelate...', { 'Block Size': 22 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixelate-partial-blocks.png') });

    const after = coverage(await readLayer(page, id));
    // Point sampling gave 88×44: the 88..94 columns vanished (their block
    // centre x = 99 is outside the fill) and rows 40..43 appeared.
    expect(after.bounds).toEqual({ x0: 0, y0: 0, x1: 95, y1: 40 });
    expect(after.count).toBe(95 * 40);
    // The partial blocks keep the fill's colour at full strength: the
    // transparent part of the block does not darken or fade it.
    for (const [x, y] of [[94, 39], [90, 5], [5, 39], [50, 20]] as const) {
      const p = await getPixelAt(page, x, y, id);
      expect([p.r, p.g, p.b, p.a], `pixel (${x},${y})`).toEqual([255, 0, 0, 255]);
    }
  });

  test('#1167 Pixelate averages each block instead of sampling its centre', async ({ page }) => {
    await createDocument(page, 400, 300, true);
    await page.waitForTimeout(200);
    const id = await activeLayerId(page);
    // One 22×22 block: columns 0..14 red, 15..21 blue. Its centre (11, 11)
    // is red, so point sampling turned the whole block red; the average is
    // 15/22 red + 7/22 blue = (174, 0, 81).
    await fillRect(page, 0, 0, 15, 22, [255, 0, 0]);
    await fillRect(page, 15, 0, 22, 22, [0, 0, 255]);
    expect((await getPixelAt(page, 14, 11, id)).r).toBe(255);
    expect((await getPixelAt(page, 15, 11, id)).b).toBe(255);

    await applyFilter(page, 'Pixelate...', { 'Block Size': 22 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'pixelate-block-average.png') });

    for (const [x, y] of [[0, 0], [11, 11], [15, 11], [21, 21]] as const) {
      const p = await getPixelAt(page, x, y, id);
      expect(p.a, `alpha (${x},${y})`).toBe(255);
      expect(Math.abs(p.r - 174), `red (${x},${y}) = ${p.r}`).toBeLessThanOrEqual(2);
      expect(p.g, `green (${x},${y})`).toBe(0);
      expect(Math.abs(p.b - 81), `blue (${x},${y}) = ${p.b}`).toBeLessThanOrEqual(2);
    }
    expect((await getPixelAt(page, 22, 11, id)).a).toBe(0);
    expect((await getPixelAt(page, 11, 22, id)).a).toBe(0);
  });
});
