// #1635 — a run of arrow presses on a layer's opacity slider recorded one
// history row per press, so 60 presses evicted every earlier edit from the
// 50-entry undo stack. A key run is now one step, like a mouse drag.
import { test, expect, type Page } from './fixtures';
import { addLayer, createDocument, drawRect, getEditorState, getPixelAt, waitForStore } from './helpers';

async function historyLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { undoStack: Array<{ label: string }> };
    };
    return store.getState().undoStack.map((s) => s.label);
  });
}

async function layerOpacity(page: Page, layerId: string): Promise<number> {
  const state = await getEditorState(page);
  return state.document.layers.find((l) => l.id === layerId)!.opacity;
}

test.describe('#1635 keyboard opacity change is one undo step', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('60 arrow presses push one Change Opacity and keep earlier history', async ({ page }) => {
    const layerId = await addLayer(page);
    await drawRect(page, 0, 0, 400, 300, { r: 255, g: 0, b: 0 });
    const before = await historyLabels(page);

    const row = page.locator(`[data-layer-id="${layerId}"]`);
    await row.locator('button[aria-label*="Opacity"]').click();
    const slider = page.locator('input[type="range"][aria-label$=" opacity"]');
    await slider.waitFor({ state: 'visible' });
    await slider.focus();
    for (let i = 0; i < 60; i++) await slider.press('ArrowLeft');
    expect(await layerOpacity(page, layerId)).toBeCloseTo(0.4, 5);

    const after = await historyLabels(page);
    expect(after).toEqual([...before, 'Change Opacity']);

    // After focus leaves and returns, a new key run is a new step.
    await slider.blur();
    await slider.focus();
    for (let i = 0; i < 5; i++) await slider.press('ArrowRight');
    expect(await historyLabels(page)).toEqual([...before, 'Change Opacity', 'Change Opacity']);

    await row.locator('button[aria-label*="Opacity"]').click();
    await page.locator('[data-testid="canvas-container"]').focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await layerOpacity(page, layerId)).toBeCloseTo(0.4, 5);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    expect(await layerOpacity(page, layerId)).toBeCloseTo(1, 5);
    expect((await getPixelAt(page, 200, 150, layerId)).r).toBe(255);
    await page.screenshot({ path: 'e2e/screenshots/keyboard-opacity-history-1635.png' });
  });
});
