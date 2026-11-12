/**
 * #1628 — clicking Add Mask left the layer pixels as the paint target, so
 * the next brush stroke painted onto the artwork instead of the new mask.
 * Add Mask now enters mask edit mode, exactly like clicking the mask
 * thumbnail.
 */
import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  setForegroundColor,
  setToolOption,
  docToScreen,
  getEditorState,
  getPixelAt,
} from './helpers';

async function dragOnDoc(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 8): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(100);
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

async function lastHistoryLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    const stack = store.getState().undoStack;
    return stack[stack.length - 1]?.label ?? '';
  });
}

test.describe('#1628 — Add Mask makes the mask the edit target', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 600, 400, false);
    await page.waitForSelector('[data-testid="canvas-container"]');
    await page.waitForTimeout(200);
  });

  test('a brush stroke after Add Mask paints the mask, not the layer', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;

    await page.keyboard.press('m');
    await dragOnDoc(page, 100, 100, 500, 300);
    await setForegroundColor(page, 0, 0, 255);
    await page.click('button:has-text("Edit")');
    await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(100);

    await page.locator('[aria-label="Add Mask"]').click();
    await page.waitForTimeout(100);

    // The mask thumbnail is highlighted as the edit target.
    const maskThumb = page.locator('[aria-label="Edit mask for Layer 1"]');
    await expect(maskThumb).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('b');
    await setToolOption(page, 'Size', 60);
    await setForegroundColor(page, 0, 0, 0);
    await dragOnDoc(page, 120, 200, 480, 200, 20);

    expect(await lastHistoryLabel(page)).toBe('Mask Paint');
    const px = await getPixelAt(page, 300, 200, layerId);
    expect([px.r, px.g, px.b, px.a]).toEqual([0, 0, 255, 255]);
    await expect.poll(() => maskByteAt(page, layerId, 300, 200), { timeout: 15_000 }).toBeLessThan(40);
    expect(await maskByteAt(page, layerId, 300, 120)).toBe(255);

    // Undo of Add Mask leaves mask edit mode again; the layer row is plain.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(page.locator('[aria-label="Add Mask"]')).toBeVisible();
    await expect(maskThumb).toHaveCount(0);
  });
});
