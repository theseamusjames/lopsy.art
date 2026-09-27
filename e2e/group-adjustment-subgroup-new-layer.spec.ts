import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  drawRect,
  getRootGroupId,
  addAdjustment,
  addLayer,
  closeEffectsPanel,
  getEditorState,
  setActiveLayer,
} from './helpers';

/**
 * Regression test for #940: with a non-neutral adjustment on the root
 * Project group, a NEW layer added inside a sub-group never rendered in the
 * composite. syncGroupAdjustments only re-pushed a routed group when its
 * OWN `children` array changed, so the root's flattened descendant list
 * went stale when only a sub-group's children changed.
 */

interface Rgba { r: number; g: number; b: number; a: number }

async function readCompositedAtDoc(page: Page, docX: number, docY: number): Promise<Rgba> {
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
    const idx = ((result.height - 1 - sy) * result.width + sx) * 4;
    return {
      r: result.pixels[idx] ?? 0,
      g: result.pixels[idx + 1] ?? 0,
      b: result.pixels[idx + 2] ?? 0,
      a: result.pixels[idx + 3] ?? 0,
    };
  }, { x: docX, y: docY });
}

function parentGroupOf(
  layers: Array<{ id: string; type?: string; children?: string[] }>,
  childId: string,
): string | undefined {
  return layers.find((l) => l.type === 'group' && l.children?.includes(childId))?.id;
}

test.describe('#940 new layer in a sub-group renders under a root adjustment', () => {
  test.beforeEach(async ({ isMobile }) => {
    test.skip(isMobile, 'layers/effects panels are desktop-only');
  });

  test('layer added to a sub-group after a root Vignette shows in the composite', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);

    // Sub-group with a first layer holding a red block in the top-left.
    await page.locator('[aria-label="New Group"]').click();
    await page.waitForTimeout(150);
    const groupId = (await getEditorState(page)).document.activeLayerId;
    const firstId = await addLayer(page);
    type LayerLite = { id: string; type?: string; children?: string[] };
    const layersAfterFirst = (await getEditorState(page)).document.layers as unknown as LayerLite[];
    expect(parentGroupOf(layersAfterFirst, firstId)).toBe(groupId);
    await drawRect(page, 120, 100, 160, 120, { r: 255, g: 0, b: 0 });

    // Non-neutral Vignette on the root Project group.
    const rootId = await getRootGroupId(page);
    await addAdjustment(page, rootId, 'vignette', { vignette: 50 });
    await closeEffectsPanel(page);
    await page.waitForTimeout(200);

    // Doc centre before the new layer: white background, vignette leaves the
    // centre essentially untouched.
    const probe = { x: 400, y: 300 };
    const beforeNew = await readCompositedAtDoc(page, probe.x, probe.y);
    expect(beforeNew.r).toBeGreaterThan(200);
    expect(beforeNew.g).toBeGreaterThan(200);
    expect(beforeNew.b).toBeGreaterThan(200);

    // Select the layer inside the group and add a new layer — it lands in
    // the group. Fill a blue block around the doc centre.
    await setActiveLayer(page, firstId);
    const secondId = await addLayer(page);
    const layersAfterSecond = (await getEditorState(page)).document.layers as unknown as LayerLite[];
    expect(parentGroupOf(layersAfterSecond, secondId)).toBe(groupId);
    await drawRect(page, 340, 250, 120, 100, { r: 0, g: 0, b: 255 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'e2e/screenshots/group-adj-subgroup-new-layer-shown.png' });
    const shown = await readCompositedAtDoc(page, probe.x, probe.y);
    // Old bug: still white here (pixel-identical to beforeNew).
    expect(shown.b).toBeGreaterThan(150);
    expect(shown.r).toBeLessThan(60);
    expect(shown.g).toBeLessThan(60);

    // The earlier layer in the group still renders (red, maybe vignette-darkened).
    const red = await readCompositedAtDoc(page, 200, 160);
    expect(red.r).toBeGreaterThan(120);
    expect(red.g).toBeLessThan(60);
    expect(red.b).toBeLessThan(60);

    // Hiding the new layer via its eye reveals the white background again.
    await page.locator(`[data-layer-id="${secondId}"]`)
      .locator('button[aria-label="Hide layer"]')
      .click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'e2e/screenshots/group-adj-subgroup-new-layer-hidden.png' });
    const hidden = await readCompositedAtDoc(page, probe.x, probe.y);
    expect(hidden.r).toBeGreaterThan(200);
    expect(hidden.g).toBeGreaterThan(200);
    expect(hidden.b).toBeGreaterThan(200);
    expect(hidden.r - shown.r).toBeGreaterThan(150);
  });
});
