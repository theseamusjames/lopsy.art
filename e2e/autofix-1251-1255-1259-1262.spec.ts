/**
 * #1251 — ⇧⌘-click / ⌥⌘-click on a layer thumbnail replaced the selection
 *         instead of adding the layer's alpha to it or subtracting it.
 * #1262 — Shape with Output: Path refused to draw while a text layer was
 *         active, although Path output never writes the layer's pixels.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  getEditorState,
  setForegroundColor,
  docToScreen,
  addLayer,
  selectTool,
  setToolOption,
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

async function typeText(page: Page, x: number, y: number, text: string, size: number): Promise<string> {
  await selectTool(page, 'text');
  await setToolOption(page, 'Size', size);
  const at = await docToScreen(page, x, y);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(150);
  await page.keyboard.type(text);
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  const state = await getEditorState(page);
  const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
  expect(layer?.type).toBe('text');
  return state.document.activeLayerId;
}

async function pathCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { paths: unknown[] };
    };
    return store.getState().paths.length;
  });
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

  test('#1262 Shape with Output: Path draws a path while a text layer is active', async ({ page }) => {
    await createDocument(page, 1000, 1000, false);
    await page.waitForTimeout(200);
    const textId = await typeText(page, 100, 150, 'Hello', 60);
    const textBefore = await page.evaluate(async (id) => {
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ pixels: number[] }>;
      return Array.from((await read(id)).pixels);
    }, textId);

    await selectTool(page, 'shape');
    await page.locator('select[aria-labelledby="shape-mode-label"]').selectOption('ellipse');
    await page.locator('select[aria-labelledby="shape-output-label"]').selectOption('path');
    expect(await pathCount(page)).toBe(0);
    await dragOnCanvas(page, 500, 600, 700, 800, 10);
    await page.waitForTimeout(200);

    await expect(page.getByText('Text layers must be rasterized')).toHaveCount(0);
    expect(await pathCount(page), 'circle path added').toBe(1);
    const state = await getEditorState(page);
    expect(state.document.activeLayerId).toBe(textId);
    const textAfter = await page.evaluate(async (id) => {
      const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
        (id?: string) => Promise<{ pixels: number[] }>;
      return Array.from((await read(id)).pixels);
    }, textId);
    expect(textAfter.length).toBe(textBefore.length);
    expect(textAfter.every((v, i) => v === textBefore[i]), 'text layer pixels untouched').toBe(true);

    // Pixel output on a text layer is still refused.
    await page.locator('select[aria-labelledby="shape-output-label"]').selectOption('pixels');
    await dragOnCanvas(page, 200, 600, 400, 800, 10);
    await expect(page.getByText('Text layers must be rasterized').first()).toBeVisible();
    expect(await pathCount(page)).toBe(1);
  });
});
