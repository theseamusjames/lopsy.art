import { expect, test } from '@playwright/test';
import { raiseExposure, waitForReady } from './harness';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * The library in "This browser" storage (OPFS + IndexedDB), end to end:
 * import, rate, edit, and everything still there after a reload.
 */
test('This browser: import, rate, edit, reload, delete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();

  await importFiles(page, [
    { name: 'first.jpg', buffer: await generatedJpeg(page, 20) },
    { name: 'second.jpg', buffer: await generatedJpeg(page, 200) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(2);

  // Rate the first one.
  const first = tiles(page).first();
  const id = (await first.getAttribute('data-asset-id')) ?? '';
  const tile = page.locator(`[data-asset-id="${id}"]`);
  await tile.click();
  await page.keyboard.press('4');
  await expect(tile).toHaveAttribute('data-rating', '4');
  const importedHash = (await tile.getAttribute('data-preview-hash')) ?? '';

  // Edit it: Exposure up, back to the library; the tile's preview follows the edit.
  await page.keyboard.press('Enter');
  await waitForReady(page, 60_000);
  await raiseExposure(page, 5);
  await expect(page.getByLabel('Exposure value')).toHaveValue('+0.50');
  await page.getByTestId('edit-view').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(tile).toHaveAttribute('data-edited', 'true');
  await expect(tile).not.toHaveAttribute('data-preview-hash', importedHash, { timeout: 60_000 });
  const editedHash = (await tile.getAttribute('data-preview-hash')) ?? '';
  // Let the change reach storage before reloading.
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });

  // Reload: the library reopens by itself with the rating and the edit.
  await page.reload();
  await expect(tiles(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(tile).toHaveAttribute('data-rating', '4');
  await expect(tile).toHaveAttribute('data-edited', 'true');
  await expect(tile).toHaveAttribute('data-preview-hash', editedHash);

  // Export the edited one into the library's Exports folder, rendered by the engine.
  await tile.click();
  await page.getByRole('button', { name: /^Export 1/ }).click();
  // From a built-in preset, then saved as the user's own.
  await page.getByRole('combobox', { name: 'Export preset' }).selectOption({ label: 'Web, 2048 px, sRGB' });
  await expect(page.getByRole('radio', { name: /^JPEG/ })).toBeChecked();
  await page.getByRole('button', { name: 'Save these settings as a preset' }).click();
  await page.getByRole('textbox', { name: 'Preset name' }).fill('My web');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Export preset' })).toHaveValue(/.+/);
  await expect(page.getByRole('combobox', { name: 'Export preset' }).locator('option', { hasText: 'My web' })).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Folder name' }).fill('E2E');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByText('Exported 1 photo.')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const exported = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await (await (await (await root.getDirectoryHandle('photonamous')).getDirectoryHandle('Lopsy Photos')).getDirectoryHandle('Exports')).getDirectoryHandle('E2E');
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    return names;
  });
  expect(exported).toEqual([await tile.getAttribute('title')]);

  // Delete the other one; it stays gone after a reload.
  const ids = await tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-asset-id') ?? ''));
  const otherId = ids.find((x) => x !== id) ?? '';
  expect(otherId).not.toBe('');
  await page.locator(`[data-asset-id="${otherId}"]`).click();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Move to the trash' }).click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(tiles(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator(`[data-asset-id="${otherId}"]`)).toHaveCount(0);
});
