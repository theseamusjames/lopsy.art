import { expect, test } from '@playwright/test';
import { generatedJpeg, importFiles, tiles } from './library';

/** Check library finds an original that went missing behind the app's back, and badges its tile. */
test('Check library marks a missing original', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'kept.jpg', buffer: await generatedJpeg(page, 120, 320, 240) },
    { name: 'lost.jpg', buffer: await generatedJpeg(page, 10, 320, 240) },
  ]);
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close this library' }).click();
  await expect(page.getByRole('button', { name: /Open your library in this browser/ })).toBeVisible();

  // Behind the app's back: lost.jpg disappears from the folder and from the storage index.
  const removed = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('photonamous');
    const indexHandle = await root.getFileHandle('.lopsy-storage.json');
    const index = JSON.parse(await (await indexHandle.getFile()).text()) as {
      entries: { id: string; name: string; properties: Record<string, string> }[];
    };
    const before = index.entries.length;
    index.entries = index.entries.filter((e) => !(e.name === 'lost.jpg' && e.properties['lp.role'] === 'original'));
    const writable = await indexHandle.createWritable();
    await writable.write(JSON.stringify(index));
    await writable.close();
    return before - index.entries.length;
  });
  expect(removed).toBe(1);

  await page.getByRole('button', { name: /Open your library in this browser/ }).click();
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(tiles(page)).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Check library' }).click();
  await expect(page.getByText('1 original is missing from storage.')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[title="lost.jpg"]')).toContainText('Missing original');
  await expect(page.locator('[title="kept.jpg"]')).not.toContainText('Missing original');
});
