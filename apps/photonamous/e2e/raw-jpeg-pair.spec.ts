import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './test';
import { toast } from './library';

/**
 * A RAW+JPEG pair imported together is one tile with the RAW+JPEG badge,
 * and the hidden JPEG is counted nowhere (All photos, Dates, the import).
 * Needs a real RAF: point LOPSY_RAF_SAMPLES at a directory of them
 * (github.com/theseamusjames/sample-raf-images).
 */
const samples = process.env.LOPSY_RAF_SAMPLES;

function firstSample(): string | null {
  if (!samples || !existsSync(samples)) return null;
  const name = readdirSync(samples)
    .filter((f) => f.toLowerCase().endsWith('.raf'))
    .sort()[0];
  return name ? join(samples, name) : null;
}

const sample = firstSample();

test.skip(sample === null, 'needs LOPSY_RAF_SAMPLES pointing at sample RAF files');

test('a RAW+JPEG pair is one tile with its badge, counted once', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  if (!sample) return;
  const stem = sample.split('/').pop()?.replace(/\.raf$/i, '') ?? 'pair';
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();

  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  // The camera's JPEG of the same shot: the one inside the RAF (offset and length at bytes 84 and 88), so
  // its capture time matches. Over 50 MB, so both go by path.
  const raf = await readFile(sample);
  const jpegPath = testInfo.outputPath(`${stem}.JPG`);
  await writeFile(jpegPath, raf.subarray(raf.readUInt32BE(84), raf.readUInt32BE(84) + raf.readUInt32BE(88)));
  await (await chooser).setFiles([sample, jpegPath]);
  await page.getByRole('button', { name: /^Import \d+ photo/ }).click();
  // The import's outcome (a toast) counts photos, as the grid does: the pair is one.
  await expect(toast(page, 'Imported 1 photo (2 files: RAW+JPEG pairs count once)')).toBeVisible({ timeout: 150_000 });

  const sidebar = page.getByRole('navigation', { name: 'Library' });
  await sidebar.getByRole('button', { name: /^All photos/ }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(1);
  const tile = page.getByRole('gridcell').first();
  await expect(tile).toHaveAttribute('title', `${stem}.RAF`);
  await expect(tile.getByText('RAW+JPEG')).toBeVisible();

  // Every count agrees: one photo.
  await expect(sidebar.getByRole('button', { name: /^All photos 1$/ })).toBeVisible();
  const dates = sidebar.getByRole('button', { name: /^\d{4} \d+$/ });
  await expect(dates).toHaveCount(1);
  await expect(dates.first()).toHaveAccessibleName(/ 1$/);
});
