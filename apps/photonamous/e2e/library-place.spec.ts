import { expect, test, type Locator, type Page } from './test';
import { importFiles } from './library';

/**
 * The grid keeps its place: open a photo far down the grid in the Single
 * view (or Compare, or the Edit view), come back by any way there is, and
 * the grid is scrolled where it was with that photo's tile focused; moved
 * on to another photo meanwhile, the grid shows that one, scrolled no more
 * than it takes to show it.
 */

test.use({ actionTimeout: 15_000 });

const COUNT = 120;
/** The grid's padding inside its scroller (PhotoGrid's PADDING). */
const PADDING = 12;

/** `count` small JPEGs, drawn in the page with OffscreenCanvas, each a different hue. */
async function generatedJpegs(page: Page, count: number): Promise<{ name: string; buffer: Buffer }[]> {
  const all = await page.evaluate(async (n) => {
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      const canvas = new OffscreenCanvas(160, 120);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = `hsl(${(i * 37) % 360} 55% 45%)`;
      ctx.fillRect(0, 0, 160, 120);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      out.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
    }
    return out;
  }, count);
  return all.map((bytes, i) => ({ name: `place-${String(i + 1).padStart(3, '0')}.jpg`, buffer: Buffer.from(bytes) }));
}

async function openLibrary(page: Page): Promise<Locator> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, await generatedJpegs(page, COUNT));
  await page.getByRole('button', { name: /^All photos/ }).click();
  const grid = page.getByRole('grid', { name: 'Photos' });
  await expect(grid.getByRole('gridcell').first()).toBeVisible();
  return grid;
}

const scrollTop = (grid: Locator) => grid.evaluate((el) => el.scrollTop);

/** Scrolls the grid to `top` and waits for the rows there to be drawn. */
async function scrollTo(grid: Locator, top: number): Promise<number> {
  await grid.evaluate((el, t) => {
    el.scrollTop = t;
  }, top);
  await expect.poll(() => fullyShown(grid).then((names) => names.length)).toBeGreaterThan(0);
  return scrollTop(grid);
}

/** The names of the tiles wholly inside the grid's viewport, in order. */
function fullyShown(grid: Locator): Promise<string[]> {
  return grid.evaluate((el) => {
    const view = el.getBoundingClientRect();
    return [...el.querySelectorAll<HTMLElement>('[role="gridcell"][data-item-id]')]
      .filter((t) => {
        const r = t.getBoundingClientRect();
        return r.top >= view.top && r.bottom <= view.bottom;
      })
      .map((t) => t.title);
  });
}

function tile(page: Page, name: string): Locator {
  return page.locator(`[role="gridcell"][title="${name}"]`);
}

async function openSingle(page: Page, name: string): Promise<Locator> {
  await tile(page, name).dblclick();
  const view = page.getByRole('region', { name });
  await expect(view).toBeVisible();
  return view;
}

/** Back at the grid: scrolled to `top`, with `name`'s tile focused. */
async function expectPlace(page: Page, grid: Locator, top: number, name: string): Promise<void> {
  await expect(grid).toBeVisible();
  await expect(tile(page, name)).toBeFocused();
  expect(await scrollTop(grid)).toBe(top);
}

test('Back from the Single view, by the button, Escape or Space, keeps the grid where it was', async ({ page }) => {
  test.setTimeout(180_000);
  const grid = await openLibrary(page);
  const top = await scrollTo(grid, 2400);
  expect(top).toBe(2400);
  const name = (await fullyShown(grid))[1] ?? '';

  // The Back button.
  const view = await openSingle(page, name);
  await view.getByRole('button', { name: 'Back' }).click();
  await expectPlace(page, grid, top, name);

  // Escape.
  await openSingle(page, name);
  await page.keyboard.press('Escape');
  await expectPlace(page, grid, top, name);

  // Space opens it from the focused tile and closes it again.
  await page.keyboard.press(' ');
  await expect(page.getByRole('region', { name })).toBeVisible();
  await page.keyboard.press(' ');
  await expectPlace(page, grid, top, name);

  // The view bar's One photo button, and Escape.
  await page.getByRole('button', { name: /^One photo/ }).click();
  await expect(page.getByRole('region', { name })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectPlace(page, grid, top, name);
});

test('moved on in the Single view, Back shows that photo, scrolling only as far as it must', async ({ page }) => {
  test.setTimeout(180_000);
  const grid = await openLibrary(page);
  const top = await scrollTo(grid, 2400);
  const shown = await fullyShown(grid);
  const first = shown[0] ?? '';

  // Two on from the first tile on screen: the same row, already in view, so the grid does not move.
  const sameRow = shown[2] ?? '';
  await openSingle(page, first);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('region', { name: sameRow })).toBeVisible();
  await page.getByRole('region', { name: sameRow }).getByRole('button', { name: 'Back' }).click();
  await expectPlace(page, grid, top, sameRow);

  // Two on from the last tile wholly on screen: the next row, below the fold; the grid scrolls just far enough to show it.
  const last = shown[shown.length - 1] ?? '';
  await openSingle(page, last);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('region', { name: last })).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  const heading = page.getByRole('main').getByRole('heading', { level: 1 });
  await expect(heading).not.toHaveText(last);
  const below = (await heading.textContent()) ?? '';
  expect(shown).not.toContain(below);
  await expect(page.getByRole('region', { name: below })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tile(page, below)).toBeFocused();
  const target = await tile(page, below).boundingBox();
  if (!target) throw new Error('not laid out');
  // Where the grid's reveal puts a row below the fold (the arrow keys too): its bottom two paddings above the viewport's.
  const viewportBottom = await grid.evaluate((el) => el.getBoundingClientRect().top + el.clientHeight);
  expect(Math.round(target.y + target.height)).toBe(Math.round(viewportBottom - 2 * PADDING));
  const moved = (await scrollTop(grid)) - top;
  expect(moved).toBeGreaterThan(0);
  expect(moved).toBeLessThan(target.height + 2 * PADDING);
});

test('the place holds with the details panel closed, other tiles, through Compare and the Edit view', async ({ page }) => {
  test.setTimeout(240_000);
  const grid = await openLibrary(page);
  // The details panel is open at first (the other cases): closed here, so the grid is wider.
  await page.keyboard.press('i');
  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0);
  const size = page.getByRole('slider', { name: 'Thumbnail size' });
  await size.fill('240');
  await expect(size).toHaveValue('240');
  const top = await scrollTo(grid, 3000);
  const shown = await fullyShown(grid);
  const name = shown[0] ?? '';

  // Single, with the panel open and the largest tiles.
  const view = await openSingle(page, name);
  await view.getByRole('button', { name: 'Back' }).click();
  await expectPlace(page, grid, top, name);

  // Compare: two photos selected, then back.
  const next = shown[1] ?? '';
  await tile(page, name).click();
  await tile(page, next).click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('c');
  await expect(grid).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(grid).toBeVisible();
  expect(await scrollTop(grid)).toBe(top);
  await expect(tile(page, next)).toBeFocused();

  // Grid to the Edit view (Enter on the focused tile) and Back.
  await page.keyboard.press('Enter');
  const edit = page.getByTestId('edit-view');
  await expect(edit).toBeVisible({ timeout: 30_000 });
  await edit.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expectPlace(page, grid, top, next);

  // Grid to Single to the Edit view, Back to Single, and Back to the grid.
  const single = await openSingle(page, name);
  await single.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(edit).toBeVisible({ timeout: 30_000 });
  await edit.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('region', { name })).toBeVisible();
  await page.getByRole('region', { name }).getByRole('button', { name: 'Back' }).click();
  await expectPlace(page, grid, top, name);
});
