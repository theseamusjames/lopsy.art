import { expect, test } from '@playwright/test';
import { withExif } from './exif';
import { generatedJpeg, importFiles, tiles } from './library';

/** Finding photos: text, a facet, a saved search and the date tree, on JPEGs with camera dates. */
test('find photos by text, camera, saved search and date', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();

  await importFiles(page, [
    { name: 'harbour.jpg', buffer: withExif(await generatedJpeg(page, 200, 320, 240), { capturedAt: '2025-06-14T09:30:00', make: 'FUJIFILM', model: 'X100VI' }) },
    { name: 'market.jpg', buffer: withExif(await generatedJpeg(page, 40, 320, 240), { capturedAt: '2025-06-14T11:00:00', make: 'FUJIFILM', model: 'X-T5' }) },
    { name: 'snow.jpg', buffer: withExif(await generatedJpeg(page, 300, 320, 240), { capturedAt: '2026-01-02T15:00:00', make: 'FUJIFILM', model: 'X100VI' }) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(3);

  // Free text.
  await page.getByRole('searchbox', { name: 'Find photos' }).fill('harbour');
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAttribute('title', 'harbour.jpg');
  await page.getByRole('searchbox', { name: 'Find photos' }).fill('');
  await expect(tiles(page)).toHaveCount(3);

  // A facet, with its count.
  await page.getByRole('toolbar', { name: 'Filters' }).getByRole('button', { name: /^Camera/ }).click();
  const xt5 = page.getByRole('checkbox', { name: /X-T5/ });
  await expect(page.locator('label', { has: xt5 })).toContainText('1');
  await xt5.check();
  await page.keyboard.press('Escape');
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAttribute('title', 'market.jpg');

  // Saved as a search, then found again from the sidebar.
  await page.getByRole('button', { name: 'Save search' }).click();
  await page.getByRole('textbox', { name: 'Name this search' }).fill('The X-T5');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(3);
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^The X-T5/ }).click();
  await expect(tiles(page)).toHaveCount(1);

  // The date tree: 2025, then June, then the 14th.
  const nav = page.getByRole('navigation', { name: 'Library' });
  await nav.getByRole('button', { name: /2025/ }).first().locator('[aria-label="Open"]').click();
  await nav.getByRole('button', { name: /June/ }).locator('[aria-label="Open"]').click();
  await nav.getByRole('button', { name: /14 June 2025/ }).click();
  await expect(tiles(page)).toHaveCount(2);
  await nav.getByRole('button', { name: /2026/ }).first().click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAttribute('title', 'snow.jpg');
});
