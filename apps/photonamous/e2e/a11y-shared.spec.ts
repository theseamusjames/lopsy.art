import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * The shared components by keyboard alone (WCAG 2.1.1, 2.1.2, 2.4.3):
 * menus, dialogs, popovers and the rating and label pickers, in the
 * library on "This browser". Focus is put on a control the way Tab would
 * reach it; everything after that is keys.
 */

const tile = (page: Page, name: string) => page.locator(`[role="gridcell"][title="${name}"]`);

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15_000 });
  await importFiles(page, [
    { name: 'one.jpg', buffer: await generatedJpeg(page, 30, 480, 320) },
    { name: 'two.jpg', buffer: await generatedJpeg(page, 150, 480, 320) },
    { name: 'three.jpg', buffer: await generatedJpeg(page, 270, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Order by' }).selectOption('name');
  await tile(page, 'one.jpg').click();
  await expect(tile(page, 'one.jpg')).toHaveAttribute('aria-selected', 'true');
}

test.beforeEach(async ({ page }) => {
  await openLibrary(page);
});

test('a menu opens with Enter, moves with the arrows, and Escape puts focus back on its trigger', async ({ page }) => {
  const more = page.getByRole('button', { name: 'More', exact: true });
  await more.focus();
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const newVersion = menu.getByRole('menuitem', { name: /^New version/ });
  const editInLopsy = menu.getByRole('menuitem', { name: /^Edit in Lopsy/ });
  const groupBursts = menu.getByRole('menuitemcheckbox', { name: /^Group bursts/ });
  await expect(newVersion).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(editInLopsy).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(groupBursts).toBeFocused();
  // Past the last item it wraps to the first, and back.
  await page.keyboard.press('ArrowDown');
  await expect(newVersion).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(groupBursts).toBeFocused();
  await page.keyboard.press('Home');
  await expect(newVersion).toBeFocused();
  await page.keyboard.press('End');
  await expect(groupBursts).toBeFocused();

  // A key pressed in the menu is the menu's: ArrowRight does not move the grid's selection behind it.
  await page.keyboard.press('ArrowRight');
  await expect(tile(page, 'one.jpg')).toHaveAttribute('aria-selected', 'true');
  await expect(tile(page, 'three.jpg')).toHaveAttribute('aria-selected', 'false');

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // The Photo actions menu works the same, and sits in the main landmark beside the grid, not inside it.
  await tile(page, 'one.jpg').click({ button: 'right' });
  const actions = page.getByRole('main').getByRole('menu', { name: 'Photo actions' });
  await expect(actions).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Photos' }).getByRole('menu')).toHaveCount(0);
  await expect(actions.getByRole('menuitem', { name: 'Look at it large' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(actions.getByRole('menuitem', { name: 'Move to the trash…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a dialog keeps Tab inside it, and Escape puts focus back where it was', async ({ page }) => {
  const more = page.getByRole('button', { name: 'More', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /^New version/ })).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'New version' });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole('textbox', { name: 'Version name' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const create = dialog.getByRole('button', { name: 'Create' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(name).toBeFocused();

  // Forward: the name, Cancel, Create, then round to Close and the name again, never the page behind.
  for (const next of [cancel, create, close, name, cancel]) {
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
  }
  // And back the other way, past the start to the end.
  for (const previous of [name, close, create]) {
    await page.keyboard.press('Shift+Tab');
    await expect(previous).toBeFocused();
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  // Escape made nothing: no version tile.
  await expect(page.getByRole('gridcell')).toHaveCount(3);
});

test('a popover takes focus when it opens and gives it back when it closes', async ({ page }) => {
  const help = page.getByRole('button', { name: 'Keyboard shortcuts' });
  await help.focus();
  await page.keyboard.press('Enter');
  const popover = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(popover).toBeVisible();
  // The list scrolls, so it takes focus (and the arrows scroll it).
  const list = popover.getByRole('region', { name: 'Shortcut list' });
  await expect(list).toBeFocused();
  // Enter pressed the button only: it did not also open the editor for the selected photo.
  await expect(page.getByTestId('edit-view')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(tile(page, 'one.jpg')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(help).toBeFocused();

  // Closed by a click elsewhere, it leaves focus where the click put it.
  await page.keyboard.press('Enter');
  await expect(list).toBeFocused();
  const find = page.getByRole('searchbox', { name: 'Find photos' });
  await find.click();
  await expect(popover).toHaveCount(0);
  await expect(find).toBeFocused();
});

test('the rating and the colour label are one Tab stop each, set with the arrow keys', async ({ page }) => {
  const one = tile(page, 'one.jpg');
  const details = page.getByRole('complementary', { name: 'Details' });
  const rating = details.getByRole('radiogroup', { name: 'Rating' });
  const star = (n: number) => rating.getByRole('radio', { name: n === 1 ? '1 star' : `${n} stars`, exact: true });

  // Unrated, the first star is the group's one stop.
  await expect(star(1)).toHaveAttribute('tabindex', '0');
  await expect(star(2)).toHaveAttribute('tabindex', '-1');
  await star(1).focus();

  await page.keyboard.press('ArrowRight');
  await expect(star(2)).toBeFocused();
  await expect(star(2)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(star(3)).toBeFocused();
  await expect(one).toHaveAttribute('data-rating', '3');
  await expect(star(3)).toHaveAttribute('tabindex', '0');
  // The arrows were the stars': the grid's selection did not move.
  await expect(one).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(one).toHaveAttribute('data-rating', '2');
  await page.keyboard.press('End');
  await expect(one).toHaveAttribute('data-rating', '5');
  await page.keyboard.press('Home');
  await expect(one).toHaveAttribute('data-rating', '1');
  await expect(star(1)).toBeFocused();
  // Space on the chosen star clears the rating, as a click on it does.
  await page.keyboard.press(' ');
  await expect(one).toHaveAttribute('data-rating', '0');
  await page.keyboard.press('ArrowRight');
  await expect(one).toHaveAttribute('data-rating', '2');

  // Tab leaves the stars in one step, onto the label picker's chosen radio (No label).
  await page.keyboard.press('Tab');
  await expect(rating.locator(':focus')).toHaveCount(0);
  const labels = details.getByRole('radiogroup', { name: 'Colour label' });
  await expect(labels.getByRole('radio', { name: 'No label' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(labels.getByRole('radio', { name: 'Red label' })).toBeFocused();
  await expect(labels.getByRole('radio', { name: 'Red label' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(labels.getByRole('radio', { name: 'Yellow label' })).toHaveAttribute('aria-checked', 'true');
  await expect(labels.getByRole('radio', { name: 'Red label' })).toHaveAttribute('aria-checked', 'false');
});
