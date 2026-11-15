import { test, expect } from './fixtures';
import { createDocument, getEditorState, waitForStore } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Right-click the first non-root layer row and return the layerId. */
async function rightClickFirstLayer(page: import('@playwright/test').Page) {
  const state = await getEditorState(page);
  // The root group is last in the UI (bottom row). The first non-root raster
  // layer is the active one.
  const layerId = state.document.activeLayerId;
  const row = page.locator(`[data-layer-id="${layerId}"]`);
  await row.click({ button: 'right' });
  return layerId;
}

/** Read the colorTag field from a specific layer in the store. */
async function getLayerColorTag(page: import('@playwright/test').Page, layerId: string): Promise<string | null | undefined> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { layers: Array<{ id: string; colorTag?: string | null }> } };
    };
    const layer = store.getState().document.layers.find((l) => l.id === id);
    return layer?.colorTag;
  }, layerId);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'layer panel requires sidebar, hidden on touch devices');
  await page.goto('/');
  await waitForStore(page);
  await createDocument(page);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Layer Color Tags', () => {
  test('right-click layer shows context menu with color tag options', async ({ page }) => {
    await rightClickFirstLayer(page);

    const menu = page.locator('[data-testid="layer-context-menu"]');
    await expect(menu).toBeVisible();

    // All 7 colors + "no color" swatch should be present
    await expect(page.locator('[data-testid="color-tag-red"]')).toBeVisible();
    await expect(page.locator('[data-testid="color-tag-blue"]')).toBeVisible();
    await expect(page.locator('[data-testid="color-tag-green"]')).toBeVisible();
    await expect(page.locator('[data-testid="color-tag-none"]')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/layer-color-tags-menu.png' });
  });

  test('clicking a color tag swatch sets the color tag on the layer', async ({ page }) => {
    const layerId = await rightClickFirstLayer(page);

    // Select "red"
    await page.locator('[data-testid="color-tag-red"]').click();

    // Menu should close
    await expect(page.locator('[data-testid="layer-context-menu"]')).toHaveCount(0);

    // Store should have the color tag
    const tag = await getLayerColorTag(page, layerId);
    expect(tag).toBe('red');

    // The colored indicator should be visible on the layer row
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    const bar = row.locator('[data-tag="red"]');
    await expect(bar).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/layer-color-tags-red.png' });
  });

  test('can change color tag to a different color', async ({ page }) => {
    const layerId = await rightClickFirstLayer(page);
    await page.locator('[data-testid="color-tag-red"]').click();

    // Now change to blue
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    await row.click({ button: 'right' });
    await page.locator('[data-testid="color-tag-blue"]').click();

    const tag = await getLayerColorTag(page, layerId);
    expect(tag).toBe('blue');

    await expect(row.locator('[data-tag="blue"]')).toBeVisible();
    await expect(row.locator('[data-tag="red"]')).toHaveCount(0);

    await page.screenshot({ path: 'e2e/screenshots/layer-color-tags-change.png' });
  });

  test('clicking "no color" removes the color tag', async ({ page }) => {
    const layerId = await rightClickFirstLayer(page);
    await page.locator('[data-testid="color-tag-green"]').click();

    // Verify green was set
    expect(await getLayerColorTag(page, layerId)).toBe('green');

    // Now remove it
    const row = page.locator(`[data-layer-id="${layerId}"]`);
    await row.click({ button: 'right' });
    await page.locator('[data-testid="color-tag-none"]').click();

    const tag = await getLayerColorTag(page, layerId);
    expect(tag === null || tag === undefined).toBe(true);

    // Colored bar should be gone
    await expect(row.locator('[data-tag]')).toHaveCount(0);

    await page.screenshot({ path: 'e2e/screenshots/layer-color-tags-removed.png' });
  });

  test('context menu closes when clicking outside', async ({ page }) => {
    await rightClickFirstLayer(page);
    await expect(page.locator('[data-testid="layer-context-menu"]')).toBeVisible();

    // Click on the canvas area to dismiss
    await page.locator('[data-testid="canvas-container"]').click();
    await expect(page.locator('[data-testid="layer-context-menu"]')).toHaveCount(0);
  });

  test('color tags persist across multiple layers independently', async ({ page }) => {
    const state = await getEditorState(page);
    const firstLayerId = state.document.activeLayerId;

    // Tag first (active) layer as red
    const firstRow = page.locator(`[data-layer-id="${firstLayerId}"]`);
    await firstRow.click({ button: 'right' });
    await page.locator('[data-testid="color-tag-red"]').click();

    // Add a new layer and tag it blue
    await page.locator('[aria-label="Add Layer"]').click();
    const state2 = await getEditorState(page);
    const secondLayerId = state2.document.activeLayerId;

    const secondRow = page.locator(`[data-layer-id="${secondLayerId}"]`);
    await secondRow.click({ button: 'right' });
    await page.locator('[data-testid="color-tag-blue"]').click();

    // Verify both layers have their respective tags
    expect(await getLayerColorTag(page, firstLayerId)).toBe('red');
    expect(await getLayerColorTag(page, secondLayerId)).toBe('blue');

    // Verify both colored bars are visible
    await expect(page.locator(`[data-layer-id="${firstLayerId}"] [data-tag="red"]`)).toBeVisible();
    await expect(page.locator(`[data-layer-id="${secondLayerId}"] [data-tag="blue"]`)).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/layer-color-tags-multiple.png' });
  });
});
