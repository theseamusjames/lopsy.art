import { expect, test } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/** Set aside moves the selection to the next photo, as Lightroom does; Undo (toast or Ctrl+Z) brings it back. */
test('set aside moves on, and undo brings the photo back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'one.jpg', buffer: await generatedJpeg(page, 30, 480, 320) },
    { name: 'two.jpg', buffer: await generatedJpeg(page, 120, 480, 320) },
    { name: 'three.jpg', buffer: await generatedJpeg(page, 210, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.getByRole('combobox', { name: 'Order by' }).selectOption('name');
  const tile = (name: string) => page.locator(`[role="gridcell"][title="${name}"]`);
  await expect(page.getByRole('gridcell')).toHaveCount(3);
  const names = await page.getByRole('gridcell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')));
  expect(names).toEqual(['one.jpg', 'three.jpg', 'two.jpg']);

  // X on the first: it leaves All photos and the next one is selected.
  await tile('one.jpg').click();
  await page.keyboard.press('x');
  await expect(tile('one.jpg')).toHaveCount(0);
  await expect(tile('three.jpg')).toHaveAttribute('aria-selected', 'true');

  // Ctrl+Z undoes it.
  await page.keyboard.press('Control+z');
  await expect(tile('one.jpg')).toBeVisible();
  await expect(page.getByRole('gridcell')).toHaveCount(3);

  // The last one set aside selects the one before it; the toast's Undo brings it back.
  await tile('two.jpg').click();
  await page.keyboard.press('x');
  await expect(tile('two.jpg')).toHaveCount(0);
  await expect(tile('three.jpg')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tile('two.jpg')).toBeVisible();
  await expect(tile('two.jpg')).toHaveAttribute('aria-selected', 'true');

  // Redo sets it aside again.
  await page.keyboard.press('Control+z');
  await expect(tile('two.jpg')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(tile('two.jpg')).toBeVisible();
});
