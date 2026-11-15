/**
 * #1223: the Move tool re-measured an upright text layer's frame — a full
 * glyph rasterization, just to read its render offset — on every
 * pointer-move, because the measurement was cached per layer object and a
 * move replaces the object. It is now cached by the layer's props, so a
 * moved layer reuses the offset. These tests drag and nudge a multi-line
 * text block and check that its transform handles follow it exactly while
 * the engine is never asked to measure the offset again.
 */
import { test, expect, type Page } from './fixtures';
import { createDocument, docToScreen, selectTool, setForegroundColor, setToolOption, waitForStore } from './helpers';

interface TextSnapshot {
  x: number;
  y: number;
  hasTransform: boolean;
}

async function textLayer(page: Page): Promise<TextSnapshot> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ type: string; x: number; y: number; transform?: unknown }> } };
    };
    const l = store.getState().document.layers.find((layer) => layer.type === 'text')!;
    return { x: l.x, y: l.y, hasTransform: l.transform !== undefined };
  });
}

async function measureCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const count = (window as unknown as Record<string, unknown>).__textFrameOffsetMeasureCount as () => number;
    return count();
  });
}

async function handleAt(page: Page, docX: number, docY: number): Promise<string | null> {
  const at = await docToScreen(page, docX, docY);
  await page.mouse.move(at.x, at.y);
  return page.evaluate(() => {
    const ui = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => { activeTransformHandle: string | null };
    };
    return ui.getState().activeTransformHandle;
  });
}

/** Document bounds of the text layer's opaque pixels. */
async function inkBounds(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return page.evaluate(async () => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; x: number; y: number }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.type === 'text')!;
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as (
      id: string,
    ) => Promise<{ width: number; height: number; pixels: number[] }>;
    const px = await read(layer.id);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 128) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return { left: layer.x + left, top: layer.y + top, right: layer.x + right, bottom: layer.y + bottom };
  });
}

const ANCHOR_X = 200;
const ANCHOR_Y = 150;

test.describe('Moving upright text reuses its measured frame (#1223)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'options bar needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);

    await setForegroundColor(page, 0, 0, 0);
    await selectTool(page, 'text');
    await setToolOption(page, 'Size', 40);
    const at = await docToScreen(page, ANCHOR_X, ANCHOR_Y);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(200);
    await page.keyboard.type('Moving text');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('third');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await selectTool(page, 'move');
  });

  test('a Move drag keeps the handles on the text without re-measuring it', async ({ page }) => {
    // The layout box's top-left corner is the click anchor.
    expect(await handleAt(page, ANCHOR_X, ANCHOR_Y)).toBe('top-left');
    const before = await textLayer(page);
    const inkBefore = await inkBounds(page);
    const measuredBefore = await measureCount(page);
    expect(measuredBefore).toBeGreaterThan(0);

    const grab = { x: (inkBefore.left + inkBefore.right) / 2, y: (inkBefore.top + inkBefore.bottom) / 2 };
    const from = await docToScreen(page, grab.x, grab.y);
    const to = await docToScreen(page, grab.x + 150, grab.y + 90);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/text-move-frame-cache-1223.png' });

    const after = await textLayer(page);
    expect(after.hasTransform).toBe(false);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    expect(dx).toBeGreaterThan(140);
    expect(dy).toBeGreaterThan(80);

    // The glyphs moved with the layer…
    const inkAfter = await inkBounds(page);
    expect(inkAfter.left - inkBefore.left).toBe(dx);
    expect(inkAfter.top - inkBefore.top).toBe(dy);

    // …and the handles followed them: the corner is at the moved anchor.
    expect(await handleAt(page, ANCHOR_X + dx, ANCHOR_Y + dy)).toBe('top-left');
    expect(await handleAt(page, ANCHOR_X, ANCHOR_Y)).not.toBe('top-left');

    // Twenty pointer-moves, every overlay frame and the hovers above all
    // reused the offset measured before the drag.
    expect(await measureCount(page)).toBe(measuredBefore);
  });

  test('arrow nudges move the handles without re-measuring the text', async ({ page }) => {
    expect(await handleAt(page, ANCHOR_X, ANCHOR_Y)).toBe('top-left');
    const before = await textLayer(page);
    const measuredBefore = await measureCount(page);

    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const after = await textLayer(page);
    expect(after.x - before.x).toBe(6);
    expect(after.y - before.y).toBe(3);
    expect(await handleAt(page, ANCHOR_X + 6, ANCHOR_Y + 3)).toBe('top-left');
    expect(await measureCount(page)).toBe(measuredBefore);
  });

  test('undoing a move puts the handles back on the original anchor', async ({ page }) => {
    const before = await textLayer(page);
    const ink = await inkBounds(page);
    const grab = { x: (ink.left + ink.right) / 2, y: (ink.top + ink.bottom) / 2 };
    const from = await docToScreen(page, grab.x, grab.y);
    const to = await docToScreen(page, grab.x + 100, grab.y + 50);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const moved = await textLayer(page);
    expect(moved.x - before.x).toBeGreaterThan(90);
    const measuredBefore = await measureCount(page);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    expect(await textLayer(page)).toEqual(before);
    expect(await handleAt(page, ANCHOR_X, ANCHOR_Y)).toBe('top-left');
    expect(await handleAt(page, ANCHOR_X + moved.x - before.x, ANCHOR_Y + moved.y - before.y)).not.toBe('top-left');
    expect(await measureCount(page)).toBe(measuredBefore);
  });
});
