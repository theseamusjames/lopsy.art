import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/** One IFD entry: tag, type, count and the value or offset (little-endian TIFF). */
interface Entry {
  readonly type: number;
  readonly count: number;
  readonly value: number;
}

function firstIfd(bytes: Buffer): Map<number, Entry> {
  const offset = bytes.readUInt32LE(4);
  const count = bytes.readUInt16LE(offset);
  const out = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    const type = bytes.readUInt16LE(at + 2);
    const n = bytes.readUInt32LE(at + 4);
    // One SHORT sits in the first two bytes of the value field; anything longer than four bytes is an offset.
    const value = type === 3 && n === 1 ? bytes.readUInt16LE(at + 8) : bytes.readUInt32LE(at + 8);
    out.set(bytes.readUInt16LE(at), { type, count: n, value });
  }
  return out;
}

test('export the 16-bit TIFF, Display P3 preset to a download', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 120, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const tile = page.locator('[role="gridcell"][title="harbour.jpg"]');
  await tile.click();

  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('combobox', { name: 'Export preset' }).selectOption({ label: '16-bit TIFF, Display P3' });
  await expect(page.getByRole('radio', { name: /^TIFF, 16-bit/ })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Colours' })).toHaveValue('display-p3');
  // TIFF keeps no EXIF, so the metadata choices are off.
  await expect(page.getByRole('radio', { name: 'Copyright and contact only' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.tif$/);
  const path = await file.path();
  const bytes = await readFile(path);
  await file.delete();

  // Little-endian TIFF: "II", 42.
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('II');
  expect(bytes.readUInt16LE(2)).toBe(42);
  const ifd = firstIfd(bytes);
  expect(ifd.get(256)?.value).toBe(480); // ImageWidth
  expect(ifd.get(257)?.value).toBe(320); // ImageLength
  // BitsPerSample: one 16 per channel.
  const bits = ifd.get(258);
  expect(bits).toBeDefined();
  if (!bits) return;
  const perSample = bits.count === 1 ? [bits.value] : Array.from({ length: bits.count }, (_, i) => bytes.readUInt16LE(bits.value + i * 2));
  expect(perSample.every((b) => b === 16)).toBe(true);
  // An embedded ICC profile (tag 34675), a Display P3 one.
  const icc = ifd.get(34675);
  expect(icc).toBeDefined();
  if (!icc) return;
  const profile = bytes.subarray(icc.value, icc.value + icc.count);
  expect(profile.subarray(36, 40).toString('latin1')).toBe('acsp');
  expect(profile.toString('latin1')).toMatch(/P\0?3/);
  await expect(page.getByText('Exported 1 photo.')).toBeVisible();
});
