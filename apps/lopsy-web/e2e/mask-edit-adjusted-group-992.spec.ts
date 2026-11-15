import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  drawRect,
  addAdjustment,
  closeEffectsPanel,
  getEditorState,
  docToScreen,
  selectTool,
} from './helpers';

/**
 * Regression test for #992: editing the mask of a layer inside a group
 * with an enabled adjustment showed neither the blue mask-edit overlay nor
 * any live mask feedback — the canvas stayed uniformly inverted until mask
 * edit was left. The compositor drew the overlay onto the main composite
 * while the child's content went into the group's scratch, so the adjusted
 * scratch blended over the overlay and hid it.
 */

interface PixelResult { r: number; g: number; b: number; a: number }

async function readCompositedAtDoc(page: Page, docX: number, docY: number): Promise<PixelResult> {
  return page.evaluate(async ({ x, y }) => {
    const readFn = (window as unknown as Record<string, unknown>).__readCompositedPixels as
      () => Promise<{ width: number; height: number; pixels: number[] } | null>;
    const result = await readFn();
    if (!result) return { r: 0, g: 0, b: 0, a: 0 };
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => {
        document: { width: number; height: number };
        viewport: { zoom: number; panX: number; panY: number };
      };
    };
    const state = store.getState();
    const sx = Math.round(
      (x - state.document.width / 2) * state.viewport.zoom + state.viewport.panX + result.width / 2,
    );
    const sy = Math.round(
      (y - state.document.height / 2) * state.viewport.zoom + state.viewport.panY + result.height / 2,
    );
    if (sx < 0 || sx >= result.width || sy < 0 || sy >= result.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const flippedY = result.height - 1 - sy;
    const idx = (flippedY * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

function expectCyan(px: PixelResult): void {
  expect(px.r).toBeLessThan(30);
  expect(px.g).toBeGreaterThan(225);
  expect(px.b).toBeGreaterThan(225);
}

test.describe('#992 mask edit inside an adjusted group', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'layers/effects panels are desktop-only');
  });

  test('shows the mask overlay while editing and the mask after leaving', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 500, false);

    const layerId = (await getEditorState(page)).document.activeLayerId!;
    await drawRect(page, 100, 100, 600, 300, { r: 255, g: 0, b: 0 });

    await page.locator('nav[aria-label="Application menu"]').locator('button:has-text("Layer")').click();
    await page.locator('[role="menu"][aria-label="Layer"]').locator('button:has-text("Group Layers")').click();
    await page.waitForTimeout(150);
    const groupId = (await getEditorState(page)).document.activeLayerId!;
    expect(groupId).not.toBe(layerId);

    await addAdjustment(page, groupId, 'invert');
    await closeEffectsPanel(page);

    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await page.locator('[aria-label="Add Mask"]').click();
    await page.getByRole('button', { name: /Edit mask for/ }).click();
    await page.waitForTimeout(100);
    await closeEffectsPanel(page);

    // Default black -> white gradient: the mask hides left of x=300 and
    // shows right of x=550.
    await selectTool(page, 'gradient');
    await page.keyboard.press('d');
    const start = await docToScreen(page, 300, 250);
    const end = await docToScreen(page, 550, 250);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/mask-edit-adjusted-group-editing.png' });

    // (650,250): mask white, no overlay tint — the inverted red rect.
    const shownWhileEditing = await readCompositedAtDoc(page, 650, 250);
    expectCyan(shownWhileEditing);

    // (200,250): mask black — the 50% overlay blue (0, 0.39, 1) over cyan
    // pulls green down to ~177. Before the fix this read pure cyan.
    const hiddenWhileEditing = await readCompositedAtDoc(page, 200, 250);
    expect(hiddenWhileEditing.r).toBeLessThan(30);
    expect(hiddenWhileEditing.g).toBeGreaterThan(150);
    expect(hiddenWhileEditing.g).toBeLessThan(205);
    expect(hiddenWhileEditing.b).toBeGreaterThan(225);

    // Leave mask edit by clicking the layer row itself.
    await page.locator(`[data-layer-id="${layerId}"]`).click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/mask-edit-adjusted-group-after.png' });

    const hiddenAfter = await readCompositedAtDoc(page, 200, 250);
    expect(hiddenAfter.r).toBeGreaterThan(240);
    expect(hiddenAfter.g).toBeGreaterThan(240);
    expect(hiddenAfter.b).toBeGreaterThan(240);

    expectCyan(await readCompositedAtDoc(page, 650, 250));
  });
});
