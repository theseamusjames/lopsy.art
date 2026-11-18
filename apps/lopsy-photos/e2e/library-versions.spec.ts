import { expect, test } from '@playwright/test';
import { raiseExposure, waitForReady } from './harness';
import { generatedJpeg, importFiles } from './library';

/**
 * Versions and copying edits, in the browser's own storage (the local
 * folder adapter over OPFS): a second version of a photo gets its own edit
 * and tile; its edits paste onto another photo; all of it survives a reload.
 */
test('new version, edit it, copy its edits onto another photo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'first.jpg', buffer: await generatedJpeg(page, 20, 480, 320) },
    { name: 'second.jpg', buffer: await generatedJpeg(page, 220, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const first = page.locator('[role="gridcell"][title="first.jpg"]');
  const second = page.locator('[role="gridcell"][title="second.jpg"]');
  await expect(first).toBeVisible();

  // A second version, shown as its own tile in the photo's stack.
  await first.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'New version' }).click();
  const version = page.locator('[role="gridcell"][title="first.jpg (Version 2)"]');
  await expect(version).toBeVisible();
  await expect(version).toHaveAttribute('aria-selected', 'true');
  await expect(first.getByRole('button', { name: '2 versions' })).toBeVisible();

  // Edit only the version.
  await page.keyboard.press('Enter');
  await waitForReady(page, 60_000);
  await raiseExposure(page, 5);
  await expect(page.getByLabel('Exposure value')).toHaveValue('+0.50');
  await page.getByTestId('edit-view').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(version).toHaveAttribute('data-edited', 'true');
  await expect(first).toHaveAttribute('data-edited', 'false');

  // Copy its edits (Framing is left out by default) and paste them onto the second photo.
  await version.click();
  await page.keyboard.press('Control+Shift+C');
  const dialog = page.getByRole('dialog', { name: /Copy edits from first\.jpg/ });
  await expect(dialog.getByRole('checkbox', { name: 'Framing' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Tone' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(second).toHaveAttribute('data-edited', 'false');
  await second.click();
  await page.keyboard.press('Control+Shift+V');
  await expect(second).toHaveAttribute('data-edited', 'true');
  await expect(first).toHaveAttribute('data-edited', 'false');

  // All of it is kept.
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(second).toHaveAttribute('data-edited', 'true', { timeout: 30_000 });
  await first.getByRole('button', { name: '2 versions' }).click();
  await expect(page.locator('[role="gridcell"][title="first.jpg (Version 2)"]')).toHaveAttribute('data-edited', 'true');
});
