/**
 * Show Grid turns Snap on by default, but never overrides a Snap choice the
 * user has made.
 *
 * Showing the grid used to force snapToGrid on every time, so someone who
 * had unticked Snap got it back after hiding and re-showing the grid — and
 * arrow-key nudges silently started jumping a whole grid cell.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { waitForStore, createDocument, addLayer, drawRect } from './helpers';

async function activeLayerX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__editorStore as {
      getState: () => { document: { activeLayerId: string; layers: Array<{ id: string; x: number }> } };
    };
    const doc = store.getState().document;
    return doc.layers.find((l) => l.id === doc.activeLayerId)?.x ?? Number.NaN;
  });
}

async function toggleGridFromKeyboard(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+'");
}

test.describe('Show Grid and the Snap choice', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
  });

  test('the first Show Grid turns Snap on', async ({ page }) => {
    await toggleGridFromKeyboard(page);
    await expect(page.getByRole('checkbox', { name: 'Snap', exact: true })).toBeChecked();
  });

  test('unticked Snap stays off when the grid is hidden and shown again', async ({ page }) => {
    await addLayer(page);
    await drawRect(page, 100, 100, 40, 40, { r: 255, g: 0, b: 0 });

    await toggleGridFromKeyboard(page);
    const snap = page.getByRole('checkbox', { name: 'Snap', exact: true });
    await expect(snap).toBeChecked();
    await snap.click();
    await expect(snap).not.toBeChecked();

    await toggleGridFromKeyboard(page);
    await expect(snap).toBeHidden();
    await toggleGridFromKeyboard(page);
    await expect(snap, 'Show Grid must not re-enable a Snap the user turned off').not.toBeChecked();

    // With Snap off a nudge is 1 px; a snapped nudge jumps a whole grid cell.
    await page.keyboard.press('v');
    const before = await activeLayerX(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => activeLayerX(page)).toBe(before + 1);
  });

  test('a Snap choice made in the View menu before showing the grid is kept', async ({ page }) => {
    // Turn Snap on and off from the View menu while the grid is hidden.
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'View' }).click();
      await page.locator('[role="menuitem"]:has-text("Snap to Grid")').click();
    }
    await toggleGridFromKeyboard(page);
    await expect(page.getByRole('checkbox', { name: 'Snap', exact: true })).not.toBeChecked();
  });
});
