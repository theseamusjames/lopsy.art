/**
 * #1206 — symbols that neither the chosen font nor Inter carries (▸ ◂ ☂)
 * fall back to the bundled symbol face instead of drawing NO GLYPH boxes.
 *
 * Every missing glyph draws the same `.notdef` box, so three different
 * symbols typed into three layers would rasterize identically. With the
 * fallback each one has its own shape.
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, getEditorState, docToScreen, setToolOption } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.resolve(__dirname, 'screenshots');

interface Raster {
  opaque: number;
  /** Alpha channel of the layer, row by row. */
  alpha: number[];
  width: number;
}

async function layerRaster(page: Page, layerId: string): Promise<Raster> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await read(id);
    if (!result) return { opaque: 0, alpha: [], width: 0 };
    const alpha: number[] = [];
    let opaque = 0;
    for (let i = 3; i < result.pixels.length; i += 4) {
      const a = result.pixels[i] ?? 0;
      alpha.push(a);
      if (a > 127) opaque++;
    }
    return { opaque, alpha, width: result.width };
  }, layerId);
}

async function selectBackground(page: Page): Promise<void> {
  const bg = (await getEditorState(page)).document.layers.find((l) => l.name === 'Background');
  if (!bg) throw new Error('no Background layer');
  await page.locator(`[data-layer-id="${bg.id}"]`).click();
}

async function typeText(page: Page, docX: number, docY: number, text: string): Promise<string> {
  const before = new Set((await getEditorState(page)).document.layers.map((l) => l.id));
  const pos = await docToScreen(page, docX, docY);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(100);
  await page.keyboard.type(text);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const layer = (await getEditorState(page)).document.layers.find((l) => !before.has(l.id));
  if (!layer) throw new Error('typing did not create a text layer');
  return layer.id;
}

function sameRaster(a: Raster, b: Raster): boolean {
  return a.width === b.width && a.alpha.length === b.alpha.length && a.alpha.every((v, i) => v === b.alpha[i]);
}

test.describe('symbol fallback beyond Inter (#1206)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'text options require the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 400, true);
  });

  test('▸ ◂ ☂ in Inter each draw their own glyph', async ({ page }) => {
    await page.keyboard.press('t');
    await setToolOption(page, 'Size', 96);

    const ids: string[] = [];
    for (const [i, symbol] of ['▸', '◂', '☂'].entries()) {
      if (i > 0) await selectBackground(page);
      ids.push(await typeText(page, 80 + i * 220, 200, symbol));
    }
    await page.screenshot({ path: path.join(SCREENSHOTS, 'text-symbol-fallback-1206.png') });

    const layers = (await getEditorState(page)).document.layers;
    expect(ids.map((id) => layers.find((l) => l.id === id)?.name)).toEqual(['▸', '◂', '☂']);

    const [right, left, umbrella] = await Promise.all(ids.map((id) => layerRaster(page, id)));
    for (const r of [right, left, umbrella]) expect(r!.opaque).toBeGreaterThan(200);

    // NO GLYPH boxes are pixel-identical; real glyphs are not.
    expect(sameRaster(right!, left!)).toBe(false);
    expect(sameRaster(right!, umbrella!)).toBe(false);
    expect(sameRaster(left!, umbrella!)).toBe(false);
    // ▸ and ◂ are mirror images of the same small triangle: about the same ink.
    expect(Math.abs(right!.opaque - left!.opaque) / right!.opaque).toBeLessThan(0.1);
    // The umbrella carries clearly more ink than a small triangle.
    expect(umbrella!.opaque).toBeGreaterThan(right!.opaque * 1.5);
  });
});
