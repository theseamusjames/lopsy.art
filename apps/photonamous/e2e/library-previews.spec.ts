import { expect, test, type Locator, type Page } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/**
 * Previews follow edits made outside the Edit view (spec 6.9): a preset
 * from the grid and a new version get new thumbnails in the background,
 * and keep them after a reload. "This browser" storage.
 */

async function applyPreset(page: Page, tile: Locator, name: string): Promise<void> {
  await tile.click();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('menu', { name: 'Presets' }).getByRole('menuitem', { name }).click();
  await expect(tile).toHaveAttribute('data-edited', 'true');
}

async function shownImage(tile: Locator): Promise<boolean> {
  return tile.locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
}

test('a preset from the grid and a new version get their own thumbnails', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'first.jpg', buffer: await generatedJpeg(page, 20, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const first = page.locator('[role="gridcell"][title="first.jpg"]');
  await expect(first).toBeVisible();
  const imported = (await first.getAttribute('data-preview-hash')) ?? '';
  expect(imported).not.toBe('');

  // A new version becomes the selected one, the photo's own tile, and shows a thumbnail at once (the same recipe
  // reuses the photo's previews)...
  await first.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'New version' }).click();
  await page.getByRole('dialog', { name: 'New version' }).getByRole('button', { name: 'Create' }).click();
  const original = page.locator('[role="gridcell"][title="first.jpg (Original)"]');
  await expect(original).toBeVisible();
  await expect(first).toHaveAttribute('data-preview-hash', imported, { timeout: 60_000 });
  await expect.poll(() => shownImage(first), { timeout: 30_000 }).toBe(true);

  // ...and its own after a preset from the grid, rendered in the background.
  await applyPreset(page, first, 'Punchy');
  // While it is being made the tile says so, and stops saying so when the picture has caught up.
  await expect(first).toHaveAttribute('data-updating', 'true');
  await expect(first.getByRole('img', { name: 'Updating' })).toBeVisible();
  await expect(first).not.toHaveAttribute('data-preview-hash', imported, { timeout: 60_000 });
  await expect(first).toHaveAttribute('data-updating', 'false');
  const firstHash = (await first.getAttribute('data-preview-hash')) ?? '';
  expect(firstHash).not.toBe('');
  await expect.poll(() => shownImage(first), { timeout: 30_000 }).toBe(true);

  // The original, the stack's other tile, with another preset.
  await applyPreset(page, original, 'Monochrome');
  await expect(original).not.toHaveAttribute('data-preview-hash', imported, { timeout: 60_000 });
  const originalHash = (await original.getAttribute('data-preview-hash')) ?? '';
  expect(originalHash).not.toBe(firstHash);

  // The sync panel has nothing left to update, and all of it survives a reload.
  await page.getByRole('button', { name: /Saved/ }).click({ timeout: 30_000 });
  await expect(page.getByRole('dialog', { name: 'Saving and storage' }).getByText(/^Updating/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(first).toHaveAttribute('data-preview-hash', firstHash, { timeout: 30_000 });
  await first.getByRole('button', { name: '2 versions' }).click();
  await expect(original).toHaveAttribute('data-preview-hash', originalHash);
  await expect.poll(() => shownImage(original), { timeout: 30_000 }).toBe(true);
});
