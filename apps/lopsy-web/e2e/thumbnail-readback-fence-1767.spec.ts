import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, addLayer, docToScreen, setToolOption, setForegroundColor } from './helpers';
import { isWgpu } from './gpu-args';

interface ReadCall { w: number; h: number; isPackBuffer: boolean }

/**
 * #1767 — on WebGL every deferred readback still blocked the main thread on
 * the GPU backlog: the layer thumbnail read fired a few ms after an undo's
 * restore and recomposite, and its synchronous `glReadPixels` waited for
 * all of it (~600 ms per step at 4K on software GL, for 2.3 KB).
 *
 * Thumbnail and mask reads now copy into a pixel-pack buffer and wait for a
 * fence. The test checks the mechanism, which is hardware-independent:
 * every thumbnail-sized `readPixels` after a stroke and after an undo is a
 * pack-buffer read (an offset, not a destination array, so it cannot
 * block), and the thumbnail still shows the right pixels each time.
 */

async function installReadLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __reads: ReadCall[] };
    w.__reads = [];
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      w.__reads.push({ w: Number(args[2]), h: Number(args[3]), isPackBuffer: typeof args[6] === 'number' });
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;
  });
}

async function takeThumbnailReads(page: Page): Promise<ReadCall[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __reads: ReadCall[] };
    const reads = w.__reads.filter((r) => r.w <= 64 && r.h <= 64 && r.w * r.h > 1);
    w.__reads = [];
    return reads;
  });
}

/** Opaque red pixels in the layer row's thumbnail canvas. */
async function thumbnailRedPixels(page: Page, layerId: string): Promise<number> {
  return page.evaluate((lid) => {
    const canvas = document.querySelector(`[data-layer-id="${lid}"] canvas`) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return -1;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 128 && d[i]! > 150 && d[i + 1]! < 80) n++;
    return n;
  }, layerId);
}

test.describe('#1767 — WebGL thumbnail reads wait on a fence, not the GPU', () => {
  test('stroke and undo update the thumbnail through pack-buffer reads', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires the desktop sidebar');
    test.skip(isWgpu, 'wgpu reads are already asynchronous');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
    const layerId = await addLayer(page);
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 120);
    await setForegroundColor(page, 255, 0, 0);
    await installReadLog(page);

    const a = await docToScreen(page, 100, 300);
    const b = await docToScreen(page, 700, 300);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => thumbnailRedPixels(page, layerId), { timeout: 15_000 }).toBeGreaterThan(20);
    const afterStroke = await takeThumbnailReads(page);
    expect(afterStroke.length).toBeGreaterThan(0);
    expect(afterStroke.every((r) => r.isPackBuffer)).toBe(true);

    await page.keyboard.press('Control+z');
    await expect.poll(() => thumbnailRedPixels(page, layerId), { timeout: 15_000 }).toBe(0);
    const afterUndo = await takeThumbnailReads(page);
    expect(afterUndo.length).toBeGreaterThan(0);
    expect(afterUndo.every((r) => r.isPackBuffer)).toBe(true);
  });
});
