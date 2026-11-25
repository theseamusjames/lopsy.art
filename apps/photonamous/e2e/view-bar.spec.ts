import { expect, test, type Page } from './test';
import { axeViolations } from './axe';
import { generatedJpeg, importFiles } from './library';

/**
 * The bar under the gallery: thumbnail size at the left, the ways of
 * looking at the right (Grid, One photo, Two up, Four up, Full screen). The same
 * bar sits under the photos side by side, where four can be narrowed to
 * the two ticked.
 */

const NAMES = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  const files = [];
  for (const [i, name] of NAMES.entries()) files.push({ name, buffer: await generatedJpeg(page, i * 60, 320, 240) });
  await importFiles(page, files);
  await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
  await page.getByRole('combobox', { name: 'Order by' }).selectOption('name');
  await expect(page.locator('[role="gridcell"][title="a.jpg"]')).toBeVisible();
}

function shown(page: Page): Promise<(string | null)[]> {
  return page.locator('[data-pane]').evaluateAll((panes) => panes.map((pane) => pane.getAttribute('aria-label')));
}

test('the bar under the gallery has the size at the left and the views at the right', async ({ page }) => {
  await openLibrary(page);
  const views = page.getByRole('group', { name: 'View' });
  await expect(views.getByRole('button')).toHaveText(['', '', '', '', '']);
  await expect(views.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  const size = page.getByRole('slider', { name: 'Thumbnail size' });
  const sizeBox = await size.boundingBox();
  const viewsBox = await views.boundingBox();
  const grid = await page.getByRole('grid').boundingBox();
  if (!sizeBox || !viewsBox || !grid) throw new Error('The bar is not on screen');
  // Under the photos, the slider towards the left edge and the views towards the right.
  expect(sizeBox.y).toBeGreaterThan(grid.y + grid.height - 1);
  expect(sizeBox.x + sizeBox.width).toBeLessThan(viewsBox.x);
  // The toolbar above no longer has them.
  await expect(page.getByRole('button', { name: /^Compare/ })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Thumbnail size' })).toHaveCount(1);
  expect(await axeViolations(page)).toEqual([]);
});

test('Four up shows four photos, two ticked there are what Two up then shows, and Grid goes back', async ({ page }) => {
  await openLibrary(page);
  const views = page.getByRole('group', { name: 'View' });

  // Nothing is selected: four up starts from the first photo.
  await views.getByRole('button', { name: 'Four up' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare 4 photos' })).toBeAttached();
  expect(await shown(page)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  await expect(views.getByRole('button', { name: 'Four up' })).toHaveAttribute('aria-pressed', 'true');
  // No thumbnails here, so no size slider.
  await expect(page.getByRole('slider', { name: 'Thumbnail size' })).toHaveCount(0);

  // Tick two, and Two up is those two.
  await page.getByRole('checkbox', { name: 'Pick b.jpg' }).check();
  await page.getByRole('checkbox', { name: 'Pick d.jpg' }).check();
  expect(await axeViolations(page)).toEqual([]);
  await views.getByRole('button', { name: /^Two up/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare 2 photos' })).toBeAttached();
  expect(await shown(page)).toEqual(['b.jpg', 'd.jpg']);
  await expect(views.getByRole('button', { name: /^Two up/ })).toHaveAttribute('aria-pressed', 'true');
  // Two on show: nothing to narrow, so no ticks.
  await expect(page.getByRole('checkbox', { name: /^Pick/ })).toHaveCount(0);

  // Back out to four: those two, the one between them and the one that follows.
  await views.getByRole('button', { name: 'Four up' }).click();
  expect(await shown(page)).toEqual(['b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']);

  // Grid is the way back, and what was on show is what is selected.
  await views.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByText('5 photos · 4 selected')).toBeVisible();
});

test('Two up from the gallery shows the two selected, or the focused photo and the next', async ({ page }) => {
  await openLibrary(page);
  const views = page.getByRole('group', { name: 'View' });
  await page.locator('[role="gridcell"][title="c.jpg"]').click();
  await views.getByRole('button', { name: /^Two up/ }).click();
  expect(await shown(page)).toEqual(['c.jpg', 'd.jpg']);
  await page.keyboard.press('Escape');

  await page.locator('[role="gridcell"][title="a.jpg"]').click();
  await page.locator('[role="gridcell"][title="e.jpg"]').click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('c');
  expect(await shown(page)).toEqual(['a.jpg', 'e.jpg']);

  // One photo, from the bar under the two.
  await views.getByRole('button', { name: /^One photo/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^(a|e)\.jpg$/ })).toBeVisible();
});
