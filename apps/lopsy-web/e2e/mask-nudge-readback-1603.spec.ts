import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  setForegroundColor,
} from './helpers';

/**
 * #1603 — holding an arrow key with the Move tool on a layer with a mask read
 * the whole mask back from the GPU on almost every key-repeat frame: each
 * nudge frame translated the mask and scheduled a JS refresh, which fired
 * between repeats. A hold now carries the mask on the GPU and refreshes the
 * JS bytes once, when the key comes up.
 *
 * Setup on a 2048² white document: a red card at x 200–1199 on Layer 1 and a
 * mask that hides x 200–699.
 */

const DOC = 2048;
const REPEATS = 12;
const ROW = 600;

interface GlRead { w: number; h: number }
interface GlLog { __reads: GlRead[]; __isLogging: boolean }

async function installReadProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as GlLog;
    w.__reads = [];
    w.__isLogging = false;
    const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const read = proto.readPixels!;
    proto.readPixels = function (this: unknown, ...args: unknown[]) {
      if (w.__isLogging) w.__reads.push({ w: Number(args[2]), h: Number(args[3]) });
      return read.apply(this, args);
    };
  });
}

/** Start (or restart) logging; returns the reads logged since the last call. */
async function takeLog(page: Page, isLogging: boolean): Promise<GlRead[]> {
  return page.evaluate((on) => {
    const w = window as unknown as GlLog;
    const out = w.__reads;
    w.__reads = [];
    w.__isLogging = on;
    return out;
  }, isLogging);
}

function docSized(reads: GlRead[]): GlRead[] {
  return reads.filter((r) => r.w === DOC && r.h === DOC);
}

async function dragDoc(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function editFill(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Application menu"]').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[role="menu"][aria-label="Edit"]').getByRole('menuitem', { name: /^Fill(\s*⇧F5)?$/ }).click();
  await page.waitForTimeout(200);
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

async function layerX(page: Page, layerId: string): Promise<number> {
  const state = await getEditorState(page);
  return state.document.layers.find((l) => l.id === layerId)!.x;
}

test.describe('Held arrow nudge of a masked layer (#1603)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop menu bar and layers panel');
    await installReadProbe(page);
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, DOC, DOC, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(300);
  });

  test('reads the mask back once, after the key comes up, and the mask moves with the layer', async ({ page }) => {
    test.setTimeout(120_000);
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    await page.keyboard.press('m');
    await dragDoc(page, 200, 200, 1200, 1200);
    await editFill(page);
    await page.keyboard.press('Control+d');

    // Add Mask makes the mask the edit target.
    await page.locator('[aria-label="Add Mask"]').click();
    await page.waitForTimeout(100);
    await dragDoc(page, 200, 200, 700, 1200);
    await setForegroundColor(page, 0, 0, 0);
    await editFill(page);
    await page.keyboard.press('Control+d');
    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await page.waitForTimeout(150);
    await expect.poll(() => maskByteAt(page, layerId, 690, ROW), { timeout: 20_000 }).toBe(0);
    expect(await maskByteAt(page, layerId, 705, ROW)).toBe(255);

    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    const startX = await layerX(page, layerId);

    await takeLog(page, true);
    // keyboard.down on a key already held sends repeat: true, like OS auto-repeat.
    for (let i = 0; i < REPEATS; i++) {
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(60);
    }
    const duringHold = await takeLog(page, true);
    await page.keyboard.up('ArrowRight');

    // The mask follows the layer: the hidden edge moved from x 700 to 712.
    await expect.poll(() => maskByteAt(page, layerId, 705, ROW), { timeout: 20_000 }).toBe(0);
    await page.waitForTimeout(500);
    const afterRelease = await takeLog(page, false);
    expect(await layerX(page, layerId)).toBe(startX + REPEATS);
    expect(await maskByteAt(page, layerId, 710, ROW)).toBe(0);
    expect(await maskByteAt(page, layerId, 714, ROW)).toBe(255);

    expect(docSized(duringHold)).toEqual([]);
    expect(docSized(afterRelease).length).toBeLessThanOrEqual(1);

    // Undo puts the mask back with the layer.
    await page.keyboard.press('Control+z');
    await expect.poll(() => layerX(page, layerId), { timeout: 10_000 }).toBe(startX);
    await expect.poll(() => maskByteAt(page, layerId, 705, ROW), { timeout: 20_000 }).toBe(255);
    expect(await maskByteAt(page, layerId, 690, ROW)).toBe(0);
  });
});
