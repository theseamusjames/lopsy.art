import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { generatedJpeg, importFiles } from './library';

/** The names in a zip's central directory. */
function zipNames(bytes: Buffer): string[] {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    at += 46 + nameLength + extra + comment;
  }
  return names;
}

/** The pixel size in a JPEG's first SOF marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1] ?? 0;
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  return null;
}

test('export two photos as one zip, named by a template and sized by short edge', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [
    { name: 'alpha.jpg', buffer: await generatedJpeg(page, 40, 480, 320) },
    { name: 'beta.jpg', buffer: await generatedJpeg(page, 200, 480, 320) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(2);
  await page.getByRole('gridcell').first().click();
  await page.keyboard.press('Control+a');

  await page.getByRole('button', { name: /^Export 2/ }).click();
  await page.getByRole('textbox', { name: 'File name template' }).fill('trip-{seq:3}-{name}');
  await page.getByRole('combobox', { name: 'Size' }).selectOption('short');
  await page.getByRole('spinbutton', { name: 'Pixels' }).fill('160');
  // Remove location is on and shown; the default keeps nothing that says where.
  await expect(page.getByRole('checkbox', { name: 'Remove location' })).toBeChecked();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  await expect(page.getByRole('checkbox', { name: 'As one zip' })).toBeChecked();
  await page.getByRole('textbox', { name: 'Zip name' }).fill('Trip');

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Trip.zip');
  const bytes = await readFile(await file.path());
  await file.delete();
  const names = zipNames(bytes).sort();
  expect(names).toHaveLength(2);
  expect(names.every((n) => /^trip-00[12]-(alpha|beta)\.jpg$/.test(n))).toBe(true);
  expect(new Set(names.map((n) => n.slice(0, 8))).size).toBe(2);
  await expect(page.getByText('Exported 2 photos.')).toBeVisible();
  // Done means a full bar.
  await expect(page.getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('aria-valuenow', '2');

  // One photo on its own, sized by short edge: 160 px short, 240 long.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('[role="gridcell"][title="alpha.jpg"]').click();
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('combobox', { name: 'Size' }).selectOption('short');
  await page.getByRole('spinbutton', { name: 'Pixels' }).fill('160');
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const single = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const one = await single;
  expect(one.suggestedFilename()).toBe('alpha.jpg');
  const jpeg = await readFile(await one.path());
  await one.delete();
  expect(jpegSize(jpeg)).toEqual({ width: 240, height: 160 });

  // Saved as a preset, every choice comes back: PNG 8-bit, short edge 160, no metadata, the template.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('radio', { name: /^PNG/ }).check();
  await page.getByRole('radio', { name: /^8-bit/ }).check();
  await page.getByRole('combobox', { name: 'Size' }).selectOption('short');
  await page.getByRole('spinbutton', { name: 'Pixels' }).fill('160');
  await page.getByRole('radio', { name: 'None', exact: true }).check();
  await page.getByRole('textbox', { name: 'File name template' }).fill('{date}-{name}');
  await page.getByRole('button', { name: 'Save these settings as a preset' }).click();
  await page.getByRole('textbox', { name: 'Preset name' }).fill('Small PNG');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await expect(page.getByRole('radio', { name: /^JPEG/ })).toBeChecked();
  await page.getByRole('combobox', { name: 'Export preset' }).selectOption({ label: 'Small PNG' });
  await expect(page.getByRole('radio', { name: /^PNG/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /^8-bit/ })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Size' })).toHaveValue('short');
  await expect(page.getByRole('spinbutton', { name: 'Pixels' })).toHaveValue('160');
  await expect(page.getByRole('radio', { name: 'None', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'File name template' })).toHaveValue('{date}-{name}');
});
