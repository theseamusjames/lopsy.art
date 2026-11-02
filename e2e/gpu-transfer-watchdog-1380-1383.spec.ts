import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  setForegroundColor,
  selectTool,
  getPixelAt,
} from './helpers';

// Watchdog follow-ups on GPU transfers made inside interactive gestures:
// #1380 growing a layer read it back to the CPU as FLOAT and re-uploaded it,
// #1381 mask uploads expanded 1-byte masks to RGBA then f32 (16 B/texel),
// #1382 every nudge frame rebuilt and re-uploaded the whole selection mask,
// #1383 a selection drag queued a thumbnail readback at pointer-down.
// The probes hook WebGL2 itself, so they also see calls made inside Rust.

const GL_RED = 0x1903;
const GL_FLOAT = 0x1406;
const DOC = 1024;

interface GlCall { w: number; h: number; format: number; type: number }
interface GlLog {
  __reads: GlCall[];
  __uploads: GlCall[];
  __isLogging: boolean;
}

async function installGlProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as GlLog;
    w.__reads = [];
    w.__uploads = [];
    w.__isLogging = false;
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const read = proto.readPixels!;
    proto.readPixels = function (this: unknown, ...args: unknown[]) {
      if (w.__isLogging) {
        w.__reads.push({ w: Number(args[2]), h: Number(args[3]), format: Number(args[4]), type: Number(args[5]) });
      }
      return read.apply(this, args);
    };
    const upload = proto.texSubImage2D!;
    proto.texSubImage2D = function (this: unknown, ...args: unknown[]) {
      if (w.__isLogging && args.length >= 9) {
        w.__uploads.push({ w: Number(args[4]), h: Number(args[5]), format: Number(args[6]), type: Number(args[7]) });
      }
      return upload.apply(this, args);
    };
  });
}

/** Start (or restart) logging; returns what was logged since the last call. */
async function takeLog(page: Page, isLogging: boolean): Promise<{ reads: GlCall[]; uploads: GlCall[] }> {
  return page.evaluate((on) => {
    const w = window as unknown as GlLog;
    const out = { reads: w.__reads, uploads: w.__uploads };
    w.__reads = [];
    w.__uploads = [];
    w.__isLogging = on;
    return out;
  }, isLogging);
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

async function selection(page: Page): Promise<{ active: boolean; bounds: { x: number; y: number; width: number; height: number } | null; at: (number | undefined)[] }> {
  return page.evaluate((doc) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: { x: number; y: number; width: number; height: number } | null; mask: Uint8ClampedArray | null } };
    };
    const sel = store.getState().selection;
    // Mask samples along row 300: x = 205, 215, 405, 415.
    const at = [205, 215, 405, 415].map((x) => sel.mask?.[300 * doc + x]);
    return { active: sel.active, bounds: sel.bounds, at };
  }, DOC);
}

/** A layer filled red over (200, 200)-(400, 400), with that square left selected. */
async function setUpRedSquare(page: Page): Promise<string> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC, DOC, true);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);
  await setForegroundColor(page, 255, 0, 0);
  await selectTool(page, 'marquee-rect');
  await drag(page, 200, 200, 400, 400);
  await selectTool(page, 'fill');
  const inside = await docToScreen(page, 300, 300);
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(300);
  return layerId;
}

test.describe('GPU transfers inside gestures (#1380–#1383)', () => {
  test.beforeEach(async ({ page }) => {
    await installGlProbes(page);
  });

  test('#1381: a marquee commit uploads its mask as 1-byte texels and still clips the fill', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC, DOC, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
    const layerId = await addLayer(page);
    await setActiveLayer(page, layerId);
    await setForegroundColor(page, 0, 0, 255);
    await selectTool(page, 'marquee-rect');

    await takeLog(page, true);
    await drag(page, 200, 200, 400, 400);
    await page.waitForTimeout(300);
    const { uploads } = await takeLog(page, false);

    const docSized = uploads.filter((u) => u.w === DOC);
    // One R8 upload of the whole mask, and none of the old RGBA/FLOAT bands.
    expect(docSized.filter((u) => u.format === GL_RED && u.h === DOC)).toHaveLength(1);
    expect(docSized.filter((u) => u.type === GL_FLOAT)).toHaveLength(0);

    // The mask still constrains the fill: blue inside, transparent outside.
    await selectTool(page, 'fill');
    const inside = await docToScreen(page, 300, 300);
    await page.mouse.click(inside.x, inside.y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/gpu-transfer-1381-fill.png' });
    const center = await getPixelAt(page, 300, 300, layerId);
    expect(center.b).toBeGreaterThan(240);
    expect(center.a).toBeGreaterThan(240);
    expect((await getPixelAt(page, 202, 202, layerId)).a).toBeGreaterThan(240);
    expect((await getPixelAt(page, 197, 300, layerId)).a).toBe(0);
    expect((await getPixelAt(page, 300, 403, layerId)).a).toBe(0);
  });

  test('#1383: dragging a selection does no readback until pointer-up', async ({ page }) => {
    const layerId = await setUpRedSquare(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    const start = await docToScreen(page, 300, 300);
    const end = await docToScreen(page, 500, 300);
    await takeLog(page, true);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Long enough for the thumbnail queue's 200 ms idle timeout to fire.
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 8, start.y);
      await page.waitForTimeout(150);
    }
    const duringDrag = await takeLog(page, true);
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const afterUp = await takeLog(page, false);

    expect(duringDrag.reads).toEqual([]);
    // Pointer-up refreshes the thumbnail once the gesture is over.
    expect(afterUp.reads.length).toBeGreaterThanOrEqual(1);

    await page.keyboard.press('Control+d');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/gpu-transfer-1383-drag.png' });
    // The square moved 200 px right: (400..600, 200..400).
    expect((await getPixelAt(page, 300, 300, layerId)).a).toBe(0);
    const moved = await getPixelAt(page, 500, 300, layerId);
    expect(moved.r).toBeGreaterThan(240);
    expect(moved.a).toBeGreaterThan(240);
  });

  test('#1382: a held arrow key moves the selection without per-frame mask uploads', async ({ page }) => {
    const layerId = await setUpRedSquare(page);
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    await takeLog(page, true);
    // keyboard.down on a key already held sends repeat: true, like OS auto-repeat.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    const duringHold = await takeLog(page, true);
    const midHold = await selection(page);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(300);
    const afterRelease = await takeLog(page, false);

    const maskUploads = (calls: GlCall[]) => calls.filter((u) => u.w === DOC && u.h === DOC && u.format === GL_RED);
    // At most the one upload the first nudge's float lift makes, not one per
    // frame. Counts any document-wide upload: R8 or the old RGBA/FLOAT bands.
    expect(duringHold.uploads.filter((u) => u.w === DOC).length).toBeLessThanOrEqual(1);
    // Software GL can lag frames behind the keydowns, so the coalescer may
    // still hold some of the delta; keyup flushes the rest.
    expect(midHold.bounds?.x).toBeGreaterThan(200);
    expect(midHold.bounds?.width).toBe(200);
    // The deferred mask is written once, when the key comes up.
    expect(maskUploads(afterRelease.uploads)).toHaveLength(1);

    const after = await selection(page);
    expect(after.active).toBe(true);
    expect(after.bounds).toEqual({ x: 212, y: 200, width: 200, height: 200 });
    // Row 300 of the mask: x = 205 and 415 are outside (212..412), 215 and 405 inside.
    expect(after.at).toEqual([0, 255, 255, 0]);

    await page.screenshot({ path: 'e2e/screenshots/gpu-transfer-1382-nudge.png' });
    // The pixels moved with it: a 12 px gap on the left, red past x = 400.
    expect((await getPixelAt(page, 205, 300, layerId)).a).toBe(0);
    const right = await getPixelAt(page, 408, 300, layerId);
    expect(right.r).toBeGreaterThan(240);
    expect(right.a).toBeGreaterThan(240);

    // One undo puts the whole hold back.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const undone = await getPixelAt(page, 205, 300, layerId);
    expect(undone.r).toBeGreaterThan(240);
    expect((await selection(page)).bounds).toEqual({ x: 200, y: 200, width: 200, height: 200 });
  });

  test('#1380: the first brush stroke after a Move grows the layer on the GPU', async ({ page }) => {
    const layerId = await setUpRedSquare(page);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);

    // Moving crops the layer to its content, so it no longer covers the
    // canvas and the next stroke has to grow it.
    await page.keyboard.press('v');
    await drag(page, 300, 300, 600, 600);
    await page.waitForTimeout(500);

    await setForegroundColor(page, 0, 255, 0);
    await selectTool(page, 'brush');
    const a = await docToScreen(page, 100, 100);
    const b = await docToScreen(page, 160, 100);
    await takeLog(page, true);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const duringStroke = await takeLog(page, false);
    await page.mouse.up();
    await page.waitForTimeout(500);

    // No full-layer readback: only small reads (none at all, normally).
    const bigReads = duringStroke.reads.filter((r) => r.w * r.h >= 200 * 200);
    expect(bigReads).toEqual([]);
    expect(duringStroke.uploads.filter((u) => u.type === GL_FLOAT && u.w >= 200)).toEqual([]);

    await page.screenshot({ path: 'e2e/screenshots/gpu-transfer-1380-grow.png' });
    // The moved square survived the growth at its new place (500..700).
    expect((await getPixelAt(page, 400, 400, layerId)).a).toBe(0);
    const square = await getPixelAt(page, 600, 600, layerId);
    expect(square.r).toBeGreaterThan(240);
    expect(square.a).toBeGreaterThan(240);
    const edge = await getPixelAt(page, 502, 502, layerId);
    expect(edge.r).toBeGreaterThan(240);
    // And the stroke landed outside the old layer rect.
    const stroke = await getPixelAt(page, 130, 100, layerId);
    expect(stroke.g).toBeGreaterThan(200);
    expect(stroke.a).toBeGreaterThan(200);
  });
});
