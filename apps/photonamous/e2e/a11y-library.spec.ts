import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/**
 * The library by keyboard and screen reader (WCAG 2.2 AA), through the UI:
 * the grid is one tab stop whose keys move focus and the selection; Single
 * view, Compare, Cull, the Edit view, dialogs and the photo actions menu
 * (opened from the keyboard, outside the grid) give focus back to the tile
 * they came from; focus survives filters and scrolling; landmarks; the
 * sidebar's date tree; one h1 and a page title naming each view; and the
 * library reflowing to 320 px.
 */

test.use({ actionTimeout: 15_000 });

const NAMES = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];

async function openLibraryWithPhotos(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  const files = [];
  for (const [i, name] of NAMES.entries()) files.push({ name, buffer: await generatedJpeg(page, i * 60, 320, 240) });
  await importFiles(page, files);
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
  await page.getByRole('combobox', { name: 'Order by' }).selectOption('name');
  await expect(page.getByText(new RegExp(`^${NAMES.length} photos$`))).toBeVisible();
  await expect(cell(page, 'a.jpg')).toBeVisible();
}

function cell(page: Page, name: string) {
  return page.locator(`[role="gridcell"][title="${name}"]`);
}

/** The title of the element with keyboard focus, or its tag when it has none. */
async function focusedTitle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('title') ?? el?.tagName ?? '';
  });
}

async function focusedRole(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName ?? '');
}

test('the grid is one tab stop: arrows move and select, Home and End, Single view and back', async ({ page }) => {
  test.setTimeout(180_000);
  await openLibraryWithPhotos(page);

  // Tab from the last filter lands on the first photo, focused but not selected.
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Edits/ }).focus();
  await page.keyboard.press('Tab');
  await expect(cell(page, 'a.jpg')).toBeFocused();
  await expect(cell(page, 'a.jpg')).toHaveAttribute('aria-selected', 'false');

  // The arrows move focus and select, as a click does; Shift grows the selection.
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 'b.jpg')).toBeFocused();
  await expect(cell(page, 'b.jpg')).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, 'a.jpg')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(cell(page, 'c.jpg')).toBeFocused();
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(2);

  // End and Home go to the last and first photo.
  await page.keyboard.press('End');
  await expect(cell(page, 'e.jpg')).toBeFocused();
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(1);
  await page.keyboard.press('Home');
  await expect(cell(page, 'a.jpg')).toBeFocused();
  await expect(cell(page, 'a.jpg')).toHaveAttribute('aria-selected', 'true');

  // Ctrl/Cmd+Space adds a photo without moving the others; Ctrl/Cmd+A selects them all.
  await page.keyboard.press('Control+ArrowRight');
  await expect(cell(page, 'b.jpg')).toBeFocused();
  await expect(cell(page, 'b.jpg')).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(NAMES.length);

  // Only one tile is a tab stop: Tab leaves the grid.
  expect(await page.locator('[role="gridcell"][tabindex="0"]').count()).toBe(1);
  await page.keyboard.press('Tab');
  expect(await focusedRole(page)).not.toBe('gridcell');
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 'b.jpg')).toBeFocused();

  // Space opens the focused photo in Single view; Escape comes back to the same tile.
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 'c.jpg')).toBeFocused();
  await page.keyboard.press(' ');
  await expect(page.getByRole('heading', { level: 1, name: 'c.jpg' })).toBeVisible();
  await expect(page.getByRole('grid')).toHaveCount(0);
  expect(await focusedTitle(page)).not.toBe('BODY');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { level: 1, name: 'd.jpg' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell(page, 'd.jpg')).toBeFocused();
});

test('the photo actions menu opens from the keyboard, outside the grid, and gives focus back', async ({ page }) => {
  test.setTimeout(180_000);
  await openLibraryWithPhotos(page);
  await cell(page, 'b.jpg').click();
  await expect(cell(page, 'b.jpg')).toBeFocused();

  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Photo actions' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('grid').getByRole('menu')).toHaveCount(0);
  expect(await focusedRole(page)).toBe('menuitem');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(cell(page, 'b.jpg')).toBeFocused();

  // Moving to the trash from the menu leaves focus on the next photo.
  await page.keyboard.press('ContextMenu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Move to the trash/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to the trash' }).click();
  await expect(cell(page, 'b.jpg')).toHaveCount(0);
  await expect(cell(page, 'c.jpg')).toBeFocused();
});

test('the date tree opens by keyboard, its arrow beside the row rather than inside it', async ({ page }) => {
  test.setTimeout(180_000);
  await openLibraryWithPhotos(page);
  const nav = page.getByRole('navigation', { name: 'Library' });
  const year = nav.getByRole('button', { name: /^\d{4}\b/ }).first();
  const months = nav.getByRole('button', { name: /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/ });

  // Enter chooses the row: a focused button is pressed, not taken by a shortcut.
  await year.focus();
  await page.keyboard.press('Enter');
  await expect(year).toHaveAttribute('aria-current', 'page');

  // The arrow comes just before its row in the tab order, and neither is inside the other.
  await page.keyboard.press('Shift+Tab');
  const arrow = page.locator(':focus');
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  // Named for the year it opens, once: "Open 2026".
  await expect(arrow).toHaveAccessibleName(/^Open \d{4}$/);
  expect(await arrow.evaluate((el) => el.parentElement?.closest('button, [role="button"]') ?? null)).toBeNull();
  expect(await year.evaluate((el) => el.querySelector('button, [role="button"], [tabindex]'))).toBeNull();

  await page.keyboard.press('Enter');
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  await expect(arrow).toHaveAccessibleName(/^Close \d{4}$/);
  await expect(months.first()).toBeVisible();
  await page.keyboard.press(' ');
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await expect(months).toHaveCount(0);
});

test('landmarks, one h1 per view, and a page title that names the view', async ({ page }) => {
  test.setTimeout(180_000);
  await openLibraryWithPhotos(page);
  await expect(page).toHaveTitle('All photos – Photonamous');
  await expect(page.locator('h1')).toHaveCount(1);

  // Landmarks and headings let keyboard and screen reader users move past the header and sidebar (2.4.1).
  await page.reload();
  await expect(page.getByRole('gridcell')).toHaveCount(NAMES.length, { timeout: 30_000 });
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Library' })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Skip to photos' })).toHaveCount(0);
  await page.locator('[role="gridcell"][tabindex="0"]').focus();
  expect(await focusedRole(page)).toBe('gridcell');
  const first = await focusedTitle(page);

  // Single view: its photo is the h1 and the title; the photo zooms from the keyboard.
  await page.keyboard.press(' ');
  await expect(page).toHaveTitle(`${first} – Photonamous`);
  await expect(page.locator('h1')).toHaveCount(1);
  const zoom = page.getByRole('button', { name: `Look closer at ${first}` });
  await zoom.focus();
  await page.keyboard.press('Enter');
  await expect(zoom).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(zoom).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { level: 1, name: first })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell(page, first)).toBeFocused();

  // Compare: two photos, the arrows choose the one the keys mark, Escape returns to the grid.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('c');
  await expect(page).toHaveTitle('Compare – Photonamous');
  await expect(page.getByRole('heading', { level: 1, name: 'Compare 2 photos' })).toBeAttached();
  const region = page.getByRole('region', { name: 'Compare 2 photos' });
  await expect(region).toBeFocused();
  const panes = region.getByRole('group');
  await expect(panes).toHaveCount(2);
  const marked = region.locator('[role="group"][aria-current="true"]');
  const before = await marked.getAttribute('aria-label');
  await page.keyboard.press(before === (await panes.first().getAttribute('aria-label')) ? 'ArrowRight' : 'ArrowLeft');
  await expect(marked).not.toHaveAttribute('aria-label', before ?? '');
  await page.keyboard.press('Escape');
  expect(await focusedRole(page)).toBe('gridcell');

  // Another collection names the page after it.
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^Set aside/ }).click();
  await expect(page).toHaveTitle('Set aside – Photonamous');
  await expect(page.locator('h1')).toHaveCount(1);
});

test('a dialog leaves the library behind it out of reach, and focus comes back after', async ({ page }) => {
  test.setTimeout(180_000);
  await openLibraryWithPhotos(page);
  const settings = page.getByRole('button', { name: 'Settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  expect(await page.locator('header').first().evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
  expect(await dialog.evaluate((el) => el.closest('[inert]') === null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect(await page.locator('header').first().evaluate((el) => el.closest('[inert]') !== null)).toBe(false);
});

/** Controls that stick out past the window's right edge, where nothing could reach them. */
async function cutOffControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="gridcell"]'))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right > window.innerWidth + 1 || r.left < -1) out.push(el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName);
    }
    return out;
  });
}

test('at 320 px wide the library stacks into one column and nothing is cut off', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 640 });
  await openLibraryWithPhotos(page);
  await cell(page, 'a.jpg').click();
  expect(await cutOffControls(page)).toEqual([]);

  // Sidebar, grid and details panel come one after another; the screen scrolls to each.
  const nav = page.getByRole('navigation', { name: 'Library' });
  const details = page.getByRole('complementary', { name: 'Details' });
  const navBox = await nav.boundingBox();
  const gridBox = await page.getByRole('grid').boundingBox();
  expect(navBox && gridBox && navBox.y + navBox.height <= gridBox.y + 1).toBe(true);
  await details.getByRole('radiogroup', { name: 'Rating' }).scrollIntoViewIfNeeded();
  await expect(details.getByRole('radiogroup', { name: 'Rating' })).toBeInViewport();

  await page.keyboard.press(' ');
  await expect(page.getByRole('heading', { level: 1, name: 'a.jpg' })).toBeVisible();
  expect(await cutOffControls(page)).toEqual([]);
});

test('Enter edits the focused photo, and closing the Edit view gives focus back to its tile', async ({ page }) => {
  test.setTimeout(240_000);
  await openLibraryWithPhotos(page);
  await cell(page, 'c.jpg').click();
  await page.keyboard.press('Enter');
  const edit = page.getByTestId('edit-view');
  await expect(edit).toBeVisible({ timeout: 60_000 });
  // The library behind the Edit view is out of reach.
  await expect.poll(() => page.locator('nav').first().evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
  await edit.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(cell(page, 'c.jpg')).toBeFocused();
  await expect(page).toHaveTitle('All photos – Photonamous');
});

test('Cull is a full-screen dialog; leaving it is announced and focus returns to the photo', async ({ page }) => {
  test.setTimeout(180_000);
  await openLibraryWithPhotos(page);
  await cell(page, 'b.jpg').click();
  await page.keyboard.press('f');
  const cull = page.getByRole('dialog', { name: 'Cull: b.jpg' });
  await expect(cull).toBeVisible();
  await expect(cull).toBeFocused();
  await expect(page).toHaveTitle('b.jpg – Cull – Photonamous');
  // Marking moves on, and the next photo is said.
  await page.keyboard.press('3');
  await expect(page.getByRole('dialog', { name: 'Cull: c.jpg' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'c.jpg, 3 of 5' })).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Left full screen' })).toBeAttached();
  await expect(cell(page, 'c.jpg')).toBeFocused();
});

test('focus stays on a tile when a filter takes the focused photo away, and while the grid scrolls', async ({ page }) => {
  test.setTimeout(240_000);
  await openLibraryWithPhotos(page);
  // Two photos rated 2, shown alone by the Rating filter.
  await cell(page, 'b.jpg').click();
  await page.keyboard.press('2');
  await cell(page, 'c.jpg').click();
  await page.keyboard.press('2');
  await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: /^Rating/ }).click();
  await page.getByRole('checkbox', { name: /^2 stars or more/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('gridcell')).toHaveCount(2);
  await cell(page, 'b.jpg').click();
  await expect(cell(page, 'b.jpg')).toBeFocused();
  // Clearing b's rating takes it out of the grid; focus moves to the photo left.
  await page.keyboard.press('0');
  await expect(cell(page, 'b.jpg')).toHaveCount(0);
  await expect(cell(page, 'c.jpg')).toBeFocused();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  // Big tiles: only a few rows are rendered. Scrolling the grid away keeps the focused tile, and focus.
  await page.getByRole('slider', { name: 'Thumbnail size' }).fill('360');
  await cell(page, 'a.jpg').click();
  await expect(cell(page, 'a.jpg')).toBeFocused();
  const more = [];
  for (let i = 0; i < 16; i++) more.push({ name: `z${String(i).padStart(2, '0')}.jpg`, buffer: await generatedJpeg(page, i * 20, 64, 48) });
  await importFiles(page, more);
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
  await page.getByRole('combobox', { name: 'Order by' }).selectOption('name');
  await cell(page, 'a.jpg').click();
  const rendered = await page.getByRole('gridcell').count();
  expect(rendered).toBeLessThan(21);
  await page.getByRole('grid').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByRole('gridcell').last()).toHaveAttribute('title', 'z15.jpg');
  await expect(cell(page, 'a.jpg')).toBeFocused();
  // The arrows carry on from the focused photo, wherever the grid was scrolled.
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 'b.jpg')).toBeFocused();
  await expect(cell(page, 'b.jpg')).toBeInViewport();
});
