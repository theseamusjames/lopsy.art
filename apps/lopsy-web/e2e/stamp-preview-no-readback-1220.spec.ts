import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setToolOption, drawRect, docToScreen } from './helpers';

/**
 * #1220 — the Clone Stamp / Healing Brush source preview read the whole
 * active layer back to the CPU inside the render loop: with no source set
 * at all, and again on every stroke (its cache key held the undo-stack
 * length, which every stroke's history push changed). The engine now draws
 * the preview from the layer texture, so hovering and stamping read
 * nothing back.
 *
 * Every `readPixels` is counted with the number of texels it reads. The
 * preview itself is checked on the screen canvas: inside the brush circle
 * it shows the source's red at 70 % over what is under the cursor.
 */

const DOC_W = 1200;
const DOC_H = 800;

async function installReadPixelsMeter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __readTexels: number; __readCalls: number };
    w.__readTexels = 0;
    w.__readCalls = 0;
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      w.__readCalls++;
      w.__readTexels += (args[2] as number) * (args[3] as number);
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;
  });
}

async function resetMeter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __readTexels: number; __readCalls: number };
    w.__readTexels = 0;
    w.__readCalls = 0;
  });
}

async function meter(page: Page): Promise<{ calls: number; texels: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __readTexels: number; __readCalls: number };
    return { calls: w.__readCalls, texels: w.__readTexels };
  });
}

async function hover(page: Page, points: Array<[number, number]>): Promise<void> {
  for (const [x, y] of points) {
    const p = await docToScreen(page, x, y);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(60);
  }
}

/** Screen-canvas colour at a document point (the readback is bottom-up). */
async function screenAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readCompositedPixels: () => Promise<{ width: number; height: number; pixels: number[] }>;
      __editorStore: { getState: () => { document: { width: number; height: number }; viewport: { zoom: number; panX: number; panY: number } } };
    };
    const { width, height, pixels } = await w.__readCompositedPixels();
    const { document: doc, viewport: vp } = w.__editorStore.getState();
    const px = Math.floor((x + 0.5 - doc.width / 2) * vp.zoom + vp.panX + width / 2);
    const py = height - 1 - Math.floor((y + 0.5 - doc.height / 2) * vp.zoom + vp.panY + height / 2);
    const i = (py * width + px) * 4;
    return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0] as [number, number, number];
  }, { x, y });
}

test.describe('Stamp source preview reads nothing back (#1220)', () => {
  test.beforeEach(async ({ page }) => {
    await installReadPixelsMeter(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await drawRect(page, 0, 0, DOC_W / 2, DOC_H, { r: 220, g: 30, b: 30 });
    await drawRect(page, DOC_W / 2, 0, DOC_W / 2, DOC_H, { r: 30, g: 30, b: 220 });
  });

  for (const tool of ['stamp', 'healing'] as const) {
    test(`${tool}: hovering and stamping never read the layer back`, async ({ page }) => {
      await selectTool(page, tool);
      await setToolOption(page, 'Size', 60);
      await page.waitForTimeout(300);

      // No source set: just the brush ring.
      await resetMeter(page);
      await hover(page, [[700, 300], [760, 320], [820, 340], [880, 360]]);
      expect(await meter(page)).toEqual({ calls: 0, texels: 0 });

      // Source set, hovering: the preview follows the cursor.
      const src = await docToScreen(page, 300, 400);
      await page.mouse.move(src.x, src.y);
      await page.keyboard.down('Alt');
      await page.mouse.down();
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await resetMeter(page);
      await hover(page, [[700, 300], [760, 320], [820, 340], [880, 400]]);
      expect(await meter(page)).toEqual({ calls: 0, texels: 0 });

      // A stroke (history push at its start) and the frames after it. Only
      // the layer panel's thumbnail refresh may read back, and it is tiny.
      await resetMeter(page);
      const a = await docToScreen(page, 880, 400);
      const b = await docToScreen(page, 980, 400);
      await page.mouse.down();
      await page.mouse.move(a.x + 1, a.y);
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.mouse.up();
      await hover(page, [[1000, 420], [1020, 440], [1040, 460]]);
      await page.waitForTimeout(300);
      const strokeReads = await meter(page);
      expect(strokeReads.texels).toBeLessThan(128 * 128);

      // The preview: source red at 70 % over the blue under the cursor
      // (0.7 × 220 + 0.3 × 30 ≈ 163 red, 0.7 × 30 + 0.3 × 220 ≈ 87 blue).
      await hover(page, [[1050, 600]]);
      await page.screenshot({ path: `e2e/screenshots/stamp-preview-gpu-${tool}.png` });
      const inside = await screenAt(page, 1050 + 10, 600 + 10);
      expect(inside[0]).toBeGreaterThan(140);
      expect(inside[2]).toBeLessThan(110);
      // Outside the circle the canvas is the plain blue layer.
      const outside = await screenAt(page, 1050 + 50, 600);
      expect(outside[0]).toBeLessThan(50);
      expect(outside[2]).toBeGreaterThan(200);
    });
  }
});
