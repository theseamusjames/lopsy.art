import { expect, test, type BrowserContext, type Locator, type Page } from './test';
import { generatedJpeg, importFiles } from './library';

/**
 * Edit in Lopsy for a photo larger than Lopsy can open on this device
 * (plan decision 106). Lopsy keeps each layer as one texture on the same
 * GPU, so a photo whose long edge is over `editableLimit` is not handed
 * over: every surface shows Edit in Lopsy as unavailable, with the sentence
 * why as its tooltip and its accessible description (focusable, so the
 * keyboard reaches the reason), and pressing it opens nothing. A photo that
 * fits is offered and handed over as before.
 *
 * A development build's `?texture-limit=512` takes the GPU to be that
 * small (editableLimit 510), so an 800 × 600 photo is too large and a
 * 480 × 320 one fits, on any machine.
 */

test.use({ actionTimeout: 15_000 });

const TOO_LARGE = 'This photo is 800 × 600 pixels, larger than Lopsy can open on this device (510 on a side).';

const tile = (page: Page, name: string) => page.locator(`[role="gridcell"][title="${name}"]`);

/**
 * Stands in for Lopsy at its URL: says ready to the tab that opened it and
 * takes the photo, titling itself with what came and the PNG's size.
 */
async function standInForLopsy(context: BrowserContext, photosOrigin: string): Promise<void> {
  const script = `
    const photos = ${JSON.stringify(photosOrigin)};
    const id = new URLSearchParams(location.search).get('photos-handoff');
    const ready = setInterval(() => opener.postMessage({ protocol: 1, type: 'lopsy:ready', id }, photos), 200);
    addEventListener('message', (e) => {
      if (e.origin !== photos || e.data?.id !== id || e.data.type !== 'photos:document') return;
      clearInterval(ready);
      opener.postMessage({ protocol: 1, type: 'lopsy:received', id }, photos);
      const png = new DataView(e.data.document.bytes);
      document.title = 'Received ' + e.data.document.kind + ' ' + png.getUint32(16) + 'x' + png.getUint32(20);
    });`;
  await context.route(
    (url) => url.searchParams.has('photos-handoff'),
    (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>Lopsy</title><script>${script}</script>` }),
  );
}

/** Counts the tabs the page opens from now on. */
function countOpenedTabs(context: BrowserContext): () => number {
  let opened = 0;
  context.on('page', () => {
    opened += 1;
  });
  return () => opened;
}

/** Presses `control` and checks that nothing was handed over: no tab, no "Opening Lopsy…". */
async function pressAndExpectNothing(page: Page, control: Locator, opened: () => number): Promise<void> {
  const before = opened();
  // Playwright waits for an aria-disabled control to be enabled; a person can press it all the same.
  await control.click({ force: true });
  await page.waitForTimeout(1_000);
  expect(opened()).toBe(before);
  await expect(page.getByText('Opening Lopsy…')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?texture-limit=512');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15_000 });
  await importFiles(page, [
    { name: 'large.jpg', buffer: await generatedJpeg(page, 30, 800, 600) },
    { name: 'small.jpg', buffer: await generatedJpeg(page, 200, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
});

test('Edit in Lopsy is unavailable for a photo larger than Lopsy can open here, on every surface, and says why', async ({ page, context }) => {
  test.setTimeout(240_000);
  const opened = countOpenedTabs(context);
  await standInForLopsy(context, new URL(page.url()).origin);
  await tile(page, 'large.jpg').click();

  // The grid toolbar's More menu: off, with the reason as its hint.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const more = page.getByRole('menu', { name: 'More' });
  const moreItem = more.getByRole('menuitem', { name: /^Edit in Lopsy/ });
  await expect(moreItem).toHaveAttribute('aria-disabled', 'true');
  await expect(moreItem).toContainText(TOO_LARGE);
  await page.screenshot({ path: 'test-results/lopsy-oversize-more-menu.png' });
  await pressAndExpectNothing(page, moreItem, opened);
  await page.keyboard.press('Escape');

  // The tile's menu: the same.
  await tile(page, 'large.jpg').click({ button: 'right' });
  const actions = page.getByRole('menu', { name: 'Photo actions' });
  const actionsItem = actions.getByRole('menuitem', { name: /^Edit in Lopsy/ });
  await expect(actionsItem).toHaveAttribute('aria-disabled', 'true');
  await expect(actionsItem).toContainText(TOO_LARGE);
  await page.screenshot({ path: 'test-results/lopsy-oversize-tile-menu.png' });
  await pressAndExpectNothing(page, actionsItem, opened);
  await page.keyboard.press('Escape');

  // The Single view's button: off but focusable, the reason its tooltip and description.
  await tile(page, 'large.jpg').dblclick();
  const view = page.getByRole('region', { name: 'large.jpg' });
  const single = view.getByRole('button', { name: 'Edit in Lopsy' });
  await expect(single).toHaveAttribute('aria-disabled', 'true');
  await expect(single).toHaveAttribute('title', TOO_LARGE);
  await expect(single).toHaveAccessibleDescription(TOO_LARGE);
  await single.focus();
  await expect(single).toBeFocused();
  await page.keyboard.press('Enter');
  await pressAndExpectNothing(page, single, opened);

  // The Edit view's toolbar: the same.
  await view.getByRole('button', { name: 'Edit', exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Tools' });
  const editView = toolbar.getByRole('button', { name: 'Edit in Lopsy' });
  await expect(editView).toHaveAttribute('aria-disabled', 'true');
  await expect(editView).toHaveAttribute('title', TOO_LARGE);
  await expect(editView).toHaveAccessibleDescription(TOO_LARGE);
  await editView.focus();
  await expect(editView).toBeFocused();
  await page.keyboard.press('Enter');
  await pressAndExpectNothing(page, editView, opened);
  expect(opened()).toBe(0);
});

test('a photo that fits is offered and handed over as before', async ({ page, context }) => {
  test.setTimeout(240_000);
  await standInForLopsy(context, new URL(page.url()).origin);
  await tile(page, 'small.jpg').click();

  await page.getByRole('button', { name: 'More', exact: true }).click();
  const moreItem = page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Edit in Lopsy/ });
  await expect(moreItem).not.toHaveAttribute('aria-disabled', /.*/);
  await expect(moreItem).toContainText('With layers, painting and text');
  await page.keyboard.press('Escape');

  await tile(page, 'small.jpg').click({ button: 'right' });
  const actionsItem = page.getByRole('menu', { name: 'Photo actions' }).getByRole('menuitem', { name: 'Edit in Lopsy', exact: true });
  await expect(actionsItem).not.toHaveAttribute('aria-disabled', /.*/);
  await page.keyboard.press('Escape');

  await tile(page, 'small.jpg').dblclick();
  const view = page.getByRole('region', { name: 'small.jpg' });
  const single = view.getByRole('button', { name: 'Edit in Lopsy' });
  await expect(single).not.toHaveAttribute('aria-disabled', /.*/);
  await expect(single).toHaveAttribute('title', 'Edit in Lopsy');
  await expect(single).not.toHaveAttribute('aria-describedby', /.*/);
  const [lopsy] = await Promise.all([context.waitForEvent('page'), single.click()]);
  // The photo at its own size.
  await expect(lopsy).toHaveTitle('Received png16 480x320', { timeout: 120_000 });
});
