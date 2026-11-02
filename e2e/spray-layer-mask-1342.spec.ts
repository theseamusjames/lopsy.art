import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  docToScreen,
  getEditorState,
  setForegroundColor,
  setToolOption,
  undo,
} from './helpers';

/**
 * #1342 — in layer-mask edit mode Spray painted the layer's own pixels
 * (offset by the layer's move) with no history entry, instead of the mask.
 */

async function dragDoc(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  const a = await docToScreen(page, from.x, from.y);
  const b = await docToScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function clickMenu(page: Page, menu: string, item: string): Promise<void> {
  await page.click(`button:has-text("${menu}")`);
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(150);
}

async function layerHash(page: Page, layerId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const read = (window as unknown as Record<string, unknown>).__readLayerPixels as
      (id?: string) => Promise<{ width: number; pixels: number[] } | null>;
    const result = await read(id);
    if (!result) return 0;
    let hash = result.width;
    for (const v of result.pixels) hash = (Math.imul(hash, 31) + v) | 0;
    return hash;
  }, layerId);
}

/** Number of mask bytes below full white (i.e. hiding some of the layer). */
async function hiddenMaskBytes(page: Page, layerId: string): Promise<number> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; mask: { data: Uint8ClampedArray } | null }> } };
    };
    const mask = store.getState().document.layers.find((l) => l.id === id)?.mask;
    if (!mask) return -1;
    let count = 0;
    for (const v of mask.data) if (v < 250) count++;
    return count;
  }, layerId);
}

async function lastHistoryLabel(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.at(-1)?.label;
  });
}

test.describe('Spray in layer-mask edit mode (#1342)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs the desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await page.waitForTimeout(300);
  });

  test('sprays the mask of a moved layer, with an undoable history row', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;

    await page.keyboard.press('m');
    await dragDoc(page, { x: 100, y: 100 }, { x: 700, y: 500 }, 6);
    await setForegroundColor(page, 0x30, 0x60, 0xc0);
    await clickMenu(page, 'Edit', 'Fill');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(150);

    await page.keyboard.press('v');
    await dragDoc(page, { x: 400, y: 300 }, { x: 440, y: 330 });

    await page.locator('[aria-label="Add Mask"]').click();
    await page.locator('[aria-label="Edit mask for Layer 1"]').click();
    await page.waitForTimeout(150);
    expect(await lastHistoryLabel(page)).toBe('Add Mask');

    await setForegroundColor(page, 0, 0, 0);
    await page.keyboard.press('j');
    await setToolOption(page, 'Size', 80);
    await setToolOption(page, 'Density', 60);

    const pixelsBefore = await layerHash(page, layerId);
    await dragDoc(page, { x: 150, y: 300 }, { x: 600, y: 300 }, 20);

    expect(await lastHistoryLabel(page)).toBe('Mask Paint');
    // The layer's own pixels are untouched; the dots went into the mask.
    expect(await layerHash(page, layerId)).toBe(pixelsBefore);
    await expect.poll(() => hiddenMaskBytes(page, layerId), { timeout: 5000 }).toBeGreaterThan(200);

    await undo(page);
    await page.waitForTimeout(300);
    expect(await lastHistoryLabel(page)).toBe('Add Mask');
    await expect.poll(() => hiddenMaskBytes(page, layerId), { timeout: 5000 }).toBe(0);
    expect(await layerHash(page, layerId)).toBe(pixelsBefore);
  });
});
