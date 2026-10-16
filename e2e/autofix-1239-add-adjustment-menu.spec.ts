// #1239 — On a group with no adjustments the effects drawer is short, and it
// clipped the Add Adjustment menu that opened upward inside it: Exposure,
// Contrast, Highlights & Shadows and Saturation & Vibrance sat above the
// drawer's top edge and a click on them landed on the canvas. The menu now
// floats over the page, so every type is hit-testable and clickable.

import { test, expect } from '@playwright/test';
import { createDocument, waitForStore } from './helpers';

test.describe('#1239 Add Adjustment menu on an empty group', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
  });

  test('every adjustment type is reachable and adds its node', async ({ page }) => {
    await page.getByRole('button', { name: 'New Group' }).click();
    const groupId = await page.evaluate(() => (window as unknown as {
      __editorStore: { getState: () => { document: { activeLayerId: string } } };
    }).__editorStore.getState().document.activeLayerId);

    await page.locator(`[data-layer-id="${groupId}"]`)
      .locator('button[aria-label^="Group effects for"]').click();
    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer.getByText('No adjustments yet')).toBeVisible();

    await page.getByRole('button', { name: 'Add Adjustment' }).click();
    const items = page.getByRole('menuitem');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(14);

    // Hit-test each item's centre after scrolling it into the menu's view:
    // the topmost element there must be the item itself, not the canvas or
    // the drawer footer.
    const blocked: string[] = [];
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      await item.scrollIntoViewIfNeeded();
      const isReachable = await item.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && el.contains(hit);
      });
      if (!isReachable) blocked.push((await item.textContent()) ?? `#${i}`);
    }
    expect(blocked).toEqual([]);

    // A real click (no dispatched event) on the first item adds Exposure.
    await page.getByRole('menuitem', { name: 'Exposure', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Adjustment types' })).toBeHidden();
    const types = await page.evaluate((id) => {
      const state = (window as unknown as {
        __editorStore: { getState: () => { document: { layers: Array<{ id: string; adjustments?: Array<{ type: string }> }> } } };
      }).__editorStore.getState();
      return state.document.layers.find((l) => l.id === id)?.adjustments?.map((n) => n.type) ?? [];
    }, groupId);
    expect(types).toEqual(['exposure']);
  });

  test('Escape closes the menu', async ({ page }) => {
    await page.getByRole('button', { name: 'New Group' }).click();
    const groupId = await page.evaluate(() => (window as unknown as {
      __editorStore: { getState: () => { document: { activeLayerId: string } } };
    }).__editorStore.getState().document.activeLayerId);
    await page.locator(`[data-layer-id="${groupId}"]`)
      .locator('button[aria-label^="Group effects for"]').click();
    await page.getByRole('button', { name: 'Add Adjustment' }).click();
    const menu = page.getByRole('menu', { name: 'Adjustment types' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});
