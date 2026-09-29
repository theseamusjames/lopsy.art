import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  selectTool,
  setToolOption,
  setForegroundColor,
  docToScreen,
  undo,
  getPixelAt,
} from './helpers';

/**
 * #1021 — a Move grab must not read the whole layer back to find its
 * content bounds.
 *
 * `handleMoveDown` crops the layer to its content before a whole-layer
 * move so snapping, the move origin and the undo position all use the
 * content rect. That crop used to `readPixels` the entire texture and
 * scan its alpha on the CPU, inside the engine — 214–312 ms per grab at
 * 4K, and a full-canvas layer paid it on every grab because the crop
 * never shrinks it. The bytes never crossed the wasm bridge, so the
 * bridge's byte counter showed nothing.
 *
 * The engine now reduces the texture to a column strip and a row strip
 * on the GPU and reads back only those. Every GPU→CPU read in WebGL2 is a
 * `readPixels`, so the test counts the pixels requested by `readPixels`
 * calls made while each pointer-down is dispatched (bracketed by a
 * window capture listener and a later bubble listener, as in
 * mask-gpu-undo-780). That count is hardware-independent: before the fix
 * it is width × height per grab.
 */

const DOC_W = 1600;
const DOC_H = 1200;

async function installReadPixelsCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __readPx: number; __pointerDownReadPx: number[] };
    w.__readPx = 0;
    w.__pointerDownReadPx = [];
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      w.__readPx += Number(args[2]) * Number(args[3]);
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;
    let atStart = 0;
    window.addEventListener('pointerdown', () => { atStart = w.__readPx; }, { capture: true });
    window.addEventListener('pointerdown', () => {
      w.__pointerDownReadPx.push(w.__readPx - atStart);
    });
  });
}

async function pointerDownReadPx(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __pointerDownReadPx: number[] }).__pointerDownReadPx);
}

interface LayerBounds { id: string; type: string; x: number; y: number; width: number; height: number }

async function activeLayer(page: Page): Promise<LayerBounds> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: LayerBounds[] } };
    };
    const doc = store.getState().document;
    const l = doc.layers.find((layer) => layer.id === doc.activeLayerId)!;
    return { id: l.id, type: l.type, x: l.x, y: l.y, width: l.width, height: l.height };
  });
}

/** Composited RGB at a doc coordinate (the WebGL buffer is bottom-up). */
async function compositedAt(page: Page, docX: number, docY: number): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(async ({ docX, docY }) => {
    const read = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] }>;
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        viewport: { zoom: number; panX: number; panY: number };
        document: { width: number; height: number };
      };
    };
    const { viewport: v, document: d } = store.getState();
    const r = await read();
    const px = Math.round(r.width / 2 + v.panX + (docX - d.width / 2) * v.zoom);
    const py = Math.round(r.height / 2 + v.panY + (docY - d.height / 2) * v.zoom);
    const i = ((r.height - 1 - py) * r.width + px) * 4;
    return { r: r.pixels[i]!, g: r.pixels[i + 1]!, b: r.pixels[i + 2]! };
  }, { docX, docY });
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test.describe('Move grab reads back strips, not the layer (#1021)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForTimeout(200);
  });

  test('repeated grabs of a full-canvas layer read back at most w + h pixels each', async ({ page }) => {
    test.setTimeout(180_000);

    // Fill the whole transparent layer: its content rect is the full texture.
    await setForegroundColor(page, 40, 120, 200);
    await selectTool(page, 'fill');
    const centre = await docToScreen(page, DOC_W / 2, DOC_H / 2);
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(200);
    const filled = await activeLayer(page);
    expect(filled.type).toBe('raster');
    expect(await getPixelAt(page, 10, 10)).toMatchObject({ r: 40, g: 120, b: 200, a: 255 });

    await selectTool(page, 'move');
    await installReadPixelsCounter(page);

    await drag(page, [800, 600], [830, 620]);
    await drag(page, [800, 600], [760, 640]);
    await drag(page, [800, 600], [810, 560]);
    await page.screenshot({ path: 'e2e/screenshots/move-grab-full-canvas.png' });

    const reads = await pointerDownReadPx(page);
    expect(reads).toHaveLength(3);
    for (const px of reads) {
      // Before #1021 each grab read DOC_W × DOC_H = 1 920 000 pixels.
      expect(px).toBeLessThanOrEqual(DOC_W + DOC_H);
    }

    // The layer moved by the summed drag deltas: (+30,+20) + (-40,+40) + (+10,-40).
    const moved = await activeLayer(page);
    expect({ x: moved.x, y: moved.y, width: moved.width, height: moved.height })
      .toEqual({ x: filled.x + 0, y: filled.y + 20, width: filled.width, height: filled.height });

    // Pixels moved with it: the fill's top edge now sits at doc y = 20.
    expect(await compositedAt(page, 100, 10)).not.toMatchObject({ r: 40, g: 120, b: 200 });
    expect(await compositedAt(page, 100, 40)).toMatchObject({ r: 40, g: 120, b: 200 });

    await undo(page);
    await undo(page);
    await undo(page);
    const restored = await activeLayer(page);
    expect({ x: restored.x, y: restored.y }).toEqual({ x: filled.x, y: filled.y });
  });

  test('grab crops a soft stroke to exactly the CPU-scanned content bounds', async ({ page }) => {
    test.setTimeout(180_000);

    // A soft brush stroke: its faint fringe decides the bounds, so this
    // catches any drift between the GPU occupancy test and the CPU scan.
    await setForegroundColor(page, 200, 30, 30);
    await selectTool(page, 'brush');
    await setToolOption(page, 'Size', 90);
    await setToolOption(page, 'Hardness', 0);
    await drag(page, [300, 400], [1100, 700]);

    // CPU scan of the texture as it stands before the grab (a > 0, the
    // same test `crop_to_content_bounds` uses).
    const cpu = await page.evaluate(async () => {
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
        () => Promise<{ width: number; height: number; pixels: number[] }>;
      const r = await read();
      let minX = r.width, minY = r.height, maxX = -1, maxY = -1;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if (r.pixels[(y * r.width + x) * 4 + 3]! > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return { texW: r.width, texH: r.height, minX, minY, maxX, maxY };
    });
    const before = await activeLayer(page);
    expect(before.type).toBe('raster');
    expect(cpu.maxX).toBeGreaterThan(cpu.minX);
    // The stroke leaves transparent margins, so the grab must shrink it.
    expect(cpu.maxX - cpu.minX + 1).toBeLessThan(cpu.texW);

    await selectTool(page, 'move');
    await installReadPixelsCounter(page);
    const grab = await docToScreen(page, 700, 550);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'e2e/screenshots/move-grab-soft-stroke.png' });

    const cropped = await activeLayer(page);
    expect({ x: cropped.x, y: cropped.y, width: cropped.width, height: cropped.height }).toEqual({
      x: before.x + cpu.minX,
      y: before.y + cpu.minY,
      width: cpu.maxX - cpu.minX + 1,
      height: cpu.maxY - cpu.minY + 1,
    });
    const reads = await pointerDownReadPx(page);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toBeLessThanOrEqual(cpu.texW + cpu.texH);

    // The cropped texture holds the same stroke: its centre is still red.
    const centre = await getPixelAt(page, 700, 550);
    expect(centre.a).toBeGreaterThan(200);
    expect(centre.r).toBeGreaterThan(150);
  });
});
