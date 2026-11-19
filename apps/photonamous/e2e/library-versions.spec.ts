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
  // It asks for a name, with the suggestion selected: Enter keeps it.
  const nameBox = page.getByRole('dialog', { name: 'New version' }).getByRole('textbox', { name: 'Version name' });
  await expect(nameBox).toHaveValue('Version 2');
  expect(await nameBox.evaluate((el) => (el instanceof HTMLInputElement ? [el.selectionStart, el.selectionEnd] : null))).toEqual([0, 9]);
  await page.keyboard.press('Enter');
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

  // A preset from the grid edits the photo it is applied to.
  await first.click();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('menu', { name: 'Presets' }).getByRole('menuitem', { name: 'Punchy' }).click();
  await expect(first).toHaveAttribute('data-edited', 'true');

  // All of it is kept.
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(second).toHaveAttribute('data-edited', 'true', { timeout: 30_000 });
  await first.getByRole('button', { name: '2 versions' }).click();
  await expect(page.locator('[role="gridcell"][title="first.jpg (Version 2)"]')).toHaveAttribute('data-edited', 'true');
});

/**
 * One version in an album, then that version made the one the photo shows,
 * then the shown version deleted: the photo falls back to the other one.
 */
test('a version in an album, made the shown one, then deleted', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'only.jpg', buffer: await generatedJpeg(page, 60, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const photo = page.locator('[role="gridcell"][title="only.jpg"]');
  const version = page.locator('[role="gridcell"][title="only.jpg (Version 2)"]');
  const original = page.locator('[role="gridcell"][title="only.jpg (Original)"]');

  await photo.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'New version' }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(version).toHaveAttribute('aria-selected', 'true');
  // The open stack shows two tiles, but they are one photo.
  await expect(page.getByText(/^1 photo · 1 selected$/)).toBeVisible();
  // The stack's badge folds and opens it, every time.
  for (let i = 0; i < 3; i++) {
    await photo.getByRole('button', { name: '2 versions' }).click();
    await expect(version).toHaveCount(0);
    await photo.getByRole('button', { name: '2 versions' }).click();
    await expect(version).toBeVisible();
  }

  // Only the version goes in the album.
  const sidebar = page.getByRole('navigation', { name: 'Library' });
  await sidebar.getByRole('button', { name: 'New album' }).click();
  await page.getByRole('textbox', { name: 'Album name' }).fill('Picks');
  await page.keyboard.press('Enter');
  await sidebar.getByRole('button', { name: /^All photos/ }).click();
  await version.click();
  await expect(page.getByText('This version in albums')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Picks' }).check();
  await sidebar.getByRole('button', { name: /^Picks/ }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
  await expect(version).toBeVisible();

  // Made the shown version, the album's tile is the photo itself.
  await version.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show this version for the photo' }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
  await expect(photo).toBeVisible();

  // In All photos the old Original is the stack's other tile. Delete the shown version from Single view.
  await sidebar.getByRole('button', { name: /^All photos/ }).click();
  await expect(original).toBeVisible();
  await photo.click();
  await page.keyboard.press(' ');
  const strip = page.getByRole('group', { name: 'Versions' });
  await expect(strip.getByText('Shown')).toBeVisible();
  await strip.getByRole('button', { name: 'Delete Version 2' }).click();
  await expect(strip.getByRole('button', { name: 'Original', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(strip.getByRole('button', { name: 'Delete Original' })).toHaveCount(0);
  await page.keyboard.press(' ');
  await expect(photo).toBeVisible();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
});
