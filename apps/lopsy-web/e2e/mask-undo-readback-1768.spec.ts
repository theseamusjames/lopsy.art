import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, docToScreen, setToolOption, setForegroundColor, getEditorState } from './helpers';

/**
 * #1768 — undoing mask strokes painted in quick succession read the whole
 * mask back from the GPU after almost every undo step: each stroke's lazy
 * read had not landed when the next began, so its history entry was marked
 * stale, and every restore queued a fresh full-mask read that fired ~2
 * frames later, straight into the next step's GPU backlog.
 *
 * The read now waits until undo/redo has been quiet for a moment, so a held
 * Cmd+Z makes no full-mask reads while it repeats and one per mask after.
 * The test counts `readPixels` calls the size of the whole mask, which is
 * hardware-independent.
 */

const DOC_W = 800;
const DOC_H = 600;

async function installReadLog(page: Page): Promise<void> {
  await page.evaluate(({ w, h }) => {
    const win = window as unknown as { __fullReads: number[] };
    win.__fullReads = [];
    const proto = WebGL2RenderingContext.prototype;
    const original = proto.readPixels;
    proto.readPixels = function patched(this: WebGL2RenderingContext, ...args: unknown[]) {
      if (Number(args[2]) * Number(args[3]) >= w * h) win.__fullReads.push(performance.now());
      return (original as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.readPixels;
  }, { w: DOC_W, h: DOC_H });
}

async function fullReadsSince(page: Page, since: number): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __fullReads: number[] }).__fullReads.filter((x) => x >= t).length, since);
}

async function maskByteAt(page: Page, layerId: string, x: number, y: number): Promise<number> {
  return page.evaluate(({ lid, x, y }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray; width: number } | null }> } };
    };
    const mask = store.getState().document.layers.find((l) => l.id === lid)?.mask;
    if (!mask) return -1;
    return mask.data[y * mask.width + x] ?? -1;
  }, { lid: layerId, x, y });
}

async function stroke(page: Page, y: number): Promise<void> {
  const a = await docToScreen(page, 100, y);
  const b = await docToScreen(page, 700, y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}

test.describe('#1768 — held undo over mask strokes', () => {
  test('reads the mask back once the undo burst ends, not on each step', async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires the desktop sidebar');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC_W, DOC_H, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
    const layerId = (await getEditorState(page)).document.activeLayerId!;

    await page.locator('[aria-label="Add Mask"]').click();
    await expect(page.locator('[aria-label^="Edit mask for"]').first()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 40);
    await setForegroundColor(page, 0, 0, 0);

    // Four strokes in quick succession: each begins before the previous
    // stroke's lazy read lands, so every history entry is marked stale.
    const rows = [150, 250, 350, 450];
    for (const y of rows) await stroke(page, y);
    await expect.poll(() => maskByteAt(page, layerId, 400, 450), { timeout: 20_000 }).toBeLessThan(40);
    await page.waitForTimeout(1500);
    await installReadLog(page);

    const start = await page.evaluate(() => performance.now());
    for (let i = 0; i < rows.length; i++) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(250);
    expect(await fullReadsSince(page, start), 'full-mask reads while undo repeats').toBe(0);

    // Once undo goes quiet the JS bytes catch up with one read.
    await expect.poll(() => maskByteAt(page, layerId, 400, 150), { timeout: 20_000 }).toBe(255);
    expect(await maskByteAt(page, layerId, 400, 450)).toBe(255);
    expect(await fullReadsSince(page, start)).toBeLessThanOrEqual(1);
  });
});
