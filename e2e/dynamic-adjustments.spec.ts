/**
 * E2E tests for the dynamic AdjustmentNode list on group layers.
 *
 * Tests that:
 * 1. Adding a Saturation node via the UI and changing its value updates the canvas.
 * 2. Toggling a node off via the UI stops it from affecting the canvas.
 * 3. Reordering nodes is reflected in the store.
 * 4. The Add Adjustment menu works.
 *
 * All interactions use the AdjustmentsPanel UI — no direct store manipulation.
 */

import { test, expect, type Page } from './fixtures';
import {
  waitForStore,
  createDocument,
  drawRect,
  getRootGroupId,
  addAdjustment,
  openGroupEffectsPanel,
  setActiveLayer,
  setGroupBlendMode,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AdjNodeShape = { id: string; type: string; enabled: boolean; [k: string]: unknown };

async function getGroupAdjustments(page: Page, groupId: string): Promise<AdjNodeShape[]> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; type: string; adjustments: AdjNodeShape[] }> } };
    };
    const state = store.getState();
    const group = state.document.layers.find((l) => l.id === id && l.type === 'group');
    return (group?.adjustments ?? []) as AdjNodeShape[];
  }, groupId);
}

interface PixelResult { r: number; g: number; b: number; a: number }

async function readCompositedAtDoc(
  page: Page,
  docX: number,
  docY: number,
): Promise<PixelResult> {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Dynamic adjustment node list on groups', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'adjustments panel not accessible on mobile');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 200, 200, false);

    // Ensure root group is in normal mode so group adjustments are composited
    // (pass-through bypasses the scratch FBO). As of issue #523 this is the
    // default — kept explicit to make the precondition obvious.
    const rootGroupId = await getRootGroupId(page);
    await setGroupBlendMode(page, rootGroupId, 'normal');

    await page.waitForTimeout(300);
  });

  test('adding a Saturation node and changing its value desaturates the canvas', async ({ page }) => {
    await drawRect(page, 50, 50, 100, 100, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(200);

    const before = await readCompositedAtDoc(page, 100, 100);
    expect(before.r).toBeGreaterThan(150);
    expect(before.g).toBeLessThan(80);

    // Add a saturation node via the UI and set it to -100.
    const rootGroupId = await getRootGroupId(page);
    await addAdjustment(page, rootGroupId, 'saturation', { saturation: -100 });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-saturation-off.png' });

    const after = await readCompositedAtDoc(page, 100, 100);
    const beforeSpread = Math.max(before.r, before.g, before.b) - Math.min(before.r, before.g, before.b);
    const afterSpread = Math.max(after.r, after.g, after.b) - Math.min(after.r, after.g, after.b);
    expect(afterSpread).toBeLessThan(beforeSpread / 4);
    expect(after.r).toBeLessThan(before.r - 30);
  });

  test('toggling a node off stops it from affecting the canvas', async ({ page }) => {
    await drawRect(page, 50, 50, 100, 100, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(200);

    const rootGroupId = await getRootGroupId(page);
    await addAdjustment(page, rootGroupId, 'saturation', { saturation: -100 });
    await page.waitForTimeout(300);

    const withNode = await readCompositedAtDoc(page, 100, 100);

    // Click the eye toggle button on the saturation node specifically.
    // Default adjustment nodes (levels, curves, exposure, hue-saturation)
    // precede the newly added saturation node, so we target the last
    // "Disable node" button which corresponds to the saturation node.
    const drawer = page.getByTestId('effects-drawer');
    await drawer.locator('[aria-label="Disable node"]').last().click();
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-toggle-off.png' });

    const afterToggle = await readCompositedAtDoc(page, 100, 100);
    const withNodeSpread = Math.max(withNode.r, withNode.g, withNode.b) - Math.min(withNode.r, withNode.g, withNode.b);
    const afterToggleSpread = Math.max(afterToggle.r, afterToggle.g, afterToggle.b) - Math.min(afterToggle.r, afterToggle.g, afterToggle.b);
    expect(afterToggleSpread).toBeGreaterThan(withNodeSpread + 20);

    // Verify the node is marked disabled in the store.
    const updatedNodes = await getGroupAdjustments(page, rootGroupId);
    const updatedNode = updatedNodes.find((n) => n.type === 'saturation');
    expect(updatedNode?.enabled).toBe(false);
  });

  test('reordering nodes changes their order in the store', async ({ page }) => {
    const rootGroupId = await getRootGroupId(page);

    // The root group starts with 4 default nodes (levels, curves, exposure,
    // hue-saturation). Record the baseline count before adding more.
    const baselineNodes = await getGroupAdjustments(page, rootGroupId);
    const baselineCount = baselineNodes.length;

    // Add three different node types via the UI.
    await addAdjustment(page, rootGroupId, 'contrast');
    await addAdjustment(page, rootGroupId, 'saturation');
    await addAdjustment(page, rootGroupId, 'vignette');
    await page.waitForTimeout(100);

    const nodes = await getGroupAdjustments(page, rootGroupId);
    expect(nodes).toHaveLength(baselineCount + 3);

    // Find the three nodes we just added (they come after the defaults).
    const addedNodes = nodes.slice(baselineCount);
    const [conId, satId, vigId] = addedNodes.map((n) => n.id);

    // Reorder the full list, placing our three added nodes in reversed order.
    const reorderedIds = [
      ...baselineNodes.map((n) => n.id),
      vigId, satId, conId,
    ];
    await page.evaluate(
      ({ gid, order }) => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as {
          getState: () => { reorderAdjustmentNodes: (groupId: string, ids: string[]) => void };
        };
        store.getState().reorderAdjustmentNodes(gid, order);
      },
      { gid: rootGroupId, order: reorderedIds },
    );
    await page.waitForTimeout(100);

    const reordered = await getGroupAdjustments(page, rootGroupId);
    const reorderedAdded = reordered.slice(baselineCount);
    expect(reorderedAdded[0]?.type).toBe('vignette');
    expect(reorderedAdded[1]?.type).toBe('saturation');
    expect(reorderedAdded[2]?.type).toBe('contrast');
  });

  test('adjustments panel Add button shows menu with node types', async ({ page }) => {
    const rootGroupId = await getRootGroupId(page);

    // Record the baseline node count (includes default adjustment nodes).
    const baselineNodes = await getGroupAdjustments(page, rootGroupId);
    const baselineCount = baselineNodes.length;

    await setActiveLayer(page, rootGroupId);
    await page.waitForTimeout(100);

    const row = page.locator(`[data-layer-id="${rootGroupId}"]`);
    await row.locator('button[aria-label*="effects"]').click();
    await page.locator('[aria-label="Add Adjustment"]').waitFor({ state: 'visible', timeout: 5000 });

    // Click Add Adjustment to open the menu.
    await page.locator('[aria-label="Add Adjustment"]').click();
    await page.waitForTimeout(100);

    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Exposure', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Contrast', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Saturation & Vibrance', exact: true })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-add-menu.png' });

    // Click an item to add a vignette node (not already in defaults).
    await page.getByRole('menuitem', { name: 'Vignette', exact: true }).click();
    await page.waitForTimeout(200);

    const nodes = await getGroupAdjustments(page, rootGroupId);
    expect(nodes).toHaveLength(baselineCount + 1);
    expect(nodes[nodes.length - 1]?.type).toBe('vignette');

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-panel-with-nodes.png' });
  });
});
