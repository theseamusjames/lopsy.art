import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  addLayer,
  setActiveLayer,
  selectTool,
} from './helpers';

// Watchdog follow-ups on full-document GPU transfers inside key holds and
// quick-mask moves:
// #1480 a held arrow nudge with a selection tool rebuilt and re-uploaded the
//       whole selection mask every frame,
// #1481 quick-mask uploads expanded 1-byte masks to RGBA then f32,
// #1482 a quick-mask marquee nudge read the whole quick mask back every frame.
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

function docSized(calls: GlCall[]): GlCall[] {
  return calls.filter((c) => c.w === DOC);
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

interface SelectionProbe {
  active: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  row: (number | undefined)[];
}

/** The selection, with its mask sampled along row 300 at `xs`. */
async function selection(page: Page, xs: number[]): Promise<SelectionProbe> {
  return page.evaluate(({ doc, xs }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: SelectionProbe['bounds']; mask: Uint8ClampedArray | null } };
    };
    const sel = store.getState().selection;
    return { active: sel.active, bounds: sel.bounds, row: xs.map((x) => sel.mask?.[300 * doc + x]) };
  }, { doc: DOC, xs });
}

type Bounds = NonNullable<SelectionProbe['bounds']>;

// Firefox truncates pointer clientX to whole pixels, so at fit zoom a dragged
// marquee can land a doc pixel off its target: measure it instead of assuming.
async function selectionBounds(page: Page): Promise<Bounds> {
  const { bounds } = await selection(page, []);
  expect(bounds).not.toBeNull();
  return bounds as Bounds;
}

async function holdArrowRight(page: Page, repeats: number): Promise<void> {
  // keyboard.down on a key already held sends repeat: true, like OS auto-repeat.
  for (let i = 0; i < repeats; i++) {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(100);
}

async function openDocument(page: Page): Promise<void> {
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, DOC, DOC, false);
  await page.waitForSelector('[data-testid="canvas-container"]');
  await page.waitForTimeout(300);
  const layerId = await addLayer(page);
  await setActiveLayer(page, layerId);
}

/**
 * Quick Mask on, with the quick mask holding the square (200, 200)-(400, 400)
 * and a marquee over (300, 200)-(500, 400): its left half covers the right
 * half of the painted square. Returns both as drawn.
 */
async function setUpQuickMaskMarquee(page: Page): Promise<{ square: Bounds; marquee: Bounds }> {
  await openDocument(page);
  await selectTool(page, 'marquee-rect');
  await drag(page, 200, 200, 400, 400);
  const square = await selectionBounds(page);
  await page.keyboard.press('q');
  await page.waitForTimeout(300);
  await drag(page, 300, 200, 500, 400);
  const marquee = await selectionBounds(page);
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  return { square, marquee };
}

test.describe('Selection and quick-mask nudges without per-frame transfers (#1480–#1482)', () => {
  test.beforeEach(async ({ page }) => {
    await installGlProbes(page);
  });

  test('#1480: a held arrow key with the marquee tool moves the selection without per-frame mask uploads', async ({ page }) => {
    await openDocument(page);
    await selectTool(page, 'marquee-rect');
    await drag(page, 200, 200, 400, 400);
    await page.waitForTimeout(200);
    const drawn = await selectionBounds(page);
    const left = drawn.x + 12;
    const right = left + drawn.width;

    await takeLog(page, true);
    await holdArrowRight(page, 12);
    const duringHold = await takeLog(page, true);
    const midHold = await selection(page, []);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(300);
    const afterRelease = await takeLog(page, false);

    // Not one document-sized upload while the key is held: R8 or the old bands.
    expect(docSized(duringHold.uploads)).toEqual([]);
    // The ants follow the bounds during the hold.
    expect(midHold.bounds?.x).toBeGreaterThan(drawn.x);
    expect(midHold.bounds?.width).toBe(drawn.width);
    // The translated mask is written once, when the key comes up.
    expect(docSized(afterRelease.uploads).filter((u) => u.format === GL_RED && u.h === DOC)).toHaveLength(1);

    const after = await selection(page, [left - 7, left + 3, right - 7, right + 3]);
    expect(after.active).toBe(true);
    expect(after.bounds).toEqual({ ...drawn, x: left });
    expect(after.row).toEqual([0, 255, 255, 0]);

    await page.screenshot({ path: 'e2e/screenshots/quick-mask-nudge-1480.png' });

    // The selection constrains a fill where the ants are.
    await selectTool(page, 'fill');
    const inside = await docToScreen(page, right - 4, 300);
    await page.mouse.click(inside.x, inside.y);
    await page.waitForTimeout(300);
    const filled = await selection(page, [left - 7, right - 4]);
    expect(filled.row).toEqual([0, 255]);
  });

  test('#1482: a held arrow key in Quick Mask moves the painted content with no readback', async ({ page }) => {
    const { square, marquee: drawn } = await setUpQuickMaskMarquee(page);
    const gapEnd = drawn.x + 12;
    const movedRight = square.x + square.width + 12;

    await takeLog(page, true);
    await holdArrowRight(page, 12);
    const duringHold = await takeLog(page, true);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(300);
    const afterRelease = await takeLog(page, false);

    // No quick-mask readback and no quick-mask or selection upload per frame.
    expect(docSized(duringHold.reads)).toEqual([]);
    expect(docSized(duringHold.uploads)).toEqual([]);
    // The marquee's mask lands once, when the key comes up.
    expect(docSized(afterRelease.uploads).filter((u) => u.type === GL_FLOAT)).toEqual([]);
    expect(docSized(afterRelease.uploads).length).toBeLessThanOrEqual(1);

    const marquee = await selection(page, []);
    expect(marquee.bounds).toEqual({ ...drawn, x: gapEnd });

    await page.screenshot({ path: 'e2e/screenshots/quick-mask-nudge-1482.png' });

    // Leaving Quick Mask turns the quick mask into the selection. The half
    // of the square outside the marquee stayed; the half inside moved 12 px,
    // leaving a 12 px gap where the marquee's left edge was.
    await page.keyboard.press('q');
    await page.waitForTimeout(400);
    const result = await selection(page, [
      square.x + 50, drawn.x - 2, drawn.x + 5, gapEnd + 3, movedRight - 7, movedRight - 1, movedRight + 2,
    ]);
    expect(result.active).toBe(true);
    expect(result.row).toEqual([255, 255, 0, 255, 255, 255, 0]);
  });

  test('#1481/#1482: a quick-mask marquee drag moves the content on the GPU', async ({ page }) => {
    const { square, marquee: drawn } = await setUpQuickMaskMarquee(page);
    const squareRight = square.x + square.width;

    const start = await docToScreen(page, 400, 300);
    const end = await docToScreen(page, 440, 300);
    await takeLog(page, true);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 6, start.y);
      await page.waitForTimeout(60);
    }
    const duringDrag = await takeLog(page, false);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // No quick-mask readback at pointer-down and no 16-byte-per-texel
    // quick-mask uploads per frame.
    expect(docSized(duringDrag.reads)).toEqual([]);
    expect(docSized(duringDrag.uploads).filter((u) => u.type === GL_FLOAT)).toEqual([]);

    const marquee = await selection(page, []);
    const dx = (marquee.bounds?.x ?? drawn.x) - drawn.x;
    expect(dx).toBeGreaterThan(30);
    expect(dx).toBeLessThan(50);

    await page.keyboard.press('q');
    await page.waitForTimeout(400);
    const result = await selection(page, [
      square.x + 50, drawn.x - 2, drawn.x + 5, drawn.x + dx + 2, squareRight + dx - 2, squareRight + dx + 2,
    ]);
    expect(result.row).toEqual([255, 255, 0, 255, 255, 0]);
  });

  test('#1481: entering Quick Mask with no selection uploads nothing', async ({ page }) => {
    await openDocument(page);
    await takeLog(page, true);
    await page.keyboard.press('q');
    await page.waitForTimeout(300);
    const log = await takeLog(page, false);

    expect(docSized(log.uploads)).toEqual([]);

    // Fully unselected: leaving at once leaves no selection pixels behind.
    await page.keyboard.press('q');
    await page.waitForTimeout(300);
    const sel = await selection(page, [100, 500, 900]);
    expect(sel.row.every((v) => v === undefined || v === 0)).toBe(true);
  });
});
