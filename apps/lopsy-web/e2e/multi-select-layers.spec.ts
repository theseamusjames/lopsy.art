import { test, expect, type Page } from './fixtures';
import { createDocument, waitForStore } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getDocInfo(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const doc = store.getState().document as {
      layers: Array<{ id: string; name: string; type: string; children?: string[] }>;
      layerOrder: string[];
      activeLayerId: string | null;
      selectedLayerIds: string[];
      rootGroupId: string | null;
    };
    return {
      layers: doc.layers,
      layerOrder: doc.layerOrder,
      activeLayerId: doc.activeLayerId,
      selectedLayerIds: doc.selectedLayerIds,
      rootGroupId: doc.rootGroupId,
    };
  });
}

async function addLayerViaUI(page: Page): Promise<string> {
  await page.locator('[aria-label="Add Layer"]').click();
  await page.waitForTimeout(200);
  const doc = await getDocInfo(page);
  return doc.activeLayerId!;
}

async function cmdClick(page: Page, layerId: string): Promise<void> {
  // Click the layer name span directly to avoid hitting icon buttons
  const nameLocator = page.locator(`[data-layer-id="${layerId}"] span[class*="name"]`).first();
  await nameLocator.waitFor({ state: 'visible', timeout: 5000 });
  await nameLocator.click({ modifiers: ['Meta'] });
  await page.waitForTimeout(100);
}

async function shiftClick(page: Page, layerId: string): Promise<void> {
  // Click the layer name span directly to avoid hitting icon buttons
  const nameLocator = page.locator(`[data-layer-id="${layerId}"] span[class*="name"]`).first();
  await nameLocator.waitFor({ state: 'visible', timeout: 5000 });
  await nameLocator.click({ modifiers: ['Shift'] });
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page, 400, 300, false);
});

// ===========================================================================
// Cmd+click to multi-select
// ===========================================================================

test.describe('Cmd+click multi-select', () => {
  test('cmd+click adds a layer to the selection without changing active layer', async ({ page }) => {
    // Start: Layer 1 is active (default)
    const doc0 = await getDocInfo(page);
    const layer1Id = doc0.activeLayerId!;

    // Add a second layer
    const layer2Id = await addLayerViaUI(page);

    // Layer2 is now active. Cmd+click Layer1 to add it to selection.
    await cmdClick(page, layer1Id);

    const docAfter = await getDocInfo(page);
    // Active layer should still be layer2
    expect(docAfter.activeLayerId).toBe(layer2Id);
    // Both layers should be selected
    expect(docAfter.selectedLayerIds).toContain(layer1Id);
    expect(docAfter.selectedLayerIds).toContain(layer2Id);
  });

  test('cmd+click on already-selected layer removes it from selection', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    // Cmd+click to select layer2 (add to selection alongside layer3)
    await cmdClick(page, layer2Id);
    const doc1 = await getDocInfo(page);
    expect(doc1.selectedLayerIds).toContain(layer2Id);
    expect(doc1.selectedLayerIds).toContain(layer3Id);

    // Cmd+click layer2 again to deselect it
    await cmdClick(page, layer2Id);
    const doc2 = await getDocInfo(page);
    expect(doc2.selectedLayerIds).not.toContain(layer2Id);
    expect(doc2.selectedLayerIds).toContain(layer3Id);
  });

  test('selected (non-active) layers get visual highlight class', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const doc0 = await getDocInfo(page);
    const layer1Id = doc0.layers.find((l) => l.type !== 'group' && l.id !== layer2Id)?.id;
    if (!layer1Id) throw new Error('Could not find layer1');

    // Cmd+click layer1 while layer2 is active
    await cmdClick(page, layer1Id);

    // Layer1 row should have 'selected' class (not 'active')
    const layer1Row = page.locator(`[data-layer-id="${layer1Id}"]`).first();
    await expect(layer1Row).not.toHaveClass(/active/);
    await expect(layer1Row).toHaveClass(/selected/);

    // Active layer2 row should have 'active' class
    const layer2Row = page.locator(`[data-layer-id="${layer2Id}"]`).first();
    await expect(layer2Row).toHaveClass(/active/);

    await page.screenshot({ path: 'e2e/screenshots/multi-select-layers-highlight.png' });
  });

  test('plain click clears multi-selection and activates only that layer', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    // Multi-select layer2 and layer3
    await cmdClick(page, layer2Id);
    const doc1 = await getDocInfo(page);
    expect(doc1.selectedLayerIds.length).toBeGreaterThanOrEqual(2);

    // Plain click layer3 — should clear multi-selection
    await page.locator(`[data-layer-id="${layer3Id}"]`).first().click();
    const doc2 = await getDocInfo(page);
    expect(doc2.activeLayerId).toBe(layer3Id);
    expect(doc2.selectedLayerIds).toEqual([layer3Id]);
  });
});

// ===========================================================================
// Shift+click range selection
// ===========================================================================

test.describe('Shift+click range selection', () => {
  test('shift+click selects all layers between active and clicked layer', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    // Click layer3 first to make it active
    await page.locator(`[data-layer-id="${layer3Id}"]`).first().click();
    await page.waitForTimeout(100);

    // Shift+click layer2 to select range (layer3 to layer2)
    // The range should include all layers between them in the display list
    await shiftClick(page, layer2Id);

    const doc = await getDocInfo(page);
    // Range should include both endpoints
    expect(doc.selectedLayerIds).toContain(layer3Id);
    expect(doc.selectedLayerIds).toContain(layer2Id);
    // Should be at least 2 layers selected
    expect(doc.selectedLayerIds.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// Delete selected layers
// ===========================================================================

test.describe('Delete selected layers', () => {
  test('Delete Layer button removes all selected layers', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    // Select layer2 and layer3
    await page.locator(`[data-layer-id="${layer3Id}"]`).first().click();
    await cmdClick(page, layer2Id);

    const docBefore = await getDocInfo(page);
    const rasterBefore = docBefore.layers.filter((l) => l.type !== 'group').length;
    expect(rasterBefore).toBeGreaterThanOrEqual(2);

    // Click delete button
    await page.locator('[aria-label="Delete Layer"]').click();
    await page.waitForTimeout(300);

    const docAfter = await getDocInfo(page);
    // Both selected layers should be gone
    expect(docAfter.layers.map((l) => l.id)).not.toContain(layer2Id);
    expect(docAfter.layers.map((l) => l.id)).not.toContain(layer3Id);
    // At least one layer must remain
    expect(docAfter.layers.filter((l) => l.type !== 'group').length).toBeGreaterThanOrEqual(1);
  });

  test('selectedLayerIds is cleaned up after deletion', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    await page.locator(`[data-layer-id="${layer3Id}"]`).first().click();
    await cmdClick(page, layer2Id);

    await page.locator('[aria-label="Delete Layer"]').click();
    await page.waitForTimeout(300);

    const docAfter = await getDocInfo(page);
    // Deleted layers should not appear in selectedLayerIds
    expect(docAfter.selectedLayerIds).not.toContain(layer2Id);
    expect(docAfter.selectedLayerIds).not.toContain(layer3Id);
    // selectedLayerIds should not be empty — contains activeLayerId
    expect(docAfter.selectedLayerIds.length).toBeGreaterThanOrEqual(1);
    expect(docAfter.selectedLayerIds).toContain(docAfter.activeLayerId);
  });
});

// ===========================================================================
// Group selected layers
// ===========================================================================

test.describe('Group selected layers', () => {
  test('Group Layers button groups all selected layers into a new group', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    // Select layer2 and layer3
    await page.locator(`[data-layer-id="${layer3Id}"]`).first().click();
    await cmdClick(page, layer2Id);

    const docBefore = await getDocInfo(page);
    const groupCountBefore = docBefore.layers.filter((l) => l.type === 'group').length;

    // Group Layers button should appear when 2+ non-root layers selected
    await expect(page.locator('[aria-label="Group Layers"]')).toBeVisible();
    await page.locator('[aria-label="Group Layers"]').click();
    await page.waitForTimeout(300);

    const docAfter = await getDocInfo(page);

    // One new group should have been created
    const groupCountAfter = docAfter.layers.filter((l) => l.type === 'group').length;
    expect(groupCountAfter).toBe(groupCountBefore + 1);

    // The selected layers should now be inside the new group
    const newGroup = docAfter.layers.find(
      (l) => l.type === 'group' && l.children?.includes(layer2Id),
    );
    expect(newGroup).toBeDefined();
    expect(newGroup!.children).toContain(layer3Id);

    // New group should be the active layer
    expect(docAfter.activeLayerId).toBe(newGroup!.id);
    expect(docAfter.selectedLayerIds).toEqual([newGroup!.id]);

    await page.screenshot({ path: 'e2e/screenshots/multi-select-layers-grouped.png' });
  });

  test('Group Layers button is hidden when fewer than 2 layers are selected', async ({ page }) => {
    // Default: only 1 layer selected
    await expect(page.locator('[aria-label="Group Layers"]')).toHaveCount(0);
  });

  test('Group Layers button appears when 2+ non-root layers selected', async ({ page }) => {
    const layer2Id = await addLayerViaUI(page);
    const layer3Id = await addLayerViaUI(page);

    await page.locator(`[data-layer-id="${layer3Id}"]`).first().click();
    await cmdClick(page, layer2Id);

    await expect(page.locator('[aria-label="Group Layers"]')).toBeVisible();
  });
});
