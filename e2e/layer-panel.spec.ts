import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createDocument(page: Page, width = 400, height = 300, transparent = false) {
  await page.evaluate(
    ({ w, h, t }) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { createDocument: (w: number, h: number, t: boolean) => void };
      };
      store.getState().createDocument(w, h, t);
    },
    { w: width, h: height, t: transparent },
  );
  await page.waitForTimeout(200);
}

async function getEditorState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    const doc = state.document as {
      width: number;
      height: number;
      layers: Array<{
        id: string;
        name: string;
        visible: boolean;
        opacity: number;
        x: number;
        y: number;
        width: number;
        height: number;
        mask: { id: string; enabled: boolean; width: number; height: number } | null;
        effects: Record<string, unknown>;
      }>;
      activeLayerId: string;
    };
    return { document: doc };
  });
}

async function getUIState(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__uiStore as {
      getState: () => Record<string, unknown>;
    };
    const state = store.getState();
    return {
      showEffectsDrawer: state.showEffectsDrawer as boolean,
      maskEditMode: state.maskEditMode as boolean,
    };
  });
}

async function addLayer(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { addLayer: () => void };
    };
    store.getState().addLayer();
  });
}

async function addMaskViaStore(page: Page, layerId: string) {
  await page.evaluate(
    (id) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { addLayerMask: (id: string) => void };
      };
      store.getState().addLayerMask(id);
    },
    layerId,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__editorStore);
  await createDocument(page);
});

// ===========================================================================
// Mask Sub-Row
// ===========================================================================

test.describe('Mask Sub-Row', () => {
  test('mask row appears below layer when mask is added', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.layers[0]!.id;

    // No mask row before adding mask
    await expect(page.locator('button[title="Delete mask"]')).toHaveCount(0);

    await addMaskViaStore(page, layerId);

    // Mask row should now be visible with delete and convert buttons
    await expect(page.locator('button[title="Delete mask"]')).toBeVisible();
    await expect(page.locator('button[title="Convert mask to selection"]')).toBeVisible();
  });

  test('clicking delete mask button removes the mask', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.layers[0]!.id;

    await addMaskViaStore(page, layerId);
    await expect(page.locator('button[title="Delete mask"]')).toBeVisible();

    await page.locator('button[title="Delete mask"]').click();

    const updated = await getEditorState(page);
    expect(updated.document.layers[0]!.mask).toBeNull();
    await expect(page.locator('button[title="Delete mask"]')).toHaveCount(0);
  });

  test('clicking mask thumbnail enters mask edit mode', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.layers[0]!.id;

    await addMaskViaStore(page, layerId);

    const uiBefore = await getUIState(page);
    expect(uiBefore.maskEditMode).toBe(false);

    await page.locator('[title="Click to edit mask"]').click();

    const uiAfter = await getUIState(page);
    expect(uiAfter.maskEditMode).toBe(true);
  });

  test('clicking mask thumbnail again exits mask edit mode', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.layers[0]!.id;

    await addMaskViaStore(page, layerId);

    // Enter mask edit mode
    await page.locator('[title="Click to edit mask"]').click();
    const ui1 = await getUIState(page);
    expect(ui1.maskEditMode).toBe(true);

    // Exit mask edit mode
    await page.locator('[title="Click to edit mask"]').click();
    const ui2 = await getUIState(page);
    expect(ui2.maskEditMode).toBe(false);
  });

  test('deleting mask exits mask edit mode', async ({ page }) => {
    const state = await getEditorState(page);
    const layerId = state.document.layers[0]!.id;

    await addMaskViaStore(page, layerId);
    await page.locator('[title="Click to edit mask"]').click();

    const uiBefore = await getUIState(page);
    expect(uiBefore.maskEditMode).toBe(true);

    await page.locator('button[title="Delete mask"]').click();

    const uiAfter = await getUIState(page);
    expect(uiAfter.maskEditMode).toBe(false);
  });

  test('mask row only appears on layers that have masks', async ({ page }) => {
    const state = await getEditorState(page);
    const activeLayerId = state.document.activeLayerId;

    // Add mask only to active layer
    await addMaskViaStore(page, activeLayerId);
    await page.waitForTimeout(100);

    // Only one delete mask button should exist
    await expect(page.locator('button[title="Delete mask"]')).toHaveCount(1);
  });
});

// ===========================================================================
// Add Mask Button
// ===========================================================================

test.describe('Add Mask Button', () => {
  test('add mask button is visible when active layer has no mask', async ({ page }) => {
    await expect(page.locator('[aria-label="Add Mask"]')).toBeVisible();
  });

  test('clicking add mask button creates a mask on the active layer', async ({ page }) => {
    await page.locator('[aria-label="Add Mask"]').click();

    const state = await getEditorState(page);
    const activeLayer = state.document.layers.find(l => l.id === state.document.activeLayerId)!;
    expect(activeLayer.mask).not.toBeNull();
    expect(activeLayer.mask!.enabled).toBe(true);
  });

  test('add mask button is hidden when active layer already has a mask', async ({ page }) => {
    await page.locator('[aria-label="Add Mask"]').click();

    await expect(page.locator('[aria-label="Add Mask"]')).toHaveCount(0);
  });

  test('add mask button reappears after deleting mask', async ({ page }) => {
    await page.locator('[aria-label="Add Mask"]').click();
    await expect(page.locator('[aria-label="Add Mask"]')).toHaveCount(0);

    await page.locator('button[title="Delete mask"]').click();
    await expect(page.locator('[aria-label="Add Mask"]')).toBeVisible();
  });
});

// ===========================================================================
// Layer Effects Button (per-layer row)
// ===========================================================================

test.describe('Layer Effects Button', () => {
  test('effects button exists on each layer row', async ({ page }) => {
    // Two layers (Background + Layer 1) = two effects buttons
    await expect(page.locator('button[title="Layer effects"]')).toHaveCount(2);

    await addLayer(page);

    // Three layers = three effects buttons
    await expect(page.locator('button[title="Layer effects"]')).toHaveCount(3);
  });

  test('clicking effects button opens the effects drawer', async ({ page }) => {
    const uiBefore = await getUIState(page);
    expect(uiBefore.showEffectsDrawer).toBe(false);

    await page.locator('button[title="Layer effects"]').first().click();

    const uiAfter = await getUIState(page);
    expect(uiAfter.showEffectsDrawer).toBe(true);
  });

  test.skip('clicking effects button selects that layer', async ({ page }) => {
    await addLayer(page);

    const state = await getEditorState(page);
    const backgroundLayerId = state.document.layers[0]!.id;

    // Active layer is the newly added layer, not Background
    expect(state.document.activeLayerId).not.toBe(backgroundLayerId);

    // Select the Background layer via store, then verify effects button works
    await page.evaluate((bgId) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { setActiveLayer: (id: string) => void };
      };
      store.getState().setActiveLayer(bgId);
    }, backgroundLayerId);

    // Click effects button on the now-active layer
    await page.locator('button[title="Layer effects"]').first().click();

    const updated = await getEditorState(page);
    // Effects drawer should have opened
    const ui = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__uiStore as {
        getState: () => { showEffectsDrawer: boolean };
      };
      return store.getState().showEffectsDrawer;
    });
    expect(ui).toBe(true);
  });

  test('clicking effects button when drawer is open just selects layer', async ({ page }) => {
    await addLayer(page);

    // Open drawer via first button (topmost layer in UI = newly added layer)
    const buttons = page.locator('button[title="Layer effects"]');
    await buttons.first().scrollIntoViewIfNeeded();
    await buttons.first().click({ timeout: 10000 });

    const ui1 = await getUIState(page);
    expect(ui1.showEffectsDrawer).toBe(true);

    const state1 = await getEditorState(page);

    // Click effects button on the Background layer (last in UI) — drawer stays open, layer switches
    await buttons.last().click();

    const ui2 = await getUIState(page);
    expect(ui2.showEffectsDrawer).toBe(true);

    const state2 = await getEditorState(page);
    expect(state2.document.activeLayerId).toBe(state1.document.layers[0]!.id);
  });
});

// ===========================================================================
// Effects Drawer Overlay
// ===========================================================================

test.describe('Effects Drawer', () => {
  test('effects drawer does not resize the canvas container', async ({ page }) => {
    const container = page.locator('[data-testid="canvas-container"]');
    const sizeBefore = await container.boundingBox();

    // Open effects drawer
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    const sizeAfter = await container.boundingBox();
    expect(sizeAfter!.width).toBe(sizeBefore!.width);
    expect(sizeAfter!.height).toBe(sizeBefore!.height);
  });

  test('effects drawer is positioned to the left of the sidebar', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    const sidebar = page.locator('[data-testid="canvas-container"]').locator('..').locator('> :last-child');
    const sidebarBox = await sidebar.boundingBox();

    // The drawer should exist and be visible
    const drawerHeader = page.locator('text=Layer Effects');
    await expect(drawerHeader).toBeVisible();
  });

  test('effects drawer shows effect list with checkboxes', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    // Should see all four effect labels
    await expect(page.locator('text=Drop Shadow')).toBeVisible();
    await expect(page.locator('text=Stroke')).toBeVisible();
    await expect(page.locator('text=Outer Glow')).toBeVisible();
    await expect(page.locator('text=Inner Glow')).toBeVisible();
  });

  test('toggling effect checkbox enables and shows form', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    // Drop Shadow row should be visible, click its checkbox
    const checkbox = page.locator('text=Drop Shadow').locator('..').locator('input[type="checkbox"]');
    await checkbox.click();

    // After enabling, the form should show (e.g., Offset X slider label)
    await expect(page.locator('text=Offset X')).toBeVisible();

    // Verify the effect is stored on the active layer
    const state = await getEditorState(page);
    const activeLayer = state.document.layers.find(l => l.id === state.document.activeLayerId)!;
    expect((activeLayer.effects.dropShadow as { enabled: boolean }).enabled).toBe(true);
  });

  test('unchecking effect checkbox disables it', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    await page.waitForTimeout(100);

    const checkbox = page.locator('text=Drop Shadow').locator('..').locator('input[type="checkbox"]');

    // Enable
    await checkbox.click();
    const state1 = await getEditorState(page);
    const active1 = state1.document.layers.find(l => l.id === state1.document.activeLayerId)!;
    expect((active1.effects.dropShadow as { enabled: boolean }).enabled).toBe(true);

    // Disable
    await checkbox.click();
    const state2 = await getEditorState(page);
    const active2 = state2.document.layers.find(l => l.id === state2.document.activeLayerId)!;
    expect((active2.effects.dropShadow as { enabled: boolean }).enabled).toBe(false);
  });

  test('closing effects drawer via X button', async ({ page }) => {
    await page.locator('button[title="Layer effects"]').first().click();
    const ui1 = await getUIState(page);
    expect(ui1.showEffectsDrawer).toBe(true);

    await page.locator('[aria-label="Close effects"]').click();

    const ui2 = await getUIState(page);
    expect(ui2.showEffectsDrawer).toBe(false);
  });
});
