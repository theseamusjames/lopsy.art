import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { importFiles } from './library';

/**
 * Every export is tagged with the space its pixels are in, and Rec. 2020
 * (16-bit files only) holds Rec. 2020 numbers: the engine renders each file
 * straight from its working space (src/engine/develop-engine.ts). The
 * browser's JPEG and 8-bit PNG encoders leave an sRGB file untagged; the
 * app adds the profile.
 */

interface PngChunk {
  readonly type: string;
  readonly data: Buffer;
}

function pngChunks(bytes: Buffer): PngChunk[] {
  const out: PngChunk[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    out.push({ type: bytes.subarray(at + 4, at + 8).toString('latin1'), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

/** The first pixel of a 16-bit RGBA PNG, 0..65535 a channel. A test reads a file the app wrote: the app itself never decodes pixels in TypeScript. */
function firstPixel16(bytes: Buffer): number[] {
  const chunks = pngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR')?.data;
  if (!ihdr) throw new Error('no IHDR');
  expect(ihdr[8]).toBe(16);
  expect(ihdr[9]).toBe(6);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  // Filter 0 or 1 (Sub) leave the first pixel of a row as it is; Up, Average and Paeth on row 0 do too, against zeros.
  return [0, 1, 2].map((i) => raw.readUInt16BE(1 + i * 2));
}

function jpegIcc(bytes: Buffer): Buffer | null {
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xda) return null;
    const length = bytes.readUInt16BE(at + 2);
    const body = bytes.subarray(at + 4, at + 2 + length);
    if (marker === 0xe2 && body.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0') return body.subarray(14);
    at += 2 + length;
  }
  return null;
}

/** A JPEG of one saturated colour, made in the page. */
async function flatJpeg(page: Page, color: string): Promise<Buffer> {
  const bytes = await page.evaluate(async (fill) => {
    const canvas = new OffscreenCanvas(64, 48);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 64, 48);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, color);
  return Buffer.from(bytes);
}

async function exportOne(page: Page, choose: () => Promise<void>): Promise<Buffer> {
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await choose();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  await file.delete();
  await page.getByRole('button', { name: 'Done' }).click();
  return bytes;
}

async function choosePng16(page: Page, space: string): Promise<void> {
  await page.getByRole('radio', { name: /^PNG/ }).check();
  await page.getByRole('radio', { name: '16-bit', exact: true }).check();
  await page.getByRole('combobox', { name: 'Colours' }).selectOption(space);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'red.jpg', buffer: await flatJpeg(page, '#ff0000') }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.locator('[role="gridcell"][title="red.jpg"]').click();
});

test('Rec. 2020 is offered for 16-bit files only', async ({ page }) => {
  await page.getByRole('button', { name: /^Export 1/ }).click();
  const colours = page.getByRole('combobox', { name: 'Colours' });
  await page.getByRole('radio', { name: /^JPEG/ }).check();
  await expect(colours.locator('option')).toHaveText([/^sRGB/, /^Display P3/]);
  await page.getByRole('radio', { name: /^PNG/ }).check();
  await page.getByRole('radio', { name: '16-bit', exact: true }).check();
  await expect(colours.locator('option')).toHaveText([/^sRGB/, /^Display P3/, /^Rec\. 2020/]);
  await page.getByRole('radio', { name: /^8-bit/ }).check();
  await expect(colours.locator('option')).toHaveText([/^sRGB/, /^Display P3/]);
});

test('a Rec. 2020 16-bit PNG is tagged and holds Rec. 2020 numbers', async ({ page }) => {
  test.setTimeout(180_000);
  const srgb = await exportOne(page, () => choosePng16(page, 'srgb'));
  const rec2020 = await exportOne(page, () => choosePng16(page, 'rec2020'));

  const srgbTypes = pngChunks(srgb).map((c) => c.type);
  expect(srgbTypes).toContain('sRGB');
  expect(srgbTypes).not.toContain('iCCP');
  const wide = pngChunks(rec2020);
  // cICP: BT.2020 primaries (9), the BT.709 curve (1), RGB, full range; and an ICC profile beside it.
  const cicp = wide.find((c) => c.type === 'cICP')?.data;
  expect(cicp ? Array.from(cicp) : null).toEqual([9, 1, 0, 1]);
  expect(wide.some((c) => c.type === 'iCCP')).toBe(true);

  // sRGB red sits inside Rec. 2020, nearer its neutral axis: less red, more green and blue in Rec. 2020 numbers.
  const [r0 = 0, g0 = 0, b0 = 0] = firstPixel16(srgb);
  const [r1 = 0, g1 = 0, b1 = 0] = firstPixel16(rec2020);
  expect(r0).toBeGreaterThan(60000);
  expect(g0).toBeLessThan(6000);
  expect(r1).toBeLessThan(r0 - 3000);
  expect(g1).toBeGreaterThan(g0 + 5000);
  expect(b1).toBeGreaterThanOrEqual(b0);
});

test('a JPEG and an 8-bit PNG are tagged sRGB, and a Display P3 JPEG as Display P3', async ({ page }) => {
  test.setTimeout(180_000);
  const jpeg = await exportOne(page, async () => {
    await page.getByRole('radio', { name: /^JPEG/ }).check();
    await page.getByRole('combobox', { name: 'Colours' }).selectOption('srgb');
  });
  const srgbIcc = jpegIcc(jpeg);
  expect(srgbIcc?.subarray(36, 40).toString('latin1')).toBe('acsp');
  expect(srgbIcc?.toString('latin1')).toMatch(/s\0?R\0?G\0?B/);

  const png8 = await exportOne(page, async () => {
    await page.getByRole('radio', { name: /^PNG/ }).check();
    await page.getByRole('radio', { name: /^8-bit/ }).check();
    await page.getByRole('combobox', { name: 'Colours' }).selectOption('srgb');
  });
  expect(pngChunks(png8).filter((c) => ['sRGB', 'iCCP', 'cICP'].includes(c.type)).map((c) => c.type)).toEqual(['sRGB']);

  const p3 = await exportOne(page, async () => {
    await page.getByRole('radio', { name: /^JPEG/ }).check();
    await page.getByRole('combobox', { name: 'Colours' }).selectOption('display-p3');
  });
  expect(jpegIcc(p3)?.toString('latin1')).toMatch(/P\0?3/);
});
