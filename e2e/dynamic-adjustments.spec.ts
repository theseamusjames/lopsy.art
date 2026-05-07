/**
 * E2E tests for the dynamic AdjustmentNode list on group layers.
 *
 * Tests that:
 * 1. Adding an Exposure node and changing its value updates the canvas.
 * 2. Toggling a node off stops it from affecting the canvas.
 * 3. Reordering nodes is reflected in the store.
 *
 * Per e2e/GUIDE.md: always screenshot before asserting, read composited pixels
 * for group adjustments (they affect the composite, not a single layer texture).
 */

import { test, expect, type Page } from './fixtures';
import { waitForStore, createDocument, drawRect } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AdjNodeShape = { id: string; type: string; enabled: boolean; [k: string]: unknown };

async function getRootGroupId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { rootGroupId: string } };
    };
    return store.getState().document.rootGroupId;
  });
}

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

async function callStore(page: Page, method: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ({ method, args }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, (...a: unknown[]) => unknown>;
      };
      store.getState()[method]!(...args);
    },
    { method, args },
  );
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
    // Switch root group from pass-through to normal so group adjustments
    // are composited (pass-through bypasses the scratch FBO).
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { rootGroupId: string };
          updateLayerBlendMode: (id: string, mode: string) => void;
        };
      };
      const s = store.getState();
      s.updateLayerBlendMode(s.document.rootGroupId, 'normal');
    });
    await page.waitForTimeout(300);
  });

  test('adding a Saturation node and changing its value desaturates the canvas', async ({ page }) => {
    // Paint a saturated red shape.
    await drawRect(page, 50, 50, 100, 100, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(200);

    // Baseline: red channel should be dominant.
    const before = await readCompositedAtDoc(page, 100, 100);
    expect(before.r).toBeGreaterThan(150);
    expect(before.g).toBeLessThan(80);

    // Add a saturation node to the root group and set saturation to -100.
    const rootGroupId = await getRootGroupId(page);
    await callStore(page, 'addAdjustmentNode', rootGroupId, 'saturation');
    await page.waitForTimeout(100);

    const nodes = await getGroupAdjustments(page, rootGroupId);
    expect(nodes.length).toBe(1);
    const nodeId = nodes[0]!.id;

    await callStore(page, 'updateAdjustmentNode', rootGroupId, nodeId, { saturation: -100 });
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-saturation-off.png' });

    const after = await readCompositedAtDoc(page, 100, 100);
    // After full desaturation, R/G/B spread should collapse dramatically.
    const beforeSpread = Math.max(before.r, before.g, before.b) - Math.min(before.r, before.g, before.b);
    const afterSpread = Math.max(after.r, after.g, after.b) - Math.min(after.r, after.g, after.b);
    expect(afterSpread).toBeLessThan(beforeSpread / 4);
    // Red channel must drop.
    expect(after.r).toBeLessThan(before.r - 30);
  });

  test('toggling a node off stops it from affecting the canvas', async ({ page }) => {
    await drawRect(page, 50, 50, 100, 100, { r: 220, g: 30, b: 30 });
    await page.waitForTimeout(200);

    const rootGroupId = await getRootGroupId(page);
    await callStore(page, 'addAdjustmentNode', rootGroupId, 'saturation');
    await page.waitForTimeout(100);

    const nodes = await getGroupAdjustments(page, rootGroupId);
    const nodeId = nodes[0]!.id;

    // Apply -100 saturation.
    await callStore(page, 'updateAdjustmentNode', rootGroupId, nodeId, { saturation: -100 });
    await page.waitForTimeout(300);

    const withNode = await readCompositedAtDoc(page, 100, 100);

    // Now toggle the node off.
    await callStore(page, 'toggleAdjustmentNode', rootGroupId, nodeId);
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-toggle-off.png' });

    const afterToggle = await readCompositedAtDoc(page, 100, 100);
    // After toggle off, the canvas should look more like the original red.
    // Spread should increase significantly compared to when the node was on.
    const withNodeSpread = Math.max(withNode.r, withNode.g, withNode.b) - Math.min(withNode.r, withNode.g, withNode.b);
    const afterToggleSpread = Math.max(afterToggle.r, afterToggle.g, afterToggle.b) - Math.min(afterToggle.r, afterToggle.g, afterToggle.b);
    expect(afterToggleSpread).toBeGreaterThan(withNodeSpread + 20);

    // Verify the node is marked disabled in the store.
    const updatedNodes = await getGroupAdjustments(page, rootGroupId);
    const updatedNode = updatedNodes.find((n) => n.id === nodeId);
    expect(updatedNode?.enabled).toBe(false);
  });

  test('reordering nodes changes their order in the store', async ({ page }) => {
    const rootGroupId = await getRootGroupId(page);

    // Add three different node types.
    await callStore(page, 'addAdjustmentNode', rootGroupId, 'exposure');
    await callStore(page, 'addAdjustmentNode', rootGroupId, 'contrast');
    await callStore(page, 'addAdjustmentNode', rootGroupId, 'vignette');
    await page.waitForTimeout(100);

    const nodes = await getGroupAdjustments(page, rootGroupId);
    expect(nodes).toHaveLength(3);
    const [expId, conId, vigId] = nodes.map((n) => n.id);

    // Reverse the order.
    await callStore(page, 'reorderAdjustmentNodes', rootGroupId, [vigId, conId, expId]);
    await page.waitForTimeout(100);

    const reordered = await getGroupAdjustments(page, rootGroupId);
    expect(reordered[0]?.type).toBe('vignette');
    expect(reordered[1]?.type).toBe('contrast');
    expect(reordered[2]?.type).toBe('exposure');
  });

  test('adjustments panel Add button shows menu with node types', async ({ page }) => {
    // Select the root group and open the effects drawer.
    const rootGroupId = await getRootGroupId(page);
    await callStore(page, 'setActiveLayer', rootGroupId);
    await page.waitForTimeout(100);

    const row = page.locator(`[data-layer-id="${rootGroupId}"]`);
    await row.locator('button[aria-label*="effects"]').click();
    await page.locator('[aria-label="Add Adjustment"]').waitFor({ state: 'visible', timeout: 5000 });

    // Click Add Adjustment to open the menu.
    await page.locator('[aria-label="Add Adjustment"]').click();
    await page.waitForTimeout(100);

    // The menu should list at least the core adjustment types.
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Exposure', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Contrast', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Saturation & Vibrance', exact: true })).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-add-menu.png' });

    // Click an item to add a node.
    await page.getByRole('menuitem', { name: 'Exposure', exact: true }).click();
    await page.waitForTimeout(200);

    const nodes = await getGroupAdjustments(page, rootGroupId);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe('exposure');

    await page.screenshot({ path: 'e2e/screenshots/dynamic-adj-panel-with-nodes.png' });
  });
});
