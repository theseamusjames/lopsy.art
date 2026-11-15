/**
 * #985 — every Alt+drag of a marquee selection with the Move tool must
 * stamp a new copy, including the second one made from a copy that is
 * still floating. The move handler reused the live float without looking
 * at Alt, so the second Alt+drag just carried the previous copy along and
 * the canvas ended with two squares instead of three.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createDocument, docToScreen, getPixelAt, selectTool, setForegroundColor, undo, waitForStore } from './helpers';

async function altDrag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const start = await docToScreen(page, from[0], from[1]);
  const end = await docToScreen(page, to[0], to[1]);
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(100);
}

async function isRed(page: Page, x: number, y: number): Promise<boolean> {
  const p = await getPixelAt(page, x, y);
  return p.r > 200 && p.g < 60 && p.b < 60 && p.a > 200;
}

async function isClear(page: Page, x: number, y: number): Promise<boolean> {
  return (await getPixelAt(page, x, y)).a < 10;
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as { __editorStore: { getState: () => { undoStack: Array<{ label: string }> } } }).__editorStore;
    return store.getState().undoStack.map((e) => e.label);
  });
}

test.describe('repeated Alt+drag of a selection (#985)', { tag: '@chromium' }, () => {
  test.beforeEach(async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'requires Chromium WebGL (SwiftShader)');
    test.skip(isMobile, 'requires keyboard modifiers and a mouse');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 300, false);
  });

  test('a second Alt+drag of the floating copy stamps a third square', async ({ page }) => {
    await setForegroundColor(page, 255, 0, 0);
    await selectTool(page, 'marquee-rect');
    const selStart = await docToScreen(page, 50, 100);
    const selEnd = await docToScreen(page, 110, 160);
    await page.mouse.move(selStart.x, selStart.y);
    await page.mouse.down();
    await page.mouse.move(selEnd.x, selEnd.y, { steps: 5 });
    await page.mouse.up();

    await selectTool(page, 'fill');
    const fillPoint = await docToScreen(page, 80, 130);
    await page.mouse.click(fillPoint.x, fillPoint.y);

    await selectTool(page, 'move');
    await altDrag(page, [80, 130], [230, 130]);
    expect(await isRed(page, 80, 130), 'first copy left the original behind').toBe(true);
    expect(await isRed(page, 230, 130), 'first copy floats at x 200').toBe(true);

    await altDrag(page, [230, 130], [380, 130]);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/alt-drag-selection-repeat-after.png' });

    // Squares at x 50-110, 200-260 and 350-410 (y 100-160) on the paint
    // layer, with transparent gaps between them.
    expect(await isRed(page, 80, 130), 'original square').toBe(true);
    expect(await isRed(page, 230, 130), 'first copy stamped at x 200').toBe(true);
    expect(await isRed(page, 380, 130), 'second copy at x 350').toBe(true);
    expect(await isClear(page, 155, 130)).toBe(true);
    expect(await isClear(page, 305, 130)).toBe(true);
    expect(await isClear(page, 450, 130)).toBe(true);

    const labels = await historyLabels(page);
    expect(labels.filter((l) => l === 'Move')).toHaveLength(2);

    // Undo back past the second Alt+drag (and the deselect, if it made
    // an entry): one Move left, and the canvas shows two squares
    // (original + first copy) with the second copy's spot empty again.
    for (let i = 0; i < 3; i++) {
      if ((await historyLabels(page)).filter((l) => l === 'Move').length <= 1) break;
      await undo(page);
      await page.waitForTimeout(100);
    }
    expect((await historyLabels(page)).filter((l) => l === 'Move')).toHaveLength(1);
    expect(await isRed(page, 80, 130)).toBe(true);
    expect(await isRed(page, 230, 130)).toBe(true);
    expect(await isClear(page, 380, 130)).toBe(true);
  });
});
