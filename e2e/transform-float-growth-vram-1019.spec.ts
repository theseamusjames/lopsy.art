import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
} from './helpers';

// #1019 — a scale drag past the canvas grew the float to exactly the
// transformed bounds on every pointer-move. Each growth allocated three new
// textures (float, float base, layer) at a size never seen before and
// released the old three to the pool, which only trims free textures above
// two per size — so every one of them stayed alive. The 30-step drag below
// left 28 extra textures and ~1.1 GB of VRAM behind, even after the commit.
// Growth is now geometric and the replaced textures are deleted.

interface TexHook {
  __liveTextures: Map<WebGLTexture, number>;
}

/** Track every WebGL texture's allocation (level-0 bytes) until it is deleted. */
async function installTextureHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as TexHook;
    const live = new Map<WebGLTexture, number>();
    w.__liveTextures = live;
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const bound = new WeakMap<WebGL2RenderingContext, Map<number, WebGLTexture | null>>();
    const activeUnit = new WeakMap<WebGL2RenderingContext, number>();
    const bytesPerTexel = (fmt: number): number => {
      const gl = WebGL2RenderingContext;
      if (fmt === gl.RGBA32F) return 16;
      if (fmt === gl.RGBA16F) return 8;
      if (fmt === gl.R8 || fmt === gl.ALPHA || fmt === gl.LUMINANCE) return 1;
      if (fmt === gl.R16F || fmt === gl.RG8) return 2;
      if (fmt === gl.R32F || fmt === gl.RG16F) return 4;
      return 4;
    };
    const current = (gl: WebGL2RenderingContext): WebGLTexture | null | undefined =>
      bound.get(gl)?.get(activeUnit.get(gl) ?? gl.TEXTURE0);

    const wrap = (name: string, after: (gl: WebGL2RenderingContext, args: unknown[], result: unknown) => void) => {
      const original = proto[name]!;
      proto[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
        const result = original.apply(this, args);
        after(this, args, result);
        return result;
      };
    };
    wrap('createTexture', (_gl, _args, tex) => {
      if (tex) live.set(tex as WebGLTexture, 0);
    });
    wrap('deleteTexture', (_gl, args) => {
      if (args[0]) live.delete(args[0] as WebGLTexture);
    });
    wrap('activeTexture', (gl, args) => {
      activeUnit.set(gl, args[0] as number);
    });
    wrap('bindTexture', (gl, args) => {
      if (args[0] !== gl.TEXTURE_2D) return;
      let units = bound.get(gl);
      if (!units) {
        units = new Map();
        bound.set(gl, units);
      }
      units.set(activeUnit.get(gl) ?? gl.TEXTURE0, (args[1] as WebGLTexture | null) ?? null);
    });
    wrap('texImage2D', (gl, args) => {
      if (args[0] !== gl.TEXTURE_2D || args[1] !== 0) return;
      const tex = current(gl);
      if (!tex || !live.has(tex)) return;
      let width: number;
      let height: number;
      if (args.length >= 9) {
        width = args[3] as number;
        height = args[4] as number;
      } else {
        const src = args[5] as { width: number; height: number };
        width = src.width;
        height = src.height;
      }
      live.set(tex, width * height * bytesPerTexel(args[2] as number));
    });
    wrap('texStorage2D', (gl, args) => {
      if (args[0] !== gl.TEXTURE_2D) return;
      const tex = current(gl);
      if (!tex || !live.has(tex)) return;
      live.set(tex, (args[3] as number) * (args[4] as number) * bytesPerTexel(args[2] as number));
    });
  });
}

async function textureStats(page: Page): Promise<{ count: number; mb: number }> {
  return page.evaluate(() => {
    const live = (window as unknown as TexHook).__liveTextures;
    let bytes = 0;
    for (const b of live.values()) bytes += b;
    return { count: live.size, mb: bytes / (1024 * 1024) };
  });
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const a = await docToScreen(page, x0, y0);
  const b = await docToScreen(page, x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Opaque pixel count and document-space opaque bounds of a layer. */
async function opaqueExtent(page: Page, layerId: string): Promise<{ count: number; minX: number; minY: number; maxX: number; maxY: number }> {
  return page.evaluate(async (lid) => {
    const w = window as unknown as {
      __readLayerPixels: (id: string) => Promise<{ width: number; height: number; pixels: ArrayLike<number> }>;
      __editorStore: { getState: () => { document: { layers: Array<{ id: string; x: number; y: number }> } } };
    };
    const layer = w.__editorStore.getState().document.layers.find((l) => l.id === lid)!;
    const r = await w.__readLayerPixels(lid);
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if (r.pixels[(y * r.width + x) * 4 + 3]! <= 200) continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { count, minX: minX + layer.x, minY: minY + layer.y, maxX: maxX + layer.x, maxY: maxY + layer.y };
  }, layerId);
}

test('#1019: a scale drag past the canvas grows the float a few times and frees what it replaces', async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await installTextureHook(page);
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 2048, 2048, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);

  // Zoom out so the canvas's bottom-right corner has room past it.
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Minus');
  await page.waitForTimeout(200);

  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);

  // Red square (512,512)-(1536,1536).
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'marquee-rect');
  await drag(page, 512, 512, 1536, 1536);
  await selectTool(page, 'fill');
  const inside = await docToScreen(page, 1024, 1024);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(300);
  const squarePixels = (await opaqueExtent(page, layerId)).count;
  expect(squarePixels).toBeGreaterThan(1024 * 1024 * 0.98);

  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  const before = await textureStats(page);

  // Record every texture rect the store reports for the layer during the
  // drag: each distinct one is a float growth.
  await page.evaluate((lid) => {
    const w = window as unknown as {
      __editorStore: { subscribe: (fn: (s: { document: { layers: Array<{ id: string; x: number; y: number; width: number; height: number }> } }) => void) => () => void };
      __layerRects: Set<string>;
      __stopRects: () => void;
    };
    w.__layerRects = new Set();
    w.__stopRects = w.__editorStore.subscribe((s) => {
      const l = s.document.layers.find((x) => x.id === lid);
      if (l) w.__layerRects.add(`${l.x},${l.y},${l.width},${l.height}`);
    });
  }, layerId);

  // Grab the bottom-right scale handle (the rotate handle's hit circle
  // covers the exact corner at this zoom) and drag it out past the canvas.
  const start = await docToScreen(page, 1510, 1510);
  const end = await docToScreen(page, 2400, 2400);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await textureStats(page);
  const growthRects = await page.evaluate(() => {
    const w = window as unknown as { __layerRects: Set<string>; __stopRects: () => void };
    w.__stopRects();
    return Array.from(w.__layerRects);
  });

  const scaleX = await page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { transform: { scaleX: number } | null };
    };
    return ui.getState().transform?.scaleX ?? 0;
  });
  // The corner followed the pointer 890 doc px out: 1024 → 1914.
  expect(scaleX).toBeGreaterThan(1.8);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(500);
  const afterCommit = await textureStats(page);
  await page.screenshot({ path: 'e2e/screenshots/transform-float-growth-vram-1019.png' });

  // The first rect is the float's lift to the canvas; every later one is a
  // growth. Exact growth reallocated on almost every move past the canvas
  // edge (14 rects); geometric growth needs one or two here.
  expect(growthRects.length).toBeGreaterThan(1);
  expect(growthRects.length).toBeLessThanOrEqual(3);

  // Unfixed: +28 textures / +1,096 MB after the drag, all still alive after
  // the commit. Fixed: +3 / +168 MB while the float is live (the grown
  // float, base and layer textures), +1 / +68 MB after the commit (the grown
  // layer texture).
  expect(afterDrag.count - before.count).toBeLessThanOrEqual(6);
  expect(afterCommit.count - before.count).toBeLessThanOrEqual(6);
  expect(afterDrag.mb - before.mb).toBeLessThan(300);
  expect(afterCommit.mb - before.mb).toBeLessThan(300);

  // Nothing was cropped: the committed square spans 512..2426 on both axes,
  // including the 378 px past the canvas edge.
  const extent = await opaqueExtent(page, layerId);
  const side = 1024 * scaleX;
  expect(extent.minX).toBeGreaterThanOrEqual(510);
  expect(extent.minX).toBeLessThanOrEqual(514);
  expect(extent.minY).toBeGreaterThanOrEqual(510);
  expect(extent.minY).toBeLessThanOrEqual(514);
  expect(extent.maxX).toBeGreaterThan(512 + side - 4);
  expect(extent.maxX).toBeLessThan(512 + side + 2);
  expect(extent.maxY).toBeGreaterThan(512 + side - 4);
  expect(extent.maxY).toBeLessThan(512 + side + 2);
  expect(extent.count).toBeGreaterThan(side * side * 0.97);
  expect(extent.count).toBeLessThan(side * side * 1.03);
});
