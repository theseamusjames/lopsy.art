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

  // A facet, with its count. Beside the details panel the row is too narrow for the filters: they are one menu.
  const filters = page.getByRole('group', { name: 'Filters' });
  await expect(filters.getByRole('button', { name: /^Camera/ })).toHaveCount(0);
  await filters.getByRole('button', { name: 'Filters', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Filters' });
  for (const facet of ['Camera', 'Lens', 'Rating', 'Label', 'File type', 'Edits']) await expect(menu.getByRole('group', { name: facet })).toBeAttached();
  const xt5 = menu.getByRole('group', { name: 'Camera' }).getByRole('checkbox', { name: /X-T5/ });
  await expect(menu.locator('label').filter({ has: page.getByRole('checkbox', { name: /X-T5/ }) })).toContainText('1');
  await xt5.check();
  await page.keyboard.press('Escape');
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAttribute('title', 'market.jpg');
  // The button says how many filters are on, and has focus again.
  await expect(filters.getByRole('button', { name: 'Filters, 1 on' })).toBeFocused();

  // With room for them, each filter is its own button in the row, the one in use saying what it is set to.
  await page.setViewportSize({ width: 1700, height: 800 });
  await expect(filters.getByRole('button', { name: /^Camera ?: X-T5$/ })).toBeVisible();
  await expect(filters.getByRole('button', { name: /^Filters/ })).toHaveCount(0);
  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await expect(tiles(page)).toHaveCount(3);
  await filters.getByRole('button', { name: /^Camera/ }).click();
  await page.getByRole('checkbox', { name: /X-T5/ }).check();
  await page.keyboard.press('Escape');
  await expect(tiles(page)).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(filters.getByRole('button', { name: 'Filters, 1 on' })).toBeVisible();

  // Saved as a search, then found again from the sidebar.
  await page.getByRole('button', { name: 'Save search' }).click();
  await page.getByRole('textbox', { name: 'Name this search' }).fill('The X-T5');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(3);
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^The X-T5/ }).click();
  await expect(tiles(page)).toHaveCount(1);

  // The date tree: 2025, then June, then the 14th. Each arrow sits beside its row, in the row's list item.
  const nav = page.getByRole('navigation', { name: 'Library' });
  const arrowOf = (row: RegExp) =>
    nav.getByRole('listitem').filter({ has: page.getByRole('button', { name: row }) }).last().getByRole('button', { name: /^Open/ }).first();
  await arrowOf(/^2025/).click();
  await arrowOf(/^June/).click();
  await nav.getByRole('button', { name: /14 June 2025/ }).click();
  await expect(tiles(page)).toHaveCount(2);
  // The year's row, not its arrow ("Open 2026").
  await nav.getByRole('button', { name: /^2026/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAttribute('title', 'snow.jpg');
});
