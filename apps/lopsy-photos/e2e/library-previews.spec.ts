import { expect, test, type Locator, type Page } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/**
 * Previews follow edits made outside the Edit view (spec 6.9): a preset
 * from the grid and a new version get new thumbnails in the background,
 * and keep them after a reload. "This browser" storage.
 */

async function applyPreset(page: Page, tile: Locator, name: string): Promise<void> {
  await tile.click();
  await page.getByRole('button', { name: 'Apply a preset to the selected photos' }).click();
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

  // A new version shows a thumbnail at once (the same recipe reuses the photo's previews)...
  await first.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'New version' }).click();
  const version = page.locator('[role="gridcell"][title="first.jpg (Version 2)"]');
  await expect(version).toBeVisible();
  await expect(version).toHaveAttribute('data-preview-hash', imported, { timeout: 60_000 });
  await expect.poll(() => shownImage(version), { timeout: 30_000 }).toBe(true);

  // ...and its own after a preset from the grid, rendered in the background.
  await applyPreset(page, version, 'Punchy');
  await expect(version).not.toHaveAttribute('data-preview-hash', imported, { timeout: 60_000 });
  const versionHash = (await version.getAttribute('data-preview-hash')) ?? '';
  expect(versionHash).not.toBe('');
  await expect.poll(() => shownImage(version), { timeout: 30_000 }).toBe(true);

  // The photo itself, with another preset.
  await applyPreset(page, first, 'Monochrome');
  await expect(first).not.toHaveAttribute('data-preview-hash', imported, { timeout: 60_000 });
  const firstHash = (await first.getAttribute('data-preview-hash')) ?? '';
  expect(firstHash).not.toBe(versionHash);

  // The sync panel has nothing left to update, and all of it survives a reload.
  await page.getByRole('button', { name: /Saved/ }).click({ timeout: 30_000 });
  await expect(page.getByRole('dialog', { name: 'Saving and storage' }).getByText(/^Updating/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(first).toHaveAttribute('data-preview-hash', firstHash, { timeout: 30_000 });
  await first.getByRole('button', { name: '2 versions' }).click();
  await expect(version).toHaveAttribute('data-preview-hash', versionHash);
  await expect.poll(() => shownImage(version), { timeout: 30_000 }).toBe(true);
});
