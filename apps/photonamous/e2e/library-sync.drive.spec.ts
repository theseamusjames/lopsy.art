import { expect, test, type Page } from '@playwright/test';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import type { FakeDrive } from '../../../packages/photos-core/src/storage/google-drive/fake-drive';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * Google Drive storage, against photos-core's fake Drive (served through
 * page routing) and a stub of Google's sign-in: the library's layout in
 * Drive, and a second device seeing what the first one did.
 */

const API = 'https://www.googleapis.com/drive/v3/files';

/** Every path under the Drive root, `Photonamous/Originals/2026/…`. */
async function drivePaths(drive: FakeDrive): Promise<string[]> {
  const out: string[] = [];
  const walk = async (id: string, prefix: string): Promise<void> => {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const res = await drive.fetch(`${API}?q=${q}&fields=files(id,name,mimeType)&pageSize=1000`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = (await res.json()) as { files: { id: string; name: string; mimeType: string }[] };
    for (const f of body.files) {
      const path = `${prefix}${f.name}`;
      if (f.mimeType === 'application/vnd.google-apps.folder') await walk(f.id, `${path}/`);
      else out.push(path);
    }
  };
  await walk(drive.rootId, '');
  return out.sort();
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
}

test('Google Drive: the library in Drive, and a second device sees it', async ({ page, browser }) => {
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  await signIn(page);
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
  // The header says where the library is. The app asked Google for Drive files and nothing about the user.
  await expect(page.getByRole('banner')).toContainText('Google Drive');
  expect(await page.evaluate(() => Reflect.get(Reflect.get(window, '__lopsyGisStub') ?? {}, 'scope'))).toBe(
    'https://www.googleapis.com/auth/drive.file',
  );

  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 190) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(1);
  await tiles(page).first().click();
  await page.keyboard.press('3');
  await expect(tiles(page).first()).toHaveAttribute('data-rating', '3');
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });

  const paths = await drivePaths(drive);
  expect(paths).toContainEqual(expect.stringMatching(/^Photonamous\/Originals\/\d{4}\/\d{4}-\d{2}-\d{2}\/harbour\.jpg$/));
  expect(paths).toContainEqual(expect.stringMatching(/^Photonamous\/Library data\/journal\/[^/]+\/.+/));

  // Another device: a fresh browser profile on the same Drive.
  const other = await browser.newContext();
  try {
    await routeFakeDrive(other, drive);
    const second = await other.newPage();
    await second.addInitScript(gisStubInitScript());
    await signIn(second);
    await expect(tiles(second)).toHaveCount(1, { timeout: 30_000 });
    await expect(tiles(second).first()).toHaveAttribute('data-rating', '3');
    await expect(tiles(second).first()).toHaveAttribute('title', 'harbour.jpg');
  } finally {
    await other.close();
  }
});
