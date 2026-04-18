import { test, expect, type Page } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
}

async function createDocument(page: Page, width = 400, height = 300) {
  await page.evaluate(
    ({ w, h }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, false);
    },
    { w: width, h: height },
  );
  await page.waitForTimeout(200);
}

async function callStore(page: Page, method: string, ...args: unknown[]) {
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

interface DocInfo {
  layers: Array<{
    id: string;
    name: string;
    type: string;
    visible: boolean;
    opacity: number;
  }>;
  rootGroupId: string | null;
  activeLayerId: string | null;
}

async function getDocInfo(page: Page): Promise<DocInfo> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: Record<string, unknown> };
    };
    const doc = store.getState().document;
    const layers = (doc.layers as Array<Record<string, unknown>>).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      type: l.type as string,
      visible: l.visible as boolean,
      opacity: l.opacity as number,
    }));
    return {
      layers,
      rootGroupId: (doc.rootGroupId as string | null) ?? null,
      activeLayerId: doc.activeLayerId as string | null,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Root group controls (#59)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page);
  });

  test('root group should not show visibility or opacity controls', async ({ page }) => {
    const doc = await getDocInfo(page);
    expect(doc.rootGroupId).toBeTruthy();

    const rootGroup = doc.layers.find((l) => l.id === doc.rootGroupId);
    expect(rootGroup).toBeTruthy();
    expect(rootGroup!.name).toBe('Project');

    // Find the root group row via its CSS class
    const rootGroupRow = page.locator('[class*="rootGroup"]');
    await expect(rootGroupRow).toBeVisible();

    // Root group should NOT have a visibility button (eye icon)
    const rootVisibilityBtn = rootGroupRow.locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]');
    await expect(rootVisibilityBtn).toHaveCount(0);

    // Root group should NOT have an opacity percentage display
    const rootOpacity = rootGroupRow.locator('[title="Click to adjust opacity"]');
    await expect(rootOpacity).toHaveCount(0);

    // Non-root layers SHOULD have visibility buttons
    const nonRootLayers = doc.layers.filter((l) => l.id !== doc.rootGroupId);
    expect(nonRootLayers.length).toBeGreaterThan(0);

    // All layer rows (not root group) should have visibility buttons
    const allVisibilityBtns = page.locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]');
    await expect(allVisibilityBtns).toHaveCount(nonRootLayers.length);

    // Root group should NOT have a drag handle
    const rootDragHandle = rootGroupRow.locator('[class*="dragHandle"]');
    await expect(rootDragHandle).toHaveCount(0);

    await page.screenshot({ path: 'test-results/screenshots/root-group-no-controls.png' });
  });

  test('non-root groups still show visibility and opacity', async ({ page }) => {
    // Add a non-root group
    await callStore(page, 'addGroup', 'Sub Group');
    await page.waitForTimeout(100);

    const doc = await getDocInfo(page);
    const subGroup = doc.layers.find((l) => l.name === 'Sub Group');
    expect(subGroup).toBeTruthy();
    expect(subGroup!.type).toBe('group');

    // Find all group rows — root group has rootGroup class, others do not
    const nonRootGroupRows = page.locator('[class*="groupRow"]:not([class*="rootGroup"])');
    await expect(nonRootGroupRows).toHaveCount(1);

    // Non-root group SHOULD have a visibility button
    const groupVisibilityBtn = nonRootGroupRows.locator('button[aria-label="Hide layer"], button[aria-label="Show layer"]');
    await expect(groupVisibilityBtn).toHaveCount(1);

    // Non-root group SHOULD have opacity display
    const groupOpacity = nonRootGroupRows.locator('[title="Click to adjust opacity"]');
    await expect(groupOpacity).toHaveCount(1);

    // Non-root group SHOULD have a drag handle
    const groupDragHandle = nonRootGroupRows.locator('[class*="dragHandle"]');
    await expect(groupDragHandle).toHaveCount(1);

    await page.screenshot({ path: 'test-results/screenshots/non-root-group-has-controls.png' });
  });
});
