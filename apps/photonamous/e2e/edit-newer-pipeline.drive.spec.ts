import { BLOB_BODY_SKIP, expect, test, type Page } from './test';
import { gisStubInitScript, routeFakeDrive } from '../../../packages/photos-core/src/storage/google-drive/playwright-fake-drive';
import { GoogleDriveAdapter } from '../../../packages/photos-core/src/storage/google-drive/drive-adapter';
import { StaticTokenSource } from '../../../packages/photos-core/src/auth/static-token-source';
import { encodeSegment, segmentName } from '../../../packages/photos-core/src/library/journal';
import { MemoryLocalStore } from '../../../packages/photos-core/src/library/local-store';
import { NoopLibraryLock } from '../../../packages/photos-core/src/library/lock';
import { PIPELINE_VERSION } from '../../../packages/photos-core/src/library/recipe';
import { openLibrary } from '../../../packages/photos-core/src/library/session';
import type { OpEnvelope } from '../../../packages/photos-core/src/library/types';
import { OP_SCHEMA_VERSION } from '../../../packages/photos-core/src/library/validate';
import { generatedJpeg, importFiles, tiles } from './library';

/**
 * A version edited on a newer build (its `recipe.pipeline` is past this
 * build's PIPELINE_VERSION), opened on this one: the Edit view does not
 * open it, says the app needs updating, and nothing is written to it. The
 * newer build is played by photos-core in Node, on the same fake Drive.
 */

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try it now' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
}

test.skip(BLOB_BODY_SKIP.skip, BLOB_BODY_SKIP.reason);

test('a version from a newer pipeline is shown as needing an update, and left as it is', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const drive = await routeFakeDrive(page.context());
  await page.addInitScript(gisStubInitScript());
  await signIn(page);
  await expect(page.getByText('Your library is empty')).toBeVisible({ timeout: 30_000 });
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 190) }]);
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });

  // The newer build: it reads the library, then edits the photo's version under its own pipeline.
  const adapter = new GoogleDriveAdapter({ tokenSource: new StaticTokenSource(), label: 'Newer build', fetch: drive.fetch });
  const newer = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, lock: new NoopLibraryLock() });
  newer.setSetting('e2e.newer-build', true);
  await newer.syncNow();
  const [version] = [...newer.getView().versions.values()];
  if (!version) throw new Error('The photo did not reach the newer build');
  const folder = (await adapter.listChildren(newer.layout.journalId)).find((f) => f.name === newer.deviceId);
  if (!folder) throw new Error('The newer build has no journal folder');
  const fields = { 'recipe.pipeline': PIPELINE_VERSION + 1, 'recipe.tone.exposure': 0.5, 'recipe.tone.glow': 30 };
  const envelope: OpEnvelope = {
    id: `${newer.deviceId}:2`,
    device: newer.deviceId,
    seq: 2,
    hlc: `${String(Date.now()).padStart(15, '0')}-00000-${newer.deviceId}`,
    v: OP_SCHEMA_VERSION,
    op: { t: 'set', kind: 'version', id: version.id, fields },
  };
  await adapter.createFile({ parentId: folder.id, name: segmentName(2, 2), mimeType: 'application/gzip' }, await encodeSegment([envelope]));
  await newer.close();

  // Another device on this build opens the photo.
  const other = await browser.newContext();
  try {
    await routeFakeDrive(other, drive);
    const second = await other.newPage();
    await second.addInitScript(gisStubInitScript());
    await signIn(second);
    await second.getByRole('button', { name: /^All photos/ }).click();
    const tile = tiles(second).first();
    await expect(tile).toHaveAttribute('title', 'harbour.jpg', { timeout: 30_000 });
    await tile.hover();
    await tile.getByRole('button', { name: /^Edit / }).click();

    const notice = second.getByTestId('edit-notice');
    await expect(notice.getByRole('heading', { name: 'harbour.jpg' })).toBeFocused();
    await expect(notice).toContainText('edited with a newer version of Photonamous');
    await expect(notice.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(second.getByTestId('edit-view')).toHaveCount(0);
    await notice.getByRole('button', { name: 'Back' }).click();
    await expect(notice).toHaveCount(0);
    await expect(second.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  } finally {
    await other.close();
  }

  // What the newer build wrote is still there, as it wrote it.
  const check = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, lock: new NoopLibraryLock() });
  try {
    await check.syncNow();
    expect(check.getView().versions.get(version.id)?.recipe).toMatchObject({ pipeline: PIPELINE_VERSION + 1, tone: { exposure: 0.5 } });
  } finally {
    await check.close();
  }
});
