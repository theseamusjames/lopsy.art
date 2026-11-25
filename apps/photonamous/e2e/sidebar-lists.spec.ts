import { expect, test } from './test';

/**
 * Off the happy path: a sidebar list with many rows. It shows its first
 * eight until it is opened out, keeps the selected row in sight, and
 * scrolls in its own room once opened.
 */
test('a long list of albums shows eight rows, Show all opens it in a room that scrolls, and the selected album stays in sight', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();

  const sidebar = page.getByRole('navigation', { name: 'Library' });
  const list = sidebar.getByTestId('album-list');
  const rows = list.getByRole('button', { name: /^Album \d\d/ });
  for (let i = 1; i <= 8; i++) {
    await sidebar.getByRole('button', { name: 'New album' }).click();
    await page.getByRole('textbox', { name: 'Album name' }).fill(`Album ${String(i).padStart(2, '0')}`);
    await page.keyboard.press('Enter');
  }
  // Eight is a short list: every row, and nothing to open.
  await expect(rows).toHaveCount(8);
  await expect(sidebar.getByRole('button', { name: /^Show all/ })).toHaveCount(0);

  for (let i = 9; i <= 12; i++) {
    await sidebar.getByRole('button', { name: 'New album' }).click();
    await page.getByRole('textbox', { name: 'Album name' }).fill(`Album ${String(i).padStart(2, '0')}`);
    await page.keyboard.press('Enter');
  }
  // The new album is the one the grid shows: it stays in the list, after the first eight.
  await expect(rows).toHaveCount(9);
  await expect(rows.last()).toHaveText(/^Album 12/);
  await expect(rows.last()).toHaveAttribute('aria-current', 'page');

  await sidebar.getByRole('button', { name: /^All photos/ }).click();
  await expect(rows).toHaveCount(8);
  const more = sidebar.getByRole('button', { name: 'Show all 12 albums', exact: true });
  await expect(more).toHaveText('Show all 12');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // Opened out: every album, in a room of its own that scrolls, not a sidebar twelve rows longer.
  await more.click();
  await expect(rows).toHaveCount(12);
  const fewer = sidebar.getByRole('button', { name: 'Show fewer albums', exact: true });
  await expect(fewer).toHaveAttribute('aria-expanded', 'true');
  const room = await list.evaluate((el) => ({ height: el.clientHeight, content: el.scrollHeight }));
  expect(room.height).toBeLessThanOrEqual(276);
  expect(room.content).toBeGreaterThan(room.height);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport();

  await fewer.click();
  await expect(rows).toHaveCount(8);
});
