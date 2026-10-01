/**
 * A Move-tool drag of a marquee selection leaves the lifted pixels floating
 * after release, so a follow-up drag keeps moving the same piece. Whatever
 * the user does next — edit the pixels, change the selection, switch layer,
 * remove the layer, pick another tool, nudge after an undo — must act on
 * what is on screen, without a ⌘D first.
 *
 * Each test below used to fail on main: the next drag re-composited the
 * stale float (dropping a Fill / bringing back a Cut), moved the old piece
 * instead of the new selection, moved pixels on the previous layer, threw
 * `Layer texture not found` after Merge Down, turned a Marquee press into a
 * drag of a whole-layer outline, or threw `No float base` on arrow keys.
 */
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  getPixelAt,
  selectTool,
  setForegroundColor,
  waitForStore,
} from './helpers';

type Rect = { x: number; y: number; width: number; height: number };

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const start = await docToScreen(page, from[0], from[1]);
  const end = await docToScreen(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function marquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await selectTool(page, 'marquee-rect');
  await drag(page, [x0, y0], [x1, y1]);
}

async function menuItem(page: Page, menu: string, item: string): Promise<void> {
  await page.getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

/** A black block on the active layer, filled through a marquee. */
async function blackBlock(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await setForegroundColor(page, 0, 0, 0);
  await marquee(page, x0, y0, x1, y1);
  await menuItem(page, 'Edit', 'Fill');
}

async function selectionBounds(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; bounds: Rect | null } };
    };
    const sel = store.getState().selection;
    return sel.active ? sel.bounds : null;
  });
}

async function activeLayerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string } };
    };
    return store.getState().document.activeLayerId;
  });
}

async function colorAt(page: Page, x: number, y: number, layerId?: string): Promise<'black' | 'red' | 'clear' | 'other'> {
  const p = await getPixelAt(page, x, y, layerId);
  if (p.a < 10) return 'clear';
  if (p.r > 200 && p.g < 60 && p.b < 60) return 'red';
  if (p.r < 40 && p.g < 40 && p.b < 40) return 'black';
  return 'other';
}

/** Pixels in the rect on the active layer whose alpha is above `minAlpha`. */
async function opaqueCount(page: Page, x0: number, y0: number, x1: number, y1: number, minAlpha = 0): Promise<number> {
  return page.evaluate(async ({ x0, y0, x1, y1, minAlpha }) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number; y: number }> } };
    };
    const doc = store.getState().document;
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; height: number; pixels: number[] }>;
    const img = await read(doc.activeLayerId);
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const lx = x - (layer?.x ?? 0);
        const ly = y - (layer?.y ?? 0);
        if (lx < 0 || ly < 0 || lx >= img.width || ly >= img.height) continue;
        if ((img.pixels[(ly * img.width + lx) * 4 + 3] ?? 0) > minAlpha) count++;
      }
    }
    return count;
  }, { x0, y0, x1, y1, minAlpha });
}

/**
 * Drag the top-right rotation handle of an unrotated box by `degrees` about
 * its centre. The handle sits 20 px out from the corner before any scale, so
 * `scale` times that after one.
 */
async function rotateBox(page: Page, box: Rect, degrees: number, scale = 1): Promise<void> {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hx = box.x + box.width + 20 * scale;
  const hy = box.y - 20 * scale;
  const radius = Math.hypot(hx - cx, hy - cy);
  const start = Math.atan2(hy - cy, hx - cx);
  const first = await docToScreen(page, hx, hy);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    const a = start + (degrees * Math.PI / 180) * (i / 15);
    const p = await docToScreen(page, cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe('follow-up actions on a live Move float', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'requires a mouse and keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, true);
  });

  test('a Fill made while the piece floats moves with it on the next drag', async ({ page }) => {
    await blackBlock(page, 40, 40, 140, 120);
    await selectTool(page, 'move');
    await drag(page, [90, 80], [150, 80]);
    expect(await colorAt(page, 160, 80)).toBe('black');

    // The selection now frames the block at x 100-200; fill it red.
    await setForegroundColor(page, 255, 0, 0);
    await menuItem(page, 'Edit', 'Fill');
    expect(await colorAt(page, 160, 80)).toBe('red');

    await selectTool(page, 'move');
    await drag(page, [150, 80], [180, 80]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-fill-then-drag.png' });

    // The red block now spans x 130-230: red inside, nothing black anywhere.
    expect(await colorAt(page, 135, 80)).toBe('red');
    expect(await colorAt(page, 225, 80)).toBe('red');
    expect(await colorAt(page, 115, 80)).toBe('clear');
    expect(await colorAt(page, 235, 80)).toBe('clear');
  });

  test('a Cut made while the piece floats stays cut after the next drag', async ({ page }) => {
    await blackBlock(page, 40, 40, 140, 120);
    await selectTool(page, 'move');
    await drag(page, [90, 80], [150, 80]);

    await page.keyboard.press('Control+x');
    await page.waitForTimeout(150);
    expect(await colorAt(page, 150, 80)).toBe('clear');

    await drag(page, [150, 80], [180, 80]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-cut-then-drag.png' });
    for (const x of [60, 120, 160, 200]) {
      expect(await colorAt(page, x, 80), `x ${x}`).toBe('clear');
    }
  });

  test('Inverse after a drag makes the next drag move the rest of the layer', async ({ page }) => {
    await blackBlock(page, 40, 40, 100, 100);
    await blackBlock(page, 250, 40, 310, 100);
    await marquee(page, 30, 30, 110, 110);
    await selectTool(page, 'move');
    await drag(page, [70, 70], [130, 70]);
    expect(await colorAt(page, 150, 70)).toBe('black');

    await page.keyboard.press('Control+Shift+i');
    await page.waitForTimeout(150);
    await drag(page, [280, 70], [280, 130]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-inverse-then-drag.png' });

    // The first block stays at x 100-160, y 40-100; the second block moves
    // down to y 100-160.
    expect(await colorAt(page, 130, 50)).toBe('black');
    expect(await colorAt(page, 130, 130)).toBe('clear');
    expect(await colorAt(page, 280, 50)).toBe('clear');
    expect(await colorAt(page, 280, 130)).toBe('black');
  });

  test('Select All after a drag makes the next drag move everything', async ({ page }) => {
    await blackBlock(page, 40, 40, 100, 100);
    await blackBlock(page, 250, 40, 310, 100);
    await marquee(page, 30, 30, 110, 110);
    await selectTool(page, 'move');
    await drag(page, [70, 70], [130, 70]);

    await page.keyboard.press('Control+a');
    await page.waitForTimeout(150);
    await drag(page, [200, 200], [200, 230]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-select-all-then-drag.png' });

    // Both blocks moved down 30: y 70-130.
    expect(await colorAt(page, 130, 50)).toBe('clear');
    expect(await colorAt(page, 130, 120)).toBe('black');
    expect(await colorAt(page, 280, 50)).toBe('clear');
    expect(await colorAt(page, 280, 120)).toBe('black');
    const sel = await selectionBounds(page);
    expect(sel?.width).toBe(400);
    expect(sel?.height).toBe(300);
  });

  test('Add Layer after a drag leaves the floated piece where it was', async ({ page }) => {
    await blackBlock(page, 40, 40, 140, 120);
    const firstLayer = await activeLayerId(page);
    await selectTool(page, 'move');
    await drag(page, [90, 80], [150, 80]);

    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(150);
    const newLayer = await activeLayerId(page);
    expect(newLayer).not.toBe(firstLayer);

    await drag(page, [150, 80], [150, 110]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-add-layer-then-drag.png' });

    // The block on the first layer stays at x 100-200, y 40-120.
    expect(await colorAt(page, 150, 45, firstLayer)).toBe('black');
    expect(await colorAt(page, 150, 135, firstLayer)).toBe('clear');
    expect(await colorAt(page, 150, 80, newLayer)).toBe('clear');
  });

  test('a drag after Merge Down moves the merged pixels', async ({ page }) => {
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(150);
    await blackBlock(page, 40, 40, 140, 120);
    await selectTool(page, 'move');
    await drag(page, [90, 80], [150, 80]);

    await menuItem(page, 'Layer', 'Merge Down');
    const merged = await activeLayerId(page);
    expect(await colorAt(page, 150, 80, merged)).toBe('black');

    // The marquee still frames the block at x 100-200, y 40-120.
    await selectTool(page, 'move');
    await drag(page, [150, 80], [150, 110]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-merge-down-then-drag.png' });

    expect(await colorAt(page, 150, 50, merged)).toBe('clear');
    expect(await colorAt(page, 150, 145, merged)).toBe('black');
  });

  test('a drag after Delete Layer moves the remaining layer', async ({ page }) => {
    await blackBlock(page, 40, 40, 140, 120);
    const bottom = await activeLayerId(page);
    await page.locator('[aria-label="Add Layer"]').click();
    await page.waitForTimeout(150);
    await blackBlock(page, 40, 150, 140, 200);
    await marquee(page, 30, 140, 150, 210);
    await selectTool(page, 'move');
    // Up 100: the marquee ends at x 30-150, y 40-110, over the bottom block.
    await drag(page, [90, 175], [90, 75]);

    await page.locator('[aria-label="Delete Layer"]').click();
    await page.waitForTimeout(150);
    expect(await activeLayerId(page)).toBe(bottom);

    await drag(page, [90, 80], [90, 110]);
    await page.screenshot({ path: 'e2e/screenshots/move-float-delete-layer-then-drag.png' });

    // The bottom block's selected part (y 40-110) moved down to y 70-140.
    expect(await colorAt(page, 90, 50, bottom)).toBe('clear');
    expect(await colorAt(page, 90, 135, bottom)).toBe('black');
  });

  test('a Marquee drag after a Move drag starts a new selection', async ({ page }) => {
    await blackBlock(page, 0, 0, 400, 300);
    await page.keyboard.press('Control+d');
    await marquee(page, 140, 100, 260, 200);
    await selectTool(page, 'move');
    await drag(page, [200, 150], [260, 150]);

    await marquee(page, 20, 20, 80, 80);
    expect(await selectionBounds(page)).toEqual({ x: 20, y: 20, width: 60, height: 60 });
  });

  test('another tool keeps the moved marquee instead of selecting the whole layer', async ({ page }) => {
    await blackBlock(page, 0, 0, 400, 300);
    await page.keyboard.press('Control+d');
    await marquee(page, 140, 100, 260, 200);
    await selectTool(page, 'move');
    await drag(page, [200, 150], [260, 150]);
    expect(await selectionBounds(page)).toEqual({ x: 200, y: 100, width: 120, height: 100 });

    await selectTool(page, 'eyedropper');
    const p = await docToScreen(page, 30, 30);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(100);
    expect(await selectionBounds(page)).toEqual({ x: 200, y: 100, width: 120, height: 100 });
  });

  test('scaling right after a drag scales only the moved piece', async ({ page }) => {
    await blackBlock(page, 40, 40, 100, 100);
    await blackBlock(page, 250, 40, 310, 100);
    await marquee(page, 40, 40, 100, 100);
    await selectTool(page, 'move');
    await drag(page, [70, 70], [130, 70]);

    // Drag the bottom-right handle (160, 100) out to (190, 130): 90 x 90.
    await drag(page, [160, 100], [190, 130]);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/move-float-move-then-scale.png' });

    expect(await colorAt(page, 180, 120)).toBe('black');
    // The second block is untouched: x 250-310, y 40-100.
    expect(await colorAt(page, 252, 42)).toBe('black');
    expect(await colorAt(page, 308, 98)).toBe('black');
    expect(await colorAt(page, 245, 70)).toBe('clear');
    expect(await colorAt(page, 315, 70)).toBe('clear');
    expect(await colorAt(page, 280, 105)).toBe('clear');
  });

  test('Delete after a Move drag clears only the moved piece', async ({ page }) => {
    await blackBlock(page, 0, 0, 400, 300);
    await page.keyboard.press('Control+d');
    await marquee(page, 140, 100, 260, 200);
    await selectTool(page, 'move');
    await drag(page, [200, 150], [260, 150]);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/move-float-delete-after-drag.png' });

    // The hole the drag left (x 140-200) and the moved piece (x 200-320)
    // are clear; the rest of the layer is untouched.
    expect(await colorAt(page, 150, 150)).toBe('clear');
    expect(await colorAt(page, 300, 150)).toBe('clear');
    expect(await colorAt(page, 30, 30)).toBe('black');
    expect(await colorAt(page, 380, 280)).toBe('black');
    expect(await colorAt(page, 260, 90)).toBe('black');
    expect(await selectionBounds(page)).toEqual({ x: 200, y: 100, width: 120, height: 100 });
  });

  test('Delete after rotating a piece clears just that piece', async ({ page }) => {
    await blackBlock(page, 40, 40, 100, 100);
    await blackBlock(page, 250, 40, 310, 100);
    await marquee(page, 40, 40, 100, 100);
    await selectTool(page, 'move');
    await rotateBox(page, { x: 40, y: 40, width: 60, height: 60 }, 30);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/move-float-delete-after-rotate.png' });

    expect(await opaqueCount(page, 0, 0, 160, 160)).toBe(0);
    expect(await opaqueCount(page, 250, 40, 310, 100)).toBe(3600);
  });

  test('a Fill after rotating a piece fills the rotated outline', async ({ page }) => {
    // The fill's marquee stays up around the block.
    await blackBlock(page, 40, 40, 100, 100);
    await selectTool(page, 'move');
    await rotateBox(page, { x: 40, y: 40, width: 60, height: 60 }, 30);

    await setForegroundColor(page, 255, 0, 0);
    await menuItem(page, 'Edit', 'Fill');
    await page.screenshot({ path: 'e2e/screenshots/move-float-fill-after-rotate.png' });

    // The centre is red; the unrotated square's corner, outside the turned
    // square, stays clear.
    expect(await colorAt(page, 70, 70)).toBe('red');
    expect(await colorAt(page, 42, 42)).toBe('clear');
    expect(await colorAt(page, 98, 42)).toBe('clear');

    // A drag afterwards carries the red square along.
    await selectTool(page, 'move');
    await drag(page, [70, 70], [170, 170]);
    expect(await colorAt(page, 170, 170)).toBe('red');
    // Only the anti-aliased rim the soft-edged selection didn't fully take
    // (alpha ≤ 25%) can stay behind.
    expect(await opaqueCount(page, 0, 0, 120, 120, 64)).toBe(0);
  });

  test('move, scale and rotate a piece in one go', async ({ page }) => {
    await blackBlock(page, 40, 40, 100, 100);
    await blackBlock(page, 250, 40, 310, 100);
    await marquee(page, 40, 40, 100, 100);
    await selectTool(page, 'move');
    await drag(page, [70, 70], [130, 130]);
    // Box now at x 100-160, y 100-160. Bottom-right handle out by 30: 90 x 90.
    await drag(page, [160, 160], [190, 190]);
    await rotateBox(page, { x: 100, y: 100, width: 90, height: 90 }, 45, 1.5);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'e2e/screenshots/move-float-move-scale-rotate.png' });

    // A 90 x 90 square turned 45 degrees about (145, 145): solid at the
    // centre and on the diagonal tips, clear in the box corners.
    expect(await colorAt(page, 145, 145)).toBe('black');
    expect(await colorAt(page, 145, 85)).toBe('black');
    expect(await colorAt(page, 205, 145)).toBe('black');
    expect(await colorAt(page, 104, 104)).toBe('clear');
    expect(await colorAt(page, 186, 186)).toBe('clear');
    // ~8100 px of area, nothing left at the start position or on block 2.
    const count = await opaqueCount(page, 60, 60, 240, 240);
    expect(count).toBeGreaterThan(7600);
    expect(count).toBeLessThan(8700);
    expect(await opaqueCount(page, 30, 30, 90, 90)).toBeLessThan(10);
    expect(await opaqueCount(page, 250, 40, 310, 100)).toBe(3600);
  });
});
