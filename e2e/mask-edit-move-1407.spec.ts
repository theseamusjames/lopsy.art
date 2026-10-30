// #1407 — in layer-mask edit mode, a Move-tool drag (or a transform) of a
// marquee lifted the layer's pixels and committed the mask-edit overlay into
// them, turning the whole layer light blue. The Move tool now refuses to lift
// a selection while a mask is being edited.
import { test, expect, type Page } from './fixtures';
import {
  createDocument,
  docToScreen,
  getEditorState,
  getPixelAt,
  setForegroundColor,
  waitForStore,
} from './helpers';

async function dragMarquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press('m');
  await drag(page, x0, y0, x1, y1);
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  const start = await docToScreen(page, x0, y0);
  const end = await docToScreen(page, x1, y1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function editFill(page: Page): Promise<void> {
  await page.click('button:has-text("Edit")');
  await page.getByRole('menuitem', { name: 'Fill', exact: true }).click();
  await page.waitForTimeout(150);
}

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function layerName(page: Page, layerId: string): Promise<string> {
  return (await getEditorState(page)).document.layers.find((l) => l.id === layerId)!.name;
}

async function rgba(page: Page, x: number, y: number, layerId: string): Promise<number[]> {
  const p = await getPixelAt(page, x, y, layerId);
  return [p.r, p.g, p.b, p.a];
}

test.describe('#1407 — Move in mask edit mode', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'layer panel requires the sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, true);
    await page.waitForSelector('[data-testid="canvas-container"]');
  });

  test('a marquee drag, nudge or Rotate 90° is refused and leaves the layer pixels alone', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 200, 200, 400, 300);
    await editFill(page);
    await page.keyboard.press('Control+d');

    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /^Edit mask for/ }).click();
    await page.waitForTimeout(150);

    await dragMarquee(page, 200, 200, 400, 300);
    const labelsBefore = await historyLabels(page);

    await page.keyboard.press('v');
    await drag(page, 300, 250, 300, 450);
    await expect(page.getByText('Leave mask edit mode to move or transform a selection.').first()).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'Rotate 90° CW', exact: true }).click();
    await page.waitForTimeout(150);

    expect(await historyLabels(page)).toEqual(labelsBefore);

    // Leave mask edit mode, then check the layer's own pixels: the red
    // rectangle is where it was, and the empty area did not pick up the
    // mask overlay's blue.
    await page.keyboard.press('Control+d');
    await page.locator(`[data-layer-id="${layerId}"]`).getByText(await layerName(page, layerId)).click();
    await page.waitForTimeout(150);
    const maskMode = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as { getState: () => { maskMode: string } };
      return ui.getState().maskMode;
    });
    expect(maskMode).toBe('off');

    expect(await rgba(page, 300, 250, layerId)).toEqual([255, 0, 0, 255]);
    expect((await rgba(page, 300, 400, layerId))[3]).toBe(0);
    expect((await rgba(page, 600, 100, layerId))[3]).toBe(0);
  });

  test('a whole-layer drag with no selection still moves the layer, without baking the overlay', async ({ page }) => {
    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await setForegroundColor(page, 255, 0, 0);
    await dragMarquee(page, 200, 200, 400, 300);
    await editFill(page);
    await page.keyboard.press('Control+d');

    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /^Edit mask for/ }).click();
    await page.waitForTimeout(150);

    await page.keyboard.press('v');
    await drag(page, 300, 250, 300, 350);
    expect((await historyLabels(page)).at(-1)).toBe('Move');

    await page.locator(`[data-layer-id="${layerId}"]`).getByText(await layerName(page, layerId)).click();
    await page.waitForTimeout(150);

    expect(await rgba(page, 300, 350, layerId)).toEqual([255, 0, 0, 255]);
    expect((await rgba(page, 300, 250, layerId))[3]).toBe(0);
    expect((await rgba(page, 600, 100, layerId))[3]).toBe(0);
  });
});
