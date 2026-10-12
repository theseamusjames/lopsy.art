/**
 * #1251 — ⇧⌘-click / ⌥⌘-click on a layer thumbnail replaced the selection
 *         instead of adding the layer's alpha to it or subtracting it.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getEditorState,
  setForegroundColor,
  docToScreen,
  addLayer,
} from './helpers';

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function dragOnCanvas(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 8): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function fillRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): Promise<void> {
  await setForegroundColor(page, rgb[0], rgb[1], rgb[2]);
  await page.keyboard.press('m');
  await dragOnCanvas(page, x0, y0, x1, y1);
  await editFill(page);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(100);
}

async function selectedPixelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { selection: { active: boolean; mask: Uint8ClampedArray | null } };
    };
    const { selection } = store.getState();
    if (!selection.active || !selection.mask) return 0;
    let count = 0;
    for (const v of selection.mask) if (v >= 128) count++;
    return count;
  });
}

async function thumbnailClick(page: Page, layerId: string, modifiers: Array<'Meta' | 'Shift' | 'Alt'>): Promise<void> {
  await page.locator(`[data-layer-id="${layerId}"]`).locator('canvas').first().click({ modifiers });
  await page.waitForTimeout(300);
}

test.describe('Fixes #1251 #1255 #1259 #1262', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'menus and marquee drags need the desktop layout');
    await page.goto('/');
    await waitForStore(page);
  });

  test('#1251 Shift/Alt with ⌘-click on a thumbnail adds and subtracts layer alpha', async ({ page }) => {
    await createDocument(page, 800, 600, true);
    await page.waitForTimeout(200);
    const layer1 = (await getEditorState(page)).document.activeLayerId;
    await fillRect(page, 100, 100, 300, 300, [255, 0, 0]);
    const layer2 = await addLayer(page);
    await fillRect(page, 500, 200, 700, 400, [0, 0, 255]);

    await thumbnailClick(page, layer1, ['Meta']);
    expect(await selectedPixelCount(page)).toBe(200 * 200);

    await thumbnailClick(page, layer2, ['Meta', 'Shift']);
    expect(await selectedPixelCount(page), 'union of both layers').toBe(2 * 200 * 200);

    await thumbnailClick(page, layer1, ['Meta', 'Alt']);
    expect(await selectedPixelCount(page), 'layer 1 subtracted').toBe(200 * 200);
    const bounds = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: unknown } };
      };
      return store.getState().selection.bounds;
    });
    expect(bounds).toMatchObject({ x: 500, y: 200, width: 200, height: 200 });

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await selectedPixelCount(page), 'undo restores the union').toBe(2 * 200 * 200);

    await thumbnailClick(page, layer1, ['Meta']);
    expect(await selectedPixelCount(page), 'plain ⌘-click still replaces').toBe(200 * 200);
  });
});
