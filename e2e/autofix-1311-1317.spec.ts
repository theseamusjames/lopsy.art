/**
 * #1311 — at fit zoom on a large document, the drawn corner square scales
 *         instead of being swallowed by the rotate handle's hit circle.
 * #1317 — changing a layer's opacity with the keyboard records history.
 */
import { test, expect, type Page } from './fixtures';
import {
  addLayer,
  createDocument,
  docToScreen,
  drawRect,
  getEditorState,
  getPixelAt,
  selectTool,
  waitForStore,
} from './helpers';

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

test.describe('#1317 keyboard opacity change records history', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs a keyboard');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('arrow keys on the opacity slider are undoable on their own', async ({ page }) => {
    const layerId = await addLayer(page);
    await drawRect(page, 0, 0, 400, 300, { r: 255, g: 0, b: 0 });
    expect((await getPixelAt(page, 200, 150, layerId)).r).toBe(255);

    const row = page.locator(`[data-layer-id="${layerId}"]`);
    await row.locator('button[aria-label*="Opacity"]').click();
    const slider = page.locator('input[type="range"][aria-label$=" opacity"]');
    await slider.waitFor({ state: 'visible' });
    await slider.focus();
    const before = await historyLabels(page);
    for (let i = 0; i < 10; i++) await slider.press('ArrowLeft');
    expect(await layerOpacity(page, layerId)).toBeCloseTo(0.9, 5);

    const after = await historyLabels(page);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.at(-1)).toBe('Change Opacity');

    await row.locator('button[aria-label*="Opacity"]').click();
    await page.locator('[data-testid="canvas-container"]').focus();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // Only the last arrow step is undone; the red fill stays.
    expect(await layerOpacity(page, layerId)).toBeCloseTo(0.91, 5);
    expect((await getPixelAt(page, 200, 150, layerId)).r).toBe(255);
  });
});

test.describe('#1311 corner scale handle at low zoom', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'needs a mouse');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 2400, 3200, false);
  });

  test('pressing the white corner square scales the selection', async ({ page }) => {
    const zoom = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { viewport: { zoom: number } };
      };
      return store.getState().viewport.zoom;
    });
    expect(zoom).toBeLessThan(0.4);

    await selectTool(page, 'marquee-rect');
    const from = await docToScreen(page, 600, 1200);
    const to = await docToScreen(page, 1400, 2000);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    const bounds = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { selection: { bounds: { x: number; y: number; width: number; height: number } } };
      };
      return store.getState().selection.bounds;
    });
    const corner = await docToScreen(page, bounds.x + bounds.width, bounds.y + bounds.height);
    await page.mouse.move(corner.x, corner.y);
    await page.waitForTimeout(100);
    const handle = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { activeTransformHandle: string | null };
      };
      return ui.getState().activeTransformHandle;
    });
    expect(handle).toBe('bottom-right');

    await page.mouse.down();
    await page.mouse.move(corner.x + 60, corner.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/corner-scale-low-zoom-1311.png' });

    const transform = await page.evaluate(() => {
      const ui = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { transform: { scaleX: number; scaleY: number; rotation: number } | null };
      };
      return ui.getState().transform;
    });
    // 60 screen px at ~26% is ~230 doc px on an 800 px box: about 1.29x.
    // Before the fix the press grabbed the rotate handle and the box kept
    // its scale (or turned).
    expect(transform).not.toBeNull();
    expect(transform!.rotation).toBeCloseTo(0, 3);
    expect(transform!.scaleX).toBeGreaterThan(1.15);
    expect(transform!.scaleY).toBeGreaterThan(1.15);
  });
});
