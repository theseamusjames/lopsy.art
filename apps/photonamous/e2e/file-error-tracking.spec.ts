import { expect, test, type Page } from './test';
import { generatedJpeg, importFiles, importStrip } from './library';

/**
 * A file Photonamous refuses or cannot open sends `file_error` events to
 * the page's analytics (src/app/file-error-events.ts): the kind of failure,
 * a general reason, the format from a fixed list, the count and, for a
 * size, the limit. Never a file's name, the library's or anything in the
 * file (privacy.html, "Usage statistics"). In production the analytics is
 * Cloudflare Zaraz, added at the edge; here a stand-in installed before the
 * page loads records the calls. The files are named like a person, so a
 * name that leaked would show.
 */

interface Tracked {
  name: string;
  properties: unknown;
}

type AnalyticsWindow = Window & {
  __tracked?: Tracked[];
  zaraz?: { track(name: string, properties?: Record<string, unknown>): unknown };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const tracked: Tracked[] = [];
    const w = window as AnalyticsWindow;
    w.__tracked = tracked;
    w.zaraz = {
      track: (name: string, properties?: Record<string, unknown>) => {
        tracked.push({ name, properties });
        return Promise.resolve();
      },
    };
  });
});

async function fileErrors(page: Page): Promise<Tracked[]> {
  const all = await page.evaluate(() => (window as AnalyticsWindow).__tracked ?? []);
  return all.filter((t) => t.name === 'file_error');
}

/** The events once they have stopped arriving: one more would arrive within the wait. */
async function settledFileErrors(page: Page, expected: number): Promise<Tracked[]> {
  await expect.poll(async () => (await fileErrors(page)).length, { timeout: 60_000 }).toBe(expected);
  await page.waitForTimeout(1_000);
  return fileErrors(page);
}

const NAME_PARTS = /Ada|Lovelace|notes|portrait|recipe/i;

test('an import reports the files it leaves out and the files it refuses, by format and count, and nothing of their names', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles([
    { name: 'harbour.jpg', mimeType: 'image/jpeg', buffer: await generatedJpeg(page, 30, 480, 320) },
    { name: 'Ada Lovelace notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('These are notes, not a photo.') },
    { name: 'Ada portrait.heic', mimeType: 'image/heic', buffer: Buffer.from('not read here') },
    { name: 'Ada recipe.txt', mimeType: 'text/plain', buffer: Buffer.from('flour, eggs') },
  ]);
  // The sheet says the two that are not photos are left out: that is when they are reported.
  await expect(page.getByText('2 files are not photos and will be left out')).toBeVisible();
  const left = [
    { name: 'file_error', properties: { app: 'photonamous', kind: 'unsupported-type', reason: 'File type not supported', format: 'heic', count: 1 } },
    { name: 'file_error', properties: { app: 'photonamous', kind: 'unsupported-type', reason: 'File type not supported', format: 'other', count: 1 } },
  ];
  expect(await settledFileErrors(page, 2)).toEqual(left);

  await page.getByRole('button', { name: 'Import 2 photos' }).click();
  const strip = importStrip(page);
  await expect(strip.getByRole('button', { name: '1 photo could not be imported' })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/file-error-import.png' });
  const events = await settledFileErrors(page, 3);
  expect(events).toEqual([
    ...left,
    { name: 'file_error', properties: { app: 'photonamous', kind: 'decode-failed', reason: 'Not a supported photo format', format: 'jpeg', count: 1 } },
  ]);
  expect(JSON.stringify(events)).not.toMatch(NAME_PARTS);
});

test('a photo larger than the GPU reports Edit in Lopsy refused and the Edit view’s smaller size, once each, with the limit', async ({ page }) => {
  test.setTimeout(240_000);
  // A development build's ?texture-limit=512 takes the GPU to be that small: 510 on a side can be edited.
  await page.goto('/?texture-limit=512');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 15_000 });
  await importFiles(page, [{ name: 'Ada Lovelace.jpg', buffer: await generatedJpeg(page, 30, 800, 600) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.locator('[role="gridcell"][title="Ada Lovelace.jpg"]').dblclick();

  // The Single view's Edit in Lopsy is unavailable; a press of it is the refusal, and a second press is the same one.
  const view = page.getByRole('region', { name: 'Ada Lovelace.jpg' });
  const single = view.getByRole('button', { name: 'Edit in Lopsy' });
  await expect(single).toHaveAttribute('aria-disabled', 'true');
  // Playwright waits for an aria-disabled control to be enabled; a person can press it all the same.
  await single.click({ force: true });
  await single.click({ force: true });
  const refused = {
    name: 'file_error',
    properties: { app: 'photonamous', kind: 'too-large', reason: 'Edit in Lopsy: photo long edge exceeded 510', format: 'jpeg', count: 1, limit: 510 },
  };
  expect(await settledFileErrors(page, 1)).toEqual([refused]);

  // Zoomed to full size, the Edit view loads it at the largest size the GPU can edit, and says so: reported once.
  await view.getByRole('button', { name: 'Edit', exact: true }).click();
  const full = page.getByRole('button', { name: 'Full', exact: true });
  await expect(full).toBeEnabled({ timeout: 60_000 });
  await full.click();
  await expect(page.getByText(/larger than this device’s graphics can edit \(510 on a side\)/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/file-error-edit-oversize.png' });
  const shownSmaller = {
    name: 'file_error',
    properties: { app: 'photonamous', kind: 'too-large', reason: 'Photo long edge exceeded 510', format: 'jpeg', count: 1, limit: 510 },
  };
  expect(await settledFileErrors(page, 2)).toEqual([refused, shownSmaller]);

  // The Edit view's own Edit in Lopsy, pressed, is the same photo's refusal: nothing more.
  const toolbarButton = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Edit in Lopsy' });
  await toolbarButton.click({ force: true });
  await page.waitForTimeout(1_000);
  const events = await fileErrors(page);
  expect(events).toEqual([refused, shownSmaller]);
  expect(JSON.stringify(events)).not.toMatch(NAME_PARTS);
  expect(JSON.stringify(events)).not.toMatch(/800|600/);
});
