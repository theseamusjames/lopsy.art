/**
 * Without VITE_PHOTONAMOUS_URL (every build that does not ship Photonamous) Lopsy
 * is exactly as before: no Add to Photonamous item, and a
 * `?photos-handoff=` link is ignored. The handoff itself is covered by
 * photos-handoff.spec.ts, which runs with the URL set
 * (playwright.photos.config.ts).
 */
import { test, expect } from './fixtures';
import { createDocument, waitForStore } from './helpers';

test('a build without Photos has no Photos menu item and ignores handoff links', async ({ page }) => {
  await page.goto('/?photos-handoff=abc123');
  await waitForStore(page);
  // The parameter is left alone, and no "Receiving from Photonamous" overlay appears.
  expect(new URL(page.url()).searchParams.get('photos-handoff')).toBe('abc123');
  await expect(page.getByText('Receiving from Photonamous')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'New Document' })).toBeVisible();

  await createDocument(page, 200, 100, false);
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: 'Save Project' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add to Photonamous' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Photonamous' })).toHaveCount(0);
});
