import { BLOB_BODY_SKIP, expect, test, type Page } from './test';
import {
  gisStubInitScript,
  pickerStubInitScript,
  routeDrivePicker,
  routeFakeDrive,
} from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import type { FakeDrive } from '../../../packages/photos-core/src/storage/google-drive/fake-drive';
import { axeViolations } from './axe';
import { generatedJpeg, importStrip, tiles, toast } from './library';

/**
 * Add from Google Drive. Google's Picker opens in the page where that can
 * work, and as a window of its own where it cannot (a browser that blocks
 * cross-site cookies shows only Google's sign-in page in the frame). The
 * fakes stand in for Google's two Pickers; everything from the menu item
 * to the photo in the grid is the app's.
 */

const PROMPT = 'If Google asks you to sign in';

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(gisStubInitScript());
  await page.addInitScript(pickerStubInitScript());
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
}

/** A photo the user put in their Drive themselves: not the app's, so the app cannot see it until it is picked. */
async function photoInDrive(page: Page, drive: FakeDrive, hue: number): Promise<string> {
  return drive.seedFile({ name: `from-my-drive-${hue}.jpg`, mimeType: 'image/jpeg', content: new Uint8Array(await generatedJpeg(page, hue)) });
}

async function chooseAddFromDrive(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  await page.getByRole('menuitem', { name: /Add from Google Drive/ }).click();
}

function stub<T>(page: Page, read: string): Promise<T> {
  return page.evaluate((expression) => new Function('stub', `return ${expression}`)(Reflect.get(window, '__lopsyPickerStub')) as T, read);
}

async function expectPhotos(page: Page, count: number): Promise<void> {
  await expect(importStrip(page)).toHaveCount(0, { timeout: 60_000 });
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(count);
}

test.skip(BLOB_BODY_SKIP.skip, BLOB_BODY_SKIP.reason);

test("Google Drive: a photo picked in Google's Picker, in the page, is added", async ({ page, context }) => {
  const drive = await routeFakeDrive(context);
  await signIn(page);
  const id = await photoInDrive(page, drive, 40);

  await chooseAddFromDrive(page);
  await expect(page.locator('#fake-google-picker')).toBeVisible();
  // The way out is offered while the Picker is open, and the page with it on is accessible.
  await expect(page.getByRole('complementary', { name: PROMPT })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  // The Picker is asked for every kind of photo the app reads, Fujifilm and Sony RAW by the names Drive knows them by.
  const offered = (await stub<string>(page, 'stub.mimeTypes')).split(',');
  for (const type of ['image/x-fuji-raf', 'image/x-adobe-dng', 'image/x-sony-arw', 'image/jpeg', 'image/png', 'image/webp']) {
    expect(offered, type).toContain(type);
  }

  await page.evaluate((picked) => Reflect.get(window, '__lopsyPickerStub').pick([picked]), id);
  await expect(page.getByRole('complementary', { name: PROMPT })).toHaveCount(0);
  await expectPhotos(page, 1);
});

test("Google Drive: when the Picker in the page is stuck, Google's own window takes over, then and after", async ({ page, context }) => {
  const drive = await routeFakeDrive(context);
  let answer: { fileIds?: string[]; error?: string } = {};
  const opened = await routeDrivePicker(context, () => answer);
  await signIn(page);
  answer = { fileIds: [await photoInDrive(page, drive, 200)] };

  await chooseAddFromDrive(page);
  await expect(page.locator('#fake-google-picker')).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open in a Google window' }).click();
  const window1 = await popup;
  // The pop-up reports back and closes itself; the Picker in the page went when it opened.
  if (!window1.isClosed()) await window1.waitForEvent('close');
  await expect(page.locator('#fake-google-picker')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: PROMPT })).toHaveCount(0);

  // What the app asked Google for: its Picker, for Drive files only, coming back to the app's own page.
  const asked = new URL(opened[0] ?? '');
  expect(asked.searchParams.get('trigger_onepick')).toBe('true');
  expect(asked.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
  expect(new URL(asked.searchParams.get('redirect_uri') ?? '').pathname).toBe('/drive-picked');
  expect((asked.searchParams.get('mimetypes') ?? '').split(',')).toContain('image/x-fuji-raf');
  await expectPhotos(page, 1);

  // The choice is remembered: the next time, the window opens straight away. Closing it adds nothing and says nothing.
  answer = { error: 'access_denied' };
  const again = page.waitForEvent('popup');
  await chooseAddFromDrive(page);
  const window2 = await again;
  if (!window2.isClosed()) await window2.waitForEvent('close');
  expect(await stub<number>(page, 'stub.shown')).toBe(1);
  await expect(tiles(page)).toHaveCount(1);
  await expect(toast(page, /Adding from Google Drive failed/)).toHaveCount(0);

  // Settings shows the choice, and gives the way back.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'In a Google window' })).toBeChecked();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole('radio', { name: 'Here, in the page' }).check();
  await page.keyboard.press('Escape');
  await chooseAddFromDrive(page);
  await expect(page.locator('#fake-google-picker')).toBeVisible();
});
