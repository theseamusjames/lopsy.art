import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { generatedJpeg, importFiles, toast } from './library';

/**
 * The two HDR exports (src/engine/develop-engine.ts `encodeHdr`): a 16-bit
 * BT.2100 PQ PNG and a JPEG with a gain map. Whatever the display, on both
 * renderers. What a person sees on an HDR display cannot be checked here;
 * the files' structure and numbers can.
 *
 * The RAW tests read real camera files from LOPSY_RAF_SAMPLES
 * (github.com/theseamusjames/sample-raf-images) and are skipped without it.
 * Each exports a 40 MP photo at full size, so they are slow.
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

/** The PNG's header: size, bit depth and colour type. */
function pngHeader(bytes: Buffer): { width: number; height: number; depth: number; colorType: number } {
  const ihdr = pngChunks(bytes).find((c) => c.type === 'IHDR')?.data;
  if (!ihdr) throw new Error('no IHDR');
  return { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), depth: ihdr[8] ?? 0, colorType: ihdr[9] ?? 0 };
}

/**
 * The largest R, G or B code of a 16-bit RGB or RGBA PNG, 0..65535, with
 * the rows unfiltered. A test reads a file the app wrote; the app itself
 * never decodes pixels in TypeScript.
 */
function maxCode16(bytes: Buffer): number {
  const { width, height, depth, colorType } = pngHeader(bytes);
  expect(depth).toBe(16);
  const channels = colorType === 6 ? 4 : 3;
  const bpp = channels * 2;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(pngChunks(bytes).filter((c) => c.type === 'IDAT').map((c) => c.data)));
  let prev = Buffer.alloc(stride);
  let row = Buffer.alloc(stride);
  let max = 0;
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1);
    const filter = raw[at] ?? 0;
    for (let x = 0; x < stride; x++) {
      const v = raw[at + 1 + x] ?? 0;
      const a = x >= bpp ? (row[x - bpp] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      let out = v;
      if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      row[x] = out & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        const i = x * bpp + ch * 2;
        max = Math.max(max, ((row[i] ?? 0) << 8) | (row[i + 1] ?? 0));
      }
    }
    [prev, row] = [row, prev];
  }
  return max;
}

/** Checks the PQ PNG's structure: signature, 16 bits, the size, and cICP 9/16/0/1 before the first IDAT. */
function expectPqPng(bytes: Buffer, width: number, height: number): void {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = pngHeader(bytes);
  expect(header).toMatchObject({ width, height, depth: 16 });
  const types = pngChunks(bytes).map((c) => c.type);
  const cicp = pngChunks(bytes).find((c) => c.type === 'cICP');
  expect(cicp).toBeDefined();
  expect([...(cicp?.data ?? [])]).toEqual([9, 16, 0, 1]);
  expect(types.indexOf('cICP')).toBeLessThan(types.indexOf('IDAT'));
}

/** Where the first JPEG in `bytes` ends (just past its EOI), walking its segments and its entropy-coded data. */
function firstJpegEnd(bytes: Buffer): number {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error(`no marker at ${at}`);
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd9) return at + 2;
    const length = bytes.readUInt16BE(at + 2);
    at += 2 + length;
    if (marker !== 0xda) continue;
    // Entropy-coded data: 0xFF is followed by 0x00 (stuffing) or a restart marker until the next real marker.
    while (at + 1 < bytes.length) {
      if (bytes[at] === 0xff) {
        const next = bytes[at + 1] ?? 0;
        if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
      }
      at++;
    }
  }
  throw new Error('no EOI');
}

/** The MPF index's two entries: each image's size and offset (from the MP header; 0 for the first). */
function mpEntries(bytes: Buffer): { size: number; offset: number }[] {
  const at = bytes.indexOf(Buffer.from('MPF\0', 'latin1'));
  if (at < 0) throw new Error('no MPF');
  const header = at + 4;
  const le = bytes.subarray(header, header + 2).toString('latin1') === 'II';
  const u16 = (i: number) => (le ? bytes.readUInt16LE(i) : bytes.readUInt16BE(i));
  const u32 = (i: number) => (le ? bytes.readUInt32LE(i) : bytes.readUInt32BE(i));
  const ifd = header + u32(header + 4);
  for (let i = 0; i < u16(ifd); i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) !== 0xb002) continue;
    const list = header + u32(entry + 8);
    return [0, 1].map((n) => ({ size: u32(list + n * 16 + 4), offset: u32(list + n * 16 + 8) }));
  }
  throw new Error('no MP entries');
}

/** Checks the gain-map JPEG's structure: MPF, the hdrgm XMP, and a second JPEG straight after the first one's end. */
function expectGainMapJpeg(bytes: Buffer): void {
  expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  const text = bytes.toString('latin1');
  expect(text).toContain('MPF\0');
  expect(text).toContain('hdrgm');
  const end = firstJpegEnd(bytes);
  expect(end).toBeLessThan(bytes.length);
  expect([...bytes.subarray(end, end + 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(bytes.subarray(end).toString('latin1')).toContain('hdrgm:GainMapMax');
  // The index agrees with the bytes, the camera details (EXIF) included: the first image's length, and where the second starts.
  const [primary, map] = mpEntries(bytes);
  const header = bytes.indexOf(Buffer.from('MPF\0', 'latin1')) + 4;
  expect(primary?.size).toBe(end);
  expect((map?.offset ?? 0) + header).toBe(end);
  expect(map?.size).toBe(bytes.length - end);
}

/** The file's size and mean and largest difference from `other`, as the browser decodes both (in the test page). */
async function compareInBrowser(page: Page, a: Buffer, b: Buffer): Promise<{ width: number; height: number; mean: number; max: number }> {
  return page.evaluate(
    async ([one, two]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0);
        return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
      };
      const x = await decode(one);
      const y = await decode(two);
      if (x.width !== y.width || x.height !== y.height) return { width: x.width, height: x.height, mean: 255, max: 255 };
      let sum = 0;
      let max = 0;
      let n = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = Math.abs((x.data[i + c] ?? 0) - (y.data[i + c] ?? 0));
          sum += d;
          max = Math.max(max, d);
          n++;
        }
      }
      return { width: x.width, height: x.height, mean: sum / n, max };
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
}

/** Opens the Export dialog for the selection, picks `format` and downloads the file. */
async function exportAs(page: Page, format: RegExp, timeout = 120_000): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('button', { name: /^Export \d/ }).click();
  await page.getByRole('radio', { name: format }).check();
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const download = page.waitForEvent('download', { timeout });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  const name = file.suggestedFilename();
  await file.delete();
  await expect(page.getByText(/^Exported \d+ photos?\.$/)).toBeVisible({ timeout });
  await page.getByRole('button', { name: 'Done' }).click();
  return { name, bytes };
}

test('the HDR formats are offered with what each is, and with no colour or size choice', async ({ page }) => {
  await openLibrary(page);
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 30, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.locator('[role="gridcell"][title="harbour.jpg"]').click();
  await page.getByRole('button', { name: /^Export 1/ }).click();

  const hdrJpeg = page.getByRole('radio', { name: 'HDR JPEG (gain map)' });
  const hdrPng = page.getByRole('radio', { name: 'HDR PNG (16-bit, PQ)' });
  await expect(hdrJpeg).toHaveAccessibleDescription(/ordinary JPEG in every program/);
  await expect(hdrPng).toHaveAccessibleDescription(/PQ/);

  await hdrPng.check();
  await expect(page.getByRole('combobox', { name: 'Colours' })).toHaveCount(0);
  await expect(page.getByText('Rec. 2020, HDR (PQ)')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Quality' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Size' })).toBeDisabled();
  await expect(page.getByText('HDR files are always the full size.')).toBeVisible();

  await hdrJpeg.check();
  await expect(page.getByText('sRGB, with the HDR gain map')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Quality' })).toBeVisible();

  // Back to an ordinary format, the choices return.
  await page.getByRole('radio', { name: /^PNG/ }).check();
  await expect(page.getByRole('combobox', { name: 'Colours' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Size' })).toBeEnabled();
});

test('a JPEG photo exports as an HDR PNG and as a gain-map JPEG that is the ordinary JPEG', async ({ page }) => {
  test.setTimeout(240_000);
  await openLibrary(page);
  await importFiles(page, [{ name: 'harbour.jpg', buffer: await generatedJpeg(page, 200, 480, 320) }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await page.locator('[role="gridcell"][title="harbour.jpg"]').click();

  const png = await exportAs(page, /^HDR PNG/);
  expect(png.name).toBe('harbour.png');
  expectPqPng(png.bytes, 480, 320);
  // Nothing in an ordinary JPEG is brighter than white: no code above SDR white's (203 cd/m², about 0.58 of full scale).
  expect(maxCode16(png.bytes)).toBeLessThanOrEqual(Math.ceil(0.581 * 65535));

  const gainMap = await exportAs(page, /^HDR JPEG/);
  expect(gainMap.name).toBe('harbour.jpg');
  expectGainMapJpeg(gainMap.bytes);

  const ordinary = await exportAs(page, /^JPEG/);
  const diff = await compareInBrowser(page, gainMap.bytes, ordinary.bytes);
  expect({ width: diff.width, height: diff.height }).toEqual({ width: 480, height: 320 });
  // The same picture through the same encoder at the same quality.
  expect(diff.mean).toBeLessThan(1);
  expect(diff.max).toBeLessThanOrEqual(8);
});

test('several photos export as HDR files together', async ({ page }) => {
  test.setTimeout(240_000);
  await openLibrary(page);
  await importFiles(page, [
    { name: 'alpha.jpg', buffer: await generatedJpeg(page, 40, 320, 240) },
    { name: 'beta.jpg', buffer: await generatedJpeg(page, 220, 320, 240) },
  ]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(2);
  await page.getByRole('gridcell').first().click();
  await page.keyboard.press('Control+a');
  const zip = await exportAs(page, /^HDR JPEG/);
  expect(zip.name).toMatch(/\.zip$/);
  const text = zip.bytes.toString('latin1');
  expect(text).toContain('alpha.jpg');
  expect(text).toContain('beta.jpg');
  // Two gain-map JPEGs inside the stored zip.
  expect(text.split('hdrgm:GainMapMax').length - 1).toBe(2);
});

const samples = process.env.LOPSY_RAF_SAMPLES;
/** A sample with a bright sky: highlights the RAW holds above white. */
const BRIGHT = 'DSCF8005.RAF';

test.describe('HDR exports of a RAF', () => {
  const sample = samples && existsSync(join(samples, BRIGHT)) ? join(samples, BRIGHT) : null;
  test.skip(!sample, `Set LOPSY_RAF_SAMPLES to a directory holding ${BRIGHT} to run these tests`);
  test.setTimeout(20 * 60_000);

  test('a bright RAW gives a PQ PNG with highlights above white, and a gain-map JPEG of the same size', async ({ page }) => {
    if (!sample) return;
    await openLibrary(page);
    await page.getByRole('button', { name: /Import photos/ }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Choose photos/ }).click();
    await (await chooser).setFiles([sample]);
    await page.getByRole('button', { name: /^Import 1 photo/ }).click();
    await expect(toast(page, /^Imported 1 photo/)).toBeVisible({ timeout: 300_000 });
    await page.getByRole('button', { name: /^All photos/ }).click();
    await page.getByRole('gridcell').first().click();

    const png = await exportAs(page, /^HDR PNG/, 900_000);
    expect(png.name).toBe('DSCF8005.png');
    const { width, height } = pngHeader(png.bytes);
    expect(Math.max(width, height)).toBeGreaterThan(6000);
    expectPqPng(png.bytes, width, height);
    // SDR white (203 cd/m²) is PQ code 0.58; the sky's highlights run above it.
    expect(maxCode16(png.bytes) / 65535).toBeGreaterThan(0.62);

    const gainMap = await exportAs(page, /^HDR JPEG/, 900_000);
    expect(gainMap.name).toBe('DSCF8005.jpg');
    expectGainMapJpeg(gainMap.bytes);
    const size = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      return { width: bitmap.width, height: bitmap.height };
    }, gainMap.bytes.toString('base64'));
    expect(size).toEqual({ width, height });
  });
});
