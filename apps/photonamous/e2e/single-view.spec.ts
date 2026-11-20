import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/**
 * The Single view's layout, through the UI: the back link at the left edge;
 * the labels, stars and edit buttons (icons) left, centre and right in a bar
 * above the photo, which the back link's row shares the colour of; the
 * details panel without the marks the bars already have; the versions in a
 * bar below it with Set aside at its right end, the selected one in a box
 * of its own and the others as chips that scroll on their own up to four
 * versions, and as a dropdown in the box beyond; and a Lopsy document,
 * which opens in Lopsy as its .lopsy and is edited here on its render.
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
  // It reads "Back"; its name says where to.
  await expect(back).toHaveText('Back');
  // Its row has the marks bar's colour, not the stage's: one header above the photo.
  const rowColour = await back.evaluate((el) => (el.parentElement ? getComputedStyle(el.parentElement).backgroundColor : ''));
  const barColour = await view
    .getByRole('radiogroup', { name: 'Colour label' })
    .evaluate((el) => {
      const bar = el.closest('[class*="actions"]');
      return bar ? getComputedStyle(bar).backgroundColor : '';
    });
  expect(rowColour).toBe(barColour);
  expect(rowColour).not.toBe(await view.evaluate((el) => getComputedStyle(el).backgroundColor));
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

  // Edit in Lopsy and Edit are icons, named for screen readers and in their tooltips.
  await expect(view.getByRole('button', { name: 'Edit in Lopsy' })).toHaveText('');
  await expect(view.getByRole('button', { name: 'Edit', exact: true })).toHaveText('');
  await expect(view.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('title', 'Edit (Enter)');

  // The details panel leaves the marks to the bars around the photo; beside the grid it keeps them, for the selection.
  const details = page.getByRole('complementary', { name: 'Details' });
  await expect(details.getByRole('heading', { name: 'layout.jpg' })).toBeVisible();
  await expect(details.getByRole('radiogroup', { name: 'Rating' })).toHaveCount(0);
  await expect(details.getByRole('radiogroup', { name: 'Colour label' })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Set aside' })).toHaveCount(0);
  await back.click();
  await expect(details.getByRole('radiogroup', { name: 'Rating' })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Set aside' })).toBeVisible();
});

test('the selected version has a box of its own; picking another selects it; past four the box holds a dropdown', async ({ page }) => {
  test.setTimeout(240_000);
  const view = await openPhotoInSingleView(page, 'many.jpg');
  const strip = view.getByRole('group', { name: 'Versions' });
  const chips = strip.locator('button[data-version-id]');
  const dropdown = strip.getByRole('combobox', { name: 'Selected' });

  // One version: the Selected box holds it, with Rename and no Delete (never the last); there are no chips.
  await expect(strip.getByText('Selected', { exact: true })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Rename Original' })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Delete Original' })).toHaveCount(0);
  await expect(chips).toHaveCount(0);

  // A new version becomes the selected one; the other is a chip.
  await addVersion(page, 'Second');
  await expect(strip.getByRole('button', { name: 'Rename Second' })).toBeVisible();
  await expect(chips).toHaveText(['Original']);
  // Picking a chip selects that version: it moves into the box, and the one it replaced becomes a chip.
  await chips.filter({ hasText: 'Original' }).click();
  await expect(strip.getByRole('button', { name: 'Rename Original' })).toBeVisible();
  await expect(chips).toHaveText(['Second']);
  await expect(chips.first()).not.toHaveAttribute('aria-current', 'true');

  // Up to four versions, the ones not selected are chips.
  for (const name of ['Third', 'Fourth']) await addVersion(page, name);
  await expect(chips).toHaveText(['Original', 'Second', 'Third']);
  await expect(dropdown).toHaveCount(0);

  // The fifth turns the box into a dropdown of them all, on the new version; New version stays.
  await addVersion(page, 'Fifth');
  await expect(dropdown).toBeVisible();
  await expect(chips).toHaveCount(0);
  await expect(dropdown.locator('option')).toHaveText(['Original', 'Second', 'Third', 'Fourth', 'Fifth']);
  await expect(dropdown.locator('option:checked')).toHaveText('Fifth');
  await expect(strip.getByRole('button', { name: 'New version' })).toBeVisible();
  await page.screenshot({ path: 'test-results/single-view-versions-dropdown.png' });

  // Choosing one selects it, with its own Rename and Delete in the box.
  await dropdown.selectOption({ label: 'Second' });
  await expect(dropdown.locator('option:checked')).toHaveText('Second');
  await expect(strip.getByRole('button', { name: 'Rename Second' })).toBeVisible();
  await expect(strip.getByRole('button', { name: 'Delete Second' })).toBeVisible();
  await expect(strip.getByRole('button', { name: /Fifth/ })).toHaveCount(0);

  // Rename: Escape keeps the name (and the view), Enter saves it and gives focus back to the dropdown.
  await strip.getByRole('button', { name: 'Rename Second' }).click();
  const nameBox = strip.getByRole('textbox', { name: 'Version name' });
  await expect(nameBox).toBeFocused();
  await nameBox.fill('Not this');
  await nameBox.press('Escape');
  await expect(view).toBeVisible();
  await expect(dropdown.locator('option:checked')).toHaveText('Second');
  await strip.getByRole('button', { name: 'Rename Second' }).click();
  await nameBox.fill('Second, warmer');
  await nameBox.press('Enter');
  await expect(dropdown.locator('option:checked')).toHaveText('Second, warmer');
  await expect(dropdown).toBeFocused();

  // Delete takes only the selected version, and the next one is selected; at four, the chips come back.
  await dropdown.selectOption({ label: 'Third' });
  await strip.getByRole('button', { name: 'Delete Third' }).click();
  await expect(strip.getByRole('button', { name: 'Rename Fourth' })).toBeVisible();
  await expect(chips).toHaveText(['Original', 'Second, warmer', 'Fifth']);
  await expect(dropdown).toHaveCount(0);

  // The grid's tile for the photo is its selected version; the others are the stack's other tiles.
  await view.getByRole('button', { name: 'Back to the grid' }).click();
  await expect(page.locator('[role="gridcell"][title="many.jpg"]')).toBeVisible();
  await expect(page.locator('[role="gridcell"][title="many.jpg (Fourth)"]')).toHaveCount(0);
  await expect(page.locator('[role="gridcell"][title="many.jpg (Third)"]')).toHaveCount(0);

  // Opened from the stack, a version that is not the selected one is on screen: its chip has a dot, and picking it selects it.
  await page.locator('[role="gridcell"][title="many.jpg (Original)"]').dblclick();
  const onScreen = strip.locator('button[aria-current="true"]');
  await expect(onScreen).toHaveText('Original');
  await expect(strip.getByRole('button', { name: 'Rename Fourth' })).toBeVisible();
  await onScreen.click();
  await expect(strip.getByRole('button', { name: 'Rename Original' })).toBeVisible();
  await expect(strip.locator('button[aria-current="true"]')).toHaveCount(0);
});

test('at a narrow width the version chips scroll on their own and never cover Set aside', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 480, height: 900 });
  const view = await openPhotoInSingleView(page, 'narrow.jpg');
  for (const name of ['Warm evening light', 'Cool morning light', 'Black and white']) await addVersion(page, name);
  const strip = view.getByRole('group', { name: 'Versions' });
  // The newest is the selected one, in the box; the other three are chips.
  await expect(strip.getByRole('button', { name: 'Rename Black and white' })).toBeVisible();
  await expect(strip.locator('button[data-version-id]')).toHaveCount(3);
  const scroller = strip.locator('[class*="chips"]');
  const setAside = view.getByRole('button', { name: 'Set aside' });
  await setAside.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/single-view-narrow-versions.png' });

  // The chips do not fit: they scroll inside their own area, which shares the row with Set aside and stops short of it.
  const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth + 50);
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

  // Scrolled to the end, nothing moved over Set aside either.
  await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  expect(await hitsSetAside()).toBe('Set aside');
  expect((await box(scroller)).right).toBeLessThanOrEqual((await box(setAside)).left);
});

/**
 * Stands in for Lopsy at its URL: says ready to the Photonamous tab that
 * opened it, takes the document it sends (its kind becomes the page title),
 * and `saveToPhotonamous(name)` sends a save back as Lopsy's Save to
 * Photonamous does: a `.lopsy` (its magic, then a few bytes) and a PNG.
 */
async function standInForLopsy(context: BrowserContext, photosOrigin: string): Promise<void> {
  const script = `
    const photos = ${JSON.stringify(photosOrigin)};
    const id = new URLSearchParams(location.search).get('photos-handoff');
    let source;
    const ready = setInterval(() => opener.postMessage({ protocol: 1, type: 'lopsy:ready', id }, photos), 200);
    addEventListener('message', (e) => {
      if (e.origin !== photos || e.data?.id !== id) return;
      if (e.data.type === 'photos:document') {
        clearInterval(ready);
        source = e.data.document.source;
        opener.postMessage({ protocol: 1, type: 'lopsy:received', id }, photos);
        document.title = 'Received ' + e.data.document.kind;
      }
      if (e.data.type === 'photos:saved') document.title = e.data.ok ? 'Saved' : 'Not saved: ' + e.data.error;
    });
    window.saveToPhotonamous = async (name) => {
      const canvas = new OffscreenCanvas(96, 64);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#c04040';
      ctx.fillRect(0, 0, 96, 64);
      const render = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
      const lopsy = new Uint8Array([0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00, 1, 2, 3]).buffer;
      opener.postMessage({ protocol: 1, type: 'lopsy:save', id, saveId: 'save1', name, lopsy, render, source }, photos, [lopsy, render]);
    };`;
  await context.route(
    (url) => url.searchParams.has('photos-handoff'),
    (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>Lopsy</title><script>${script}</script>` }),
  );
}

test('a Lopsy document has Open in Lopsy, which sends its .lopsy, and Edit, for its flattened render', async ({ page, context }) => {
  test.setTimeout(240_000);
  const view = await openPhotoInSingleView(page, 'source.jpg');
  await standInForLopsy(context, new URL(page.url()).origin);

  // Edit in Lopsy from the bar above the photo, and the stand-in saves a document back.
  const [lopsy] = await Promise.all([context.waitForEvent('page'), view.getByRole('button', { name: 'Edit in Lopsy' }).click()]);
  await expect(lopsy).toHaveTitle('Received png16', { timeout: 120_000 });
  await lopsy.evaluate(() => (window as unknown as { saveToPhotonamous: (name: string) => Promise<void> }).saveToPhotonamous('Poster'));
  await expect(lopsy).toHaveTitle('Saved', { timeout: 60_000 });

  // The document joins the photo's stack; opened in Single view, it has Open in Lopsy in place of Edit in Lopsy, and Edit.
  await view.getByRole('button', { name: 'Back to the grid' }).click();
  const photo = page.locator('[role="gridcell"][title="source.jpg"]');
  await photo.getByRole('button', { name: '1 Lopsy document', exact: true }).click();
  const documentTile = page.locator('[role="gridcell"][title="Poster.lopsy"]');
  await documentTile.dblclick();
  const documentView = page.getByRole('region', { name: 'Poster.lopsy' });
  await expect(documentView.getByRole('button', { name: 'Open in Lopsy' })).toBeVisible();
  await expect(documentView.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(documentView.getByRole('button', { name: 'Edit in Lopsy' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/single-view-document.png' });

  // Open in Lopsy sends the document itself, to the same Lopsy tab.
  await documentView.getByRole('button', { name: 'Open in Lopsy' }).click();
  await expect(lopsy).toHaveTitle('Received lopsy', { timeout: 60_000 });
});
