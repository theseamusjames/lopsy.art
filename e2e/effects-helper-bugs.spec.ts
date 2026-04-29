// Regression tests for #240 (openEffectsPanel for groups) and #242
// (configureEffect 'Size' selector colliding with tool-options-bar inputs).

import { test, expect } from './fixtures';
import {
  createDocument,
  waitForStore,
  setActiveLayer,
  drawRect,
  openEffectsPanel,
  configureEffect,
  selectTool,
} from './helpers';

test.describe('e2e helper regressions', () => {
  test('#240: openEffectsPanel works when the active layer is a group', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);

    // Add a group via the layers panel and make it active.
    const groupId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => {
          addGroup: (name?: string) => void;
          document: { layers: { id: string; type: string }[] };
          setActiveLayer: (id: string) => void;
        };
      };
      const s = store.getState();
      s.addGroup('Test Group');
      const group = store.getState().document.layers.find((l) => l.type === 'group')!;
      store.getState().setActiveLayer(group.id);
      return group.id;
    });
    expect(groupId).toBeTruthy();

    // Calling openEffectsPanel must NOT time out for a group layer.
    // Before the fix it would hang waiting for [aria-labelledby="blend-mode-label"]
    // which never appears because groups render AdjustmentsPanel.
    await openEffectsPanel(page);

    // Drawer is visible and contains the adjustments tablist.
    await expect(page.getByTestId('effects-drawer')).toBeVisible();
    await expect(page.locator('[role="tablist"][aria-label="Adjustment type"]')).toBeVisible();
  });

  test('#242: configureEffect picks the drawer Size input even when a tool-options Size exists', async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 400, false);

    // Draw something so we have a raster layer with content to give effects to.
    await drawRect(page, 50, 50, 100, 100, { r: 200, g: 100, b: 100 });
    const layerId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => { document: { activeLayerId: string } };
      };
      return store.getState().document.activeLayerId;
    });
    await setActiveLayer(page, layerId);

    // Switch to the brush tool — this exposes a "Size value" input in the
    // tool options bar, which used to collide with the effects-drawer Size.
    await selectTool(page, 'brush');
    await expect(page.getByRole('toolbar', { name: 'Brush options' }).getByLabel('Size value')).toBeVisible();

    // Should not throw a strict-mode violation; the helper now scopes to
    // the effects drawer.
    await configureEffect(page, 'Outer Glow', { 'Size': 12 });

    // The drawer's Size value reflects what we set.
    const drawerSize = await page
      .getByTestId('effects-drawer')
      .locator('[aria-label="Size value"]')
      .inputValue();
    expect(drawerSize).toBe('12');
  });
});
