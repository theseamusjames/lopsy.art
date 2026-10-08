import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, selectTool, setToolOption, drawRect, docToScreen } from './helpers';

/**
 * #1218 — the Healing Brush used to read both region means back with a
 * synchronous 1 × 1 `readPixels` per region per dab, draining the GPU
 * pipeline twice for every dab of a pointer-move. The means now stay on
 * the GPU: no `readPixels` may run while a healing pointer-move is handled.
 *
 * The heal itself must still do what it says — borrow the source's
 * texture and keep the destination's tone (`src − srcMean + dstMean`).
 * The source here is grey with dark stripes and the destination flat
 * blue, so a correct heal paints blue stripes. (The old `UNSIGNED_BYTE`
 * read of an RGBA16F target failed outright and left both means at zero,
 * which cloned grey stripes instead.)
 */

const DOC_W = 800;
const DOC_H = 600;
const SIZE = 40;
const GREY = 128;
const STRIPE = 64;
const BLUE = { r: 30, g: 30, b: 220 };

async function installReadPixelsCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __readsDuringMove: number; __inMove: boolean };
    w.__readsDuringMove = 0;
    w.__inMove = false;
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      if (w.__inMove) w.__readsDuringMove++;
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;
    // Runs before the app's window-level pointermove handler.
    window.addEventListener('pointermove', () => { w.__inMove = true; }, { capture: true });
  });
}

/** Registered after the app's handler, so it runs after it. */
async function closeMoveBracket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __inMove: boolean };
    window.addEventListener('pointermove', () => { w.__inMove = false; });
  });
}

async function layerPixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ x, y }) => {
    const w = window as unknown as {
      __readLayerPixels: () => Promise<{ width: number; pixels: number[] } | null>;
    };
    const px = await w.__readLayerPixels();
    const i = (y * px!.width + x) * 4;
    return [px!.pixels[i]!, px!.pixels[i + 1]!, px!.pixels[i + 2]!] as [number, number, number];
  }, { x, y });
}

test.describe('Healing Brush keeps its region means on the GPU (#1218)', () => {
  test.beforeEach(async ({ page }) => {
    await installReadPixelsCounter(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await closeMoveBracket(page);
  });

  test('a healing stroke reads nothing back and paints source texture in destination tone', async ({ page }) => {
    await drawRect(page, 0, 0, DOC_W / 2, DOC_H, { r: GREY, g: GREY, b: GREY });
    await drawRect(page, DOC_W / 2, 0, DOC_W / 2, DOC_H, BLUE);
    // Dark 4 px stripes every 12 px across the source rows 216–287.
    for (let y = 216; y < 288; y += 12) {
      await drawRect(page, 100, y, 250, 4, { r: STRIPE, g: STRIPE, b: STRIPE });
    }

    await selectTool(page, 'healing');
    await setToolOption(page, 'Size', SIZE);
    const source = await docToScreen(page, 200, 250);
    await page.mouse.move(source.x, source.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');

    // Same rows as the source (offset −350, 0), so the stripes line up.
    const from = await docToScreen(page, 550, 250);
    const to = await docToScreen(page, 650, 250);
    await page.evaluate(() => { (window as unknown as { __readsDuringMove: number }).__readsDuringMove = 0; });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const readsDuringMove = await page.evaluate(() => (window as unknown as { __readsDuringMove: number }).__readsDuringMove);
    await page.screenshot({ path: 'e2e/screenshots/healing-gpu-means.png' });

    expect(readsDuringMove).toBe(0);

    // Row 248 is grey in the source, row 253 a dark stripe.
    const base = await layerPixel(page, 600, 248);
    const stripe = await layerPixel(page, 600, 253);
    // Destination tone: strongly blue, not the source's neutral grey.
    expect(base[2] - base[0]).toBeGreaterThan(120);
    expect(stripe[2] - stripe[0]).toBeGreaterThan(120);
    // Source texture: the stripe is ~64 darker than the grey rows.
    expect(base[2] - stripe[2]).toBeGreaterThan(40);
  });
});
