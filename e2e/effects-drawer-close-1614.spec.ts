import { test, expect, type Page } from './fixtures';
import { waitForStore } from './helpers';

// The effects drawer's × button has one accessible name in both modes (layer
// effects and group adjustments), and the drawer doesn't carry over into a
// new document.

async function newDocumentFromMenu(page: Page): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  const menuBar = page.locator('nav[aria-label="Application menu"]');
  await menuBar.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('[role="menu"][aria-label="File"]').getByRole('menuitem', { name: /^New/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New Document' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('Effects drawer close button (#1614)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'drawers require the sidebar, hidden on touch devices');
    await page.goto('/');
    await waitForStore(page);
    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Create' }).click();
  });

  test('is named "Close effects" for group adjustments and closes the drawer', async ({ page }) => {
    const drawer = page.getByTestId('effects-drawer');
    await page.getByRole('button', { name: 'Group effects for Project' }).click();
    await expect(drawer.getByRole('button', { name: 'Add Adjustment' })).toBeVisible();

    const close = drawer.getByRole('button', { name: 'Close effects' });
    await expect(close).toHaveCount(1);
    await close.click();
    await expect(drawer).toBeHidden();
  });

  test('is named "Close effects" for layer effects', async ({ page }) => {
    const drawer = page.getByTestId('effects-drawer');
    await page.getByRole('button', { name: 'Layer effects for Layer 1' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Close effects' })).toHaveCount(1);
  });

  test('File → New closes an open drawer', async ({ page }) => {
    const drawer = page.getByTestId('effects-drawer');
    await page.getByRole('button', { name: 'Group effects for Project' }).click();
    await expect(drawer).toBeVisible();

    await newDocumentFromMenu(page);
    await expect(drawer).toBeHidden();
  });
});
