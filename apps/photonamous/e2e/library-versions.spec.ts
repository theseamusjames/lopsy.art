import { expect, test } from './test';
import { raiseExposure, waitForReady } from './harness';
import { generatedJpeg, importFiles } from './library';

/**
 * Versions and copying edits, in the browser's own storage (the local
 * folder adapter over OPFS): a second version of a photo becomes its selected
 * one and gets its own edit, the original keeps a tile in the stack; its
 * edits paste onto another photo; all of it survives a reload.
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

  // A second version, which becomes the photo's selected one: the photo's own tile. The original is the stack's other tile.
  await first.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'New version' }).click();
  // It asks for a name, with the suggestion selected: Enter keeps it.
  const nameBox = page.getByRole('dialog', { name: 'New version' }).getByRole('textbox', { name: 'Version name' });
  await expect(nameBox).toHaveValue('Version 2');
  expect(await nameBox.evaluate((el) => (el instanceof HTMLInputElement ? [el.selectionStart, el.selectionEnd] : null))).toEqual([0, 9]);
  await page.keyboard.press('Enter');
  const original = page.locator('[role="gridcell"][title="first.jpg (Original)"]');
  await expect(original).toBeVisible();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first.getByRole('button', { name: '2 versions' })).toBeVisible();

  // Edit only the new version.
  await page.keyboard.press('Enter');
  await waitForReady(page, 60_000);
  await raiseExposure(page, 5);
  await expect(page.getByLabel('Exposure value')).toHaveValue('+0.50');
  await page.getByTestId('edit-view').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(first).toHaveAttribute('data-edited', 'true');
  await expect(original).toHaveAttribute('data-edited', 'false');

  // Copy its edits (Framing is left out by default) and paste them onto the second photo.
  await first.click();
  await page.keyboard.press('Control+Shift+C');
  const dialog = page.getByRole('dialog', { name: /Copy edits from first\.jpg/ });
  await expect(dialog.getByRole('checkbox', { name: 'Framing' })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Tone' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(second).toHaveAttribute('data-edited', 'false');
  await second.click();
  await page.keyboard.press('Control+Shift+V');
  await expect(second).toHaveAttribute('data-edited', 'true');
  await expect(original).toHaveAttribute('data-edited', 'false');

  // A preset from the grid edits the version it is applied to.
  await original.click();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('menu', { name: 'Presets' }).getByRole('menuitem', { name: 'Punchy' }).click();
  await expect(original).toHaveAttribute('data-edited', 'true');

  // All of it is kept.
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(second).toHaveAttribute('data-edited', 'true', { timeout: 30_000 });
  await expect(first).toHaveAttribute('data-edited', 'true');
  await first.getByRole('button', { name: '2 versions' }).click();
  await expect(original).toHaveAttribute('data-edited', 'true');
});

/**
 * One version in an album, then that version made the photo's selected one,
 * then the selected version deleted: the photo falls back to the other one.
 */
test('a version in an album, made the selected one, then deleted', async ({ page }) => {
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
  // Version 2 is the selected version now, the photo's own tile; the original is the stack's other tile.
  await expect(photo).toHaveAttribute('aria-selected', 'true');
  await expect(original).toBeVisible();
  // The open stack shows two tiles, but they are one photo.
  await expect(page.getByText(/^1 photo · 1 selected$/)).toBeVisible();
  // The stack's badge folds and opens it, every time.
  for (let i = 0; i < 3; i++) {
    await photo.getByRole('button', { name: '2 versions' }).click();
    await expect(original).toHaveCount(0);
    await photo.getByRole('button', { name: '2 versions' }).click();
    await expect(original).toBeVisible();
  }

  // Only the original goes in the album.
  const sidebar = page.getByRole('navigation', { name: 'Library' });
  await sidebar.getByRole('button', { name: 'New album' }).click();
  await page.getByRole('textbox', { name: 'Album name' }).fill('Picks');
  await page.keyboard.press('Enter');
  await sidebar.getByRole('button', { name: /^All photos/ }).click();
  await original.click();
  await expect(page.getByText('This version in albums')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Picks' }).check();
  await sidebar.getByRole('button', { name: /^Picks/ }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
  await expect(original).toBeVisible();

  // Made the selected version, the album's tile is the photo itself.
  await original.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Make this the selected version' }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
  await expect(photo).toBeVisible();

  // In All photos Version 2 is the stack's other tile now. Delete the selected version from Single view.
  await sidebar.getByRole('button', { name: /^All photos/ }).click();
  await expect(version).toBeVisible();
  await photo.click();
  await page.keyboard.press(' ');
  const strip = page.getByRole('group', { name: 'Versions' });
  await expect(strip.getByRole('button', { name: 'Rename Original' })).toBeVisible();
  await strip.getByRole('button', { name: 'Delete Original' }).click();
  // Version 2 moves into the Selected box, and as the last version it cannot be deleted.
  await expect(strip.getByRole('button', { name: 'Rename Version 2' })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Delete Version 2' })).toHaveCount(0);
  await expect(strip.getByRole('button', { name: /^Make .+ the selected version$/ })).toHaveCount(0);
  await page.keyboard.press(' ');
  await expect(photo).toBeVisible();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
});
