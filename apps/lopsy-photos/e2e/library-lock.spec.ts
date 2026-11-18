import { expect, test } from '@playwright/test';
import { tiles } from './library';

/** One tab writes to a library at a time; a second tab can take it over. */
test('a second tab takes the library over, and the first one says so', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('This library is open in another tab')).toBeVisible({ timeout: 30_000 });
  await second.getByRole('button', { name: 'Use it here' }).click();
  await expect(second.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('Opened in another tab')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Reload to work here' })).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);
});
