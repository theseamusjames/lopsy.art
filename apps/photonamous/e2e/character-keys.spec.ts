import { expect, test } from './test';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * WCAG 2.1.4 Character Key Shortcuts: Settings > Keyboard turns the one-key
 * shortcuts off, on this device. Ctrl and Cmd shortcuts, arrows and text
 * fields keep working.
 */
test('single-key shortcuts can be turned off and on again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await importFiles(page, [{ name: 'keys.jpg', buffer: await generatedJpeg(page, 30) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const tile = tiles(page).first();
  await expect(tile).toBeVisible();

  const setShortcuts = async (on: boolean) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const box = dialog.getByRole('checkbox', { name: 'Single-key shortcuts' });
    await expect(box).toHaveAccessibleDescription(/speech input/);
    await box.setChecked(on);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  };

  await setShortcuts(false);
  await tile.click();
  await page.keyboard.press('3');
  await page.keyboard.press('x');
  await expect(tile).not.toHaveAttribute('data-rating', '3');
  await expect(tile).toBeVisible();

  // Text fields still take every character.
  const search = page.getByRole('searchbox', { name: 'Find photos' });
  await search.fill('');
  await search.pressSequentially('k3y');
  await expect(search).toHaveValue('k3y');
  await search.fill('');
  await expect(tile).toBeVisible();

  // The choice survives a reload.
  await page.reload();
  await page.getByRole('button', { name: /^All photos/ }).click();
  await tiles(page).first().click();
  await page.keyboard.press('4');
  await expect(tiles(page).first()).not.toHaveAttribute('data-rating', '4');

  await setShortcuts(true);
  await tiles(page).first().click();
  await page.keyboard.press('3');
  await expect(tiles(page).first()).toHaveAttribute('data-rating', '3');
});
