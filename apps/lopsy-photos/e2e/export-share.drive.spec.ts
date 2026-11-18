import { expect, test } from '@playwright/test';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * After an export to Drive (spec 5.5, Afterwards): Show in Drive, and Copy
 * share link, which shares the export folder only after the user confirms
 * what anyone with the link can see; then Stop sharing. Against
 * photos-core's fake Drive.
 */
test('Google Drive: share an export folder by link, then stop sharing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const drive = await routeFakeDrive(context);
  await page.addInitScript(gisStubInitScript());
  await page.goto('/');
  await page.getByRole('button', { name: /Google Drive/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });

  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 190) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Shared trip');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByText('Exported 1 photo.')).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Exported to “Shared trip”. Share it from the sync panel.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show in Drive' }).first()).toBeVisible();

  await page.getByRole('button', { name: /Saved/ }).click();
  const panel = page.getByRole('dialog', { name: 'Saving and storage' });
  await panel.getByRole('button', { name: 'Copy share link' }).click();

  // Nothing is shared before the user confirms, and the dialog says exactly what sharing means.
  const confirm = page.getByRole('dialog', { name: 'Share this export?' });
  await expect(confirm).toContainText('Anyone who has the link will be able to see and download the 1 photo in the export folder “Shared trip”');
  expect(drive.requests.some((request) => request.url.pathname.endsWith('/permissions'))).toBe(false);
  await confirm.getByRole('button', { name: 'Share and copy link' }).click();
  await expect(panel.getByText(/Link copied/)).toBeVisible();

  const link = await page.evaluate(() => navigator.clipboard.readText());
  const folderId = /\/drive\/folders\/([^/?]+)/.exec(link)?.[1] ?? '';
  expect(folderId).not.toBe('');
  expect(drive.isSharedWithAnyone(folderId)).toBe(true);
  expect(await panel.getByLabel('Share link').inputValue()).toBe(link);

  await panel.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(panel.getByRole('button', { name: 'Copy share link' })).toBeEnabled();
  await expect.poll(() => drive.isSharedWithAnyone(folderId)).toBe(false);
});
