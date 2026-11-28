import type { Route } from '@playwright/test';
import { BLOB_BODY_SKIP, expect, test, type Page } from './test';
import {
  gisStubInitScript,
  pickerStubInitScript,
  routeFakeDrive,
} from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import type { FakeDrive } from '../../../packages/photos-core/src/storage/google-drive/fake-drive';
import { generatedJpeg, importFiles, importStrip, tiles } from './library';

/**
 * Coming back after Google's token has run out (an hour, renewed only from
 * a click): the owner's sequence. Every read from Drive waits for sign-in,
 * says so where the person is looking, offers Reconnect there, and carries
 * on by itself once it is done: no reload, nothing to click again. Against
 * the fake Drive and the sign-in stub, with the page's clock moved.
 */

const MINUTE = 60_000;
const SCREENSHOTS = process.env.PHOTONAMOUS_IMPORT_FIX_SHOTS;
const NAME = 'harbour.jpg';

test.skip(BLOB_BODY_SKIP.skip, BLOB_BODY_SKIP.reason);

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
}

/** The hour is up: Drive refuses the token in use, and Google's next grant is `next`. */
async function tokenRunsOut(page: Page, drive: FakeDrive, used: string, next: string): Promise<void> {
  drive.revokeToken(used);
  drive.addToken(next);
  await page.evaluate((value) => Reflect.set(Reflect.get(window, '__lopsyGisStub') as object, 'token', value), next);
  await page.clock.setSystemTime(new Date(Date.now() + 61 * MINUTE));
}

test('back after the hour: the single view and the Edit view wait for one Reconnect, then load by themselves', async ({ page }) => {
  await page.clock.install();
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  await signIn(page);
  await importFiles(page, [{ name: NAME, buffer: await generatedJpeg(page, 200, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);

  // Away past the hour. A click on the photo opens no window (the token is past renewing from a click)…
  await tokenRunsOut(page, drive, 'test-token', 'token-2');
  await page.locator(`[role="gridcell"][title="${NAME}"]`).click();
  // …and the single view, opened, says what its full-size picture waits for, with Reconnect there and in the header.
  await page.locator(`[role="gridcell"][title="${NAME}"]`).dblclick();
  const view = page.getByRole('region', { name: NAME });
  await expect(view.getByText('Reconnect Google Drive to load this photo at full size.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('banner').getByRole('button', { name: 'Reconnect Google Drive' })).toBeVisible();
  await expect(page.getByText(/needs reconnecting|could not/i)).toHaveCount(0);
  if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/single-view-waiting-for-sign-in.png` });
  const prompts = async () => page.evaluate(() => (Reflect.get(Reflect.get(window, '__lopsyGisStub') as object, 'requests') as unknown[]).length);
  expect(await prompts()).toBe(1);

  // One Reconnect: the picture arrives by itself, and the header's button goes.
  await view.getByRole('button', { name: 'Reconnect Google Drive' }).click();
  await expect(view.locator('img[data-loading="false"]')).toBeVisible({ timeout: 30_000 });
  await expect(view.getByText('Reconnect Google Drive to load this photo at full size.')).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Reconnect Google Drive' })).toHaveCount(0);

  // Away past the hour again, then into Edit: "Getting the original" says what it waits for instead of sitting at zero.
  await tokenRunsOut(page, drive, 'token-2', 'token-3');
  await view.getByRole('button', { name: 'Edit', exact: true }).click();
  const waiting = page.getByText('Reconnect Google Drive to get the original and edit this photo.');
  await expect(waiting).toBeVisible({ timeout: 30_000 });
  if (SCREENSHOTS) await page.screenshot({ path: `${SCREENSHOTS}/edit-view-waiting-for-sign-in.png` });
  // The header's Reconnect serves it as well as its own.
  await page.getByRole('banner').getByRole('button', { name: 'Reconnect Google Drive' }).click();
  await expect(page.getByTestId('edit-view')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  await expect(waiting).toHaveCount(0);
});

test('Add from Google Drive across an expired token waits for Reconnect, then adds the photo', async ({ page, context }) => {
  await page.clock.install();
  const drive = await routeFakeDrive(context);
  await page.addInitScript(gisStubInitScript());
  await page.addInitScript(pickerStubInitScript());
  await signIn(page);
  const id = drive.seedFile({ name: 'from-my-drive.jpg', mimeType: 'image/jpeg', content: new Uint8Array(await generatedJpeg(page, 40)) });
  // Hold the download until the token has run out.
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  await context.route(/alt=media/, async (route: Route) => {
    await gate;
    await route.fallback().catch(() => undefined);
  });

  await page.getByRole('button', { name: /Import photos/ }).first().click();
  await page.getByRole('menuitem', { name: /Add from Google Drive/ }).click();
  await expect(page.locator('#fake-google-picker')).toBeVisible();
  await page.evaluate((picked) => Reflect.get(window, '__lopsyPickerStub').pick([picked]), id);
  await expect(importStrip(page)).toBeVisible();

  await tokenRunsOut(page, drive, 'test-token', 'token-2');
  open();
  const strip = importStrip(page);
  await expect(strip).toContainText('Reconnect to Google Drive to continue · 1 of 1 photo left', { timeout: 30_000 });
  await expect(strip).not.toContainText('could not be imported');
  await strip.getByRole('button', { name: 'Reconnect Google Drive' }).click();
  await expect(importStrip(page)).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
});
