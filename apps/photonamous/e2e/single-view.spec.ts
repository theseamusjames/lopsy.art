import { expect, test, type Locator, type Page } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/**
 * The Single view's layout, through the UI: the back link at the left edge;
 * the labels, stars and edit buttons left, centre and right in a bar above
 * the photo; the versions in a bar below it with Set aside at its right end,
 * as chips that scroll on their own when there is no room.
 */

test.use({ actionTimeout: 15_000 });

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not laid out');
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, centerX: b.x + b.width / 2, centerY: b.y + b.height / 2 };
}

/** The bars' padding at the view's sides (--space-4). */
const EDGE = 16;

async function openPhotoInSingleView(page: Page, name: string): Promise<Locator> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name, buffer: await generatedJpeg(page, 200, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.locator(`[role="gridcell"][title="${name}"]`).dblclick();
  const view = page.getByRole('region', { name });
  await expect(view.getByRole('button', { name: `Look closer at ${name}` })).toBeVisible({ timeout: 30_000 });
  return view;
}

/** New version, from the button in the Single view's versions bar. */
async function addVersion(page: Page, name: string): Promise<void> {
  await page.getByRole('group', { name: 'Versions' }).getByRole('button', { name: 'New version' }).click();
  const dialog = page.getByRole('dialog', { name: 'New version' });
  await dialog.getByRole('textbox', { name: 'Version name' }).fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
}

test('the back link is at the left edge, and labels, stars and edit buttons sit left, centre and right above the photo', async ({ page }) => {
  test.setTimeout(120_000);
  const view = await openPhotoInSingleView(page, 'layout.jpg');
  await page.screenshot({ path: 'test-results/single-view-layout.png' });
  const frame = await box(view);
  const photo = await box(view.getByRole('button', { name: 'Look closer at layout.jpg' }));

  // The back link starts where the bars' content does (its arrow, not a stretched box), and reads as a link: no fill, underlined on hover.
  const back = view.getByRole('button', { name: 'Back to the grid' });
  const backBox = await box(back);
  const arrow = await box(back.locator('svg'));
  expect(Math.abs(arrow.left - (frame.left + EDGE))).toBeLessThanOrEqual(1);
  expect(backBox.right - backBox.left).toBeLessThan(160);
  expect(await back.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await back.hover();
  expect(await back.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline');
  // The name is centred on the view.
  const heading = await box(view.getByRole('heading', { level: 1, name: 'layout.jpg' }));
  expect(Math.abs(heading.centerX - (frame.left + frame.right) / 2)).toBeLessThanOrEqual(1);

  // One row above the photo: labels at the left, stars at the view's centre, the edit buttons at the right.
  const labels = await box(view.getByRole('radiogroup', { name: 'Colour label' }));
  const stars = await box(view.getByRole('radiogroup', { name: 'Rating' }));
  const editInLopsy = await box(view.getByRole('button', { name: 'Edit in Lopsy' }));
  const edit = await box(view.getByRole('button', { name: 'Edit', exact: true }));
  expect(Math.abs(labels.left - backBox.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(stars.centerX - (frame.left + frame.right) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(edit.right - (frame.right - EDGE))).toBeLessThanOrEqual(1);
  expect(editInLopsy.right).toBeLessThanOrEqual(edit.left);
  for (const part of [stars, editInLopsy, edit]) expect(Math.abs(part.centerY - labels.centerY)).toBeLessThanOrEqual(2);
  for (const part of [labels, stars, editInLopsy, edit]) expect(part.bottom).toBeLessThanOrEqual(photo.top);
  expect(labels.top).toBeGreaterThanOrEqual(backBox.bottom);

  // Below the photo: the versions at the left, Set aside at the right end.
  const versions = await box(view.getByRole('group', { name: 'Versions' }));
  const setAside = await box(view.getByRole('button', { name: 'Set aside' }));
  expect(versions.top).toBeGreaterThanOrEqual(photo.bottom);
  expect(Math.abs(versions.left - (frame.left + EDGE))).toBeLessThanOrEqual(1);
  expect(Math.abs(setAside.right - (frame.right - EDGE))).toBeLessThanOrEqual(1);
  expect(Math.abs(setAside.centerY - versions.centerY)).toBeLessThanOrEqual(2);
});

test('at a narrow width the version chips scroll on their own and never cover Set aside', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 480, height: 900 });
  const view = await openPhotoInSingleView(page, 'narrow.jpg');
  for (const name of ['Warm evening light', 'Cool morning light', 'Black and white']) await addVersion(page, name);
  const strip = view.getByRole('group', { name: 'Versions' });
  await expect(strip.locator('button[aria-pressed]')).toHaveCount(4);
  const scroller = strip.locator('[class*="chips"]');
  const setAside = view.getByRole('button', { name: 'Set aside' });
  await setAside.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/single-view-narrow-versions.png' });

  // Four chips do not fit: they scroll inside their own area, which shares the row with Set aside and stops short of it.
  const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }));
  expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth + 100);
  const frame = await box(view);
  const area = await box(scroller);
  const button = await box(setAside);
  const add = await box(strip.getByRole('button', { name: 'New version' }));
  expect(Math.abs(button.right - (frame.right - EDGE))).toBeLessThanOrEqual(1);
  expect(area.bottom).toBeGreaterThan(button.top);
  expect(area.top).toBeLessThan(button.bottom);
  expect(area.right).toBeLessThanOrEqual(button.left);
  expect(add.right).toBeLessThanOrEqual(button.left);

  /** What a pointer at Set aside's centre would press. */
  const hitsSetAside = () =>
    page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim() ?? '',
      { x: button.centerX, y: button.centerY },
    );
  expect(await hitsSetAside()).toBe('Set aside');

  // The version just made is the last chip: the chips scrolled to show it whole.
  expect(sizes.scrollLeft).toBeGreaterThan(0);
  const chosen = await box(strip.locator('button[aria-pressed="true"]'));
  expect(chosen.right).toBeLessThanOrEqual(area.right);
  await expect(strip.locator('button[aria-pressed="true"]')).toHaveText('Black and white');

  // Scrolled back to the start, nothing moved over Set aside either.
  await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
  expect(await hitsSetAside()).toBe('Set aside');
  expect((await box(scroller)).right).toBeLessThanOrEqual((await box(setAside)).left);
});
