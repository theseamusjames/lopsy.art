import { expect, test } from '@playwright/test';
import { waitForReady } from './harness';
import { generatedJpeg, importFiles } from './library';

/**
 * Undo after a delete brings the photo back with its files: ⌘Z right after
 * the delete takes the original out of the trash as well, so the photo
 * opens in Edit and Check library finds nothing in the trash.
 */
test('delete, then Ctrl+Z: the photo and its original come back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'keep.jpg', buffer: await generatedJpeg(page, 60, 480, 320) },
    { name: 'gone.jpg', buffer: await generatedJpeg(page, 160, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const gone = page.locator('[role="gridcell"][title="gone.jpg"]');
  await gone.click();
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Move to the trash' }).click();
  await expect(gone).toHaveCount(0);
  await expect(page.getByText(/^Moved 1 photo to the trash\./)).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(gone).toBeVisible({ timeout: 30_000 });
  await expect(gone).toHaveAttribute('aria-selected', 'true');

  // The original reads: the Edit view develops it.
  await gone.click();
  await page.keyboard.press('Enter');
  await waitForReady(page, 60_000);
  await page.getByTestId('edit-view').getByRole('button', { name: 'Library', exact: true }).click();

  // And nothing is left in the trash.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Check library' }).click();
  await expect(page.getByText('All 2 originals are where they should be.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/in the trash/)).toHaveCount(0);
});
