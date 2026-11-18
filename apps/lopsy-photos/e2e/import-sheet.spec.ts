import { expect, test } from '@playwright/test';
import { generatedJpeg } from './library';

/** The import sheet adds to an album with keywords, and warns about photos already in the library before importing. */
test('import into a new album with keywords; duplicates are named before import', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  const first = await generatedJpeg(page, 70, 480, 320);
  const second = await generatedJpeg(page, 170, 480, 320);

  await page.getByRole('button', { name: /Import photos/ }).first().click();
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles([
    { name: 'beach.jpg', mimeType: 'image/jpeg', buffer: first },
    { name: 'dunes.jpg', mimeType: 'image/jpeg', buffer: second },
  ]);
  await page.getByRole('combobox', { name: 'Album for the import' }).selectOption('new');
  await page.getByRole('textbox', { name: 'New album name' }).fill('Coast');
  await page.getByRole('textbox', { name: 'Keywords for the import' }).fill('sea, summer');
  await page.getByRole('button', { name: 'Import 2 photos' }).click();
  await expect(page.getByText(/^Imported 2 photo/)).toBeVisible({ timeout: 60_000 });

  const sidebar = page.getByRole('navigation', { name: 'Library' });
  await expect(sidebar.getByRole('button', { name: /^Coast 2$/ })).toBeVisible({ timeout: 30_000 });
  await expect(sidebar.getByRole('button', { name: /^sea 2$/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /^summer 2$/ })).toBeVisible();

  // Picking one of them again with a new one: the sheet says so before anything starts.
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles([
    { name: 'beach.jpg', mimeType: 'image/jpeg', buffer: first },
    { name: 'cliff.jpg', mimeType: 'image/jpeg', buffer: await generatedJpeg(page, 240, 480, 320) },
  ]);
  await expect(page.getByText('1 is already in the library and will be skipped: beach.jpg.')).toBeVisible();
  await expect(page.getByText('1 new photo,', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 photo' }).click();
  await expect(page.getByText(/^Imported 1 photo/)).toBeVisible({ timeout: 60_000 });
});
