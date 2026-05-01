import { test, expect } from './fixtures';
import {
  waitForStore,
  createDocument,
  getPixelAt,
  drawRect,
  applyFilter,
} from './helpers';

test.describe('Tile / Offset Filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
  });

  test('shifts pixels with wrapping and is undoable', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await drawRect(page, 0, 0, 50, 100, { r: 255, g: 0, b: 0 });

    await page.screenshot({ path: 'e2e/screenshots/tile-offset-before.png' });

    const beforeLeft = await getPixelAt(page, 10, 50);
    expect(beforeLeft.r, 'left half should be red').toBe(255);
    expect(beforeLeft.a, 'left half should be opaque').toBe(255);

    const beforeRight = await getPixelAt(page, 75, 50);
    expect(beforeRight.a, 'right half should be transparent').toBe(0);

    await applyFilter(page, 'Tile / Offset...', {
      'Offset X': 50,
      'Offset Y': 0,
    });

    await page.screenshot({ path: 'e2e/screenshots/tile-offset-after.png' });

    const afterLeft = await getPixelAt(page, 10, 50);
    expect(afterLeft.a, 'left half should now be transparent').toBe(0);

    const afterRight = await getPixelAt(page, 75, 50);
    expect(afterRight.r, 'right half should now be red').toBe(255);
    expect(afterRight.a, 'right half should be opaque').toBe(255);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    const restoredLeft = await getPixelAt(page, 10, 50);
    expect(restoredLeft.r, 'undo restores red on left').toBe(255);
    const restoredRight = await getPixelAt(page, 75, 50);
    expect(restoredRight.a, 'undo restores transparent on right').toBe(0);
  });

  test('vertical offset shifts pixels top-to-bottom', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await drawRect(page, 0, 0, 100, 50, { r: 0, g: 0, b: 255 });

    const beforeTop = await getPixelAt(page, 50, 10);
    expect(beforeTop.b, 'top half should be blue').toBe(255);
    const beforeBottom = await getPixelAt(page, 50, 75);
    expect(beforeBottom.a, 'bottom half should be transparent').toBe(0);

    await applyFilter(page, 'Tile / Offset...', {
      'Offset X': 0,
      'Offset Y': 50,
    });

    const afterTop = await getPixelAt(page, 50, 10);
    expect(afterTop.a, 'top half should now be transparent').toBe(0);

    const afterBottom = await getPixelAt(page, 50, 75);
    expect(afterBottom.b, 'bottom half should now be blue').toBe(255);
    expect(afterBottom.a, 'bottom half should be opaque').toBe(255);
  });

  test('combined XY offset wraps diagonally', async ({ page }) => {
    await createDocument(page, 100, 100, true);

    await drawRect(page, 0, 0, 50, 50, { r: 0, g: 255, b: 0 });

    await page.screenshot({ path: 'e2e/screenshots/tile-offset-diagonal-before.png' });

    const beforeTopLeft = await getPixelAt(page, 10, 10);
    expect(beforeTopLeft.g, 'top-left should be green').toBe(255);
    const beforeBottomRight = await getPixelAt(page, 75, 75);
    expect(beforeBottomRight.a, 'bottom-right should be transparent').toBe(0);

    await applyFilter(page, 'Tile / Offset...', {
      'Offset X': 50,
      'Offset Y': 50,
    });

    await page.screenshot({ path: 'e2e/screenshots/tile-offset-diagonal-after.png' });

    const afterTopLeft = await getPixelAt(page, 10, 10);
    expect(afterTopLeft.a, 'top-left should now be transparent').toBe(0);

    const afterBottomRight = await getPixelAt(page, 75, 75);
    expect(afterBottomRight.g, 'bottom-right should now be green').toBe(255);
    expect(afterBottomRight.a, 'bottom-right should be opaque').toBe(255);
  });
});
