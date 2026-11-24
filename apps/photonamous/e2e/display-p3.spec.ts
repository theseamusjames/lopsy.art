import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { importFiles } from './library';
import { gpuArgs } from './gpu-args';

/**
 * On a Display P3 display the canvas is Display P3, on both builds, and
 * what is copied out of it still says what it is (src/engine/develop-engine.ts):
 * an sRGB 8-bit export holds sRGB numbers, a Display P3 one P3 numbers.
 * Chromium's --force-color-profile gives the headless browser a P3
 * display, so `(color-gamut: p3)` matches; it cannot show what a person
 * sees on a real one.
 */
test.use({ launchOptions: { args: [...gpuArgs, '--force-color-profile=display-p3-d65'] } });

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

/** The first pixel of an 8-bit RGB or RGBA PNG. A test reads a file the app wrote; the app itself never decodes pixels in TypeScript. */
function firstPixel8(bytes: Buffer): number[] {
  const chunks = pngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR')?.data;
  if (!ihdr) throw new Error('no IHDR');
  expect(ihdr[8]).toBe(8);
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  // Every filter leaves the first pixel of row 0 as it is (it is filtered against zeros).
  return [raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0];
}

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

async function exportPng8(page: Page, space: 'srgb' | 'display-p3'): Promise<Buffer> {
  await page.getByRole('button', { name: /^Export 1/ }).click();
  await page.getByRole('radio', { name: /^PNG/ }).check();
  await page.getByRole('radio', { name: /^8-bit/ }).check();
  await page.getByRole('combobox', { name: 'Colours' }).selectOption(space);
  await page.getByRole('radio', { name: 'Download to this computer' }).check();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  await file.delete();
  await page.getByRole('button', { name: 'Done' }).click();
  return bytes;
}

test('a P3 display: the canvas is Display P3, and copies out of it are what they say', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(color-gamut: p3)').matches)).toBe(true);
  await page.getByRole('button', { name: /This browser/ }).click();
  await expect(page.getByText('Your library is empty')).toBeVisible();
  await importFiles(page, [{ name: 'red.jpg', buffer: await flatJpeg(page, '#ff0000') }]);
  await page.getByRole('button', { name: /^All photos/ }).click();
  const tile = page.locator('[role="gridcell"][title="red.jpg"]');
  await expect(page.getByTestId('status-display')).toHaveText('Display: Display P3');

  // The stored preview was copied out of a P3 canvas: it is still sRGB red.
  const preview = await tile.locator('img').first().evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, img.naturalWidth / 2, img.naturalHeight / 2, 1, 1, 0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3));
  });
  // Read through the browser's colour management: a preview that held P3 numbers would read about (234, 51, 35) here.
  const [pr = 0, pg = 0, pb = 0] = preview;
  expect(pr).toBeGreaterThan(245);
  expect(Math.max(pg, pb)).toBeLessThan(12);

  // Both 8-bit exports are drawn by the engine into the canvas and copied: sRGB numbers in one, P3 in the other.
  await tile.click();
  const srgb = await exportPng8(page, 'srgb');
  const p3 = await exportPng8(page, 'display-p3');
  const types = (png: Buffer) => pngChunks(png).filter((c) => ['sRGB', 'iCCP', 'cICP'].includes(c.type)).map((c) => c.type);
  expect(types(srgb)).toEqual(['sRGB']);
  expect(types(p3)).toContain('iCCP');
  const [r0 = 0, g0 = 0, b0 = 0] = firstPixel8(srgb);
  const [r1 = 0, g1 = 0, b1 = 0] = firstPixel8(p3);
  // sRGB red is (255, 0, 0); in Display P3 numbers it is about (234, 51, 35).
  expect(r0).toBeGreaterThan(245);
  expect(Math.max(g0, b0)).toBeLessThan(12);
  expect(Math.abs(r1 - 234)).toBeLessThan(8);
  expect(Math.abs(g1 - 51)).toBeLessThan(10);
  expect(Math.abs(b1 - 35)).toBeLessThan(10);

  // The Edit view's canvas is Display P3.
  await tile.hover();
  await tile.getByRole('button', { name: /^Edit / }).click();
  await expect(page.getByTestId('status-photo-size')).toBeVisible({ timeout: 60_000 });
  const space = await page.getByTestId('edit-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2');
    if (gl) return gl.drawingBufferColorSpace;
    const gpu = canvas.getContext('webgpu') as unknown as { getConfiguration?: () => { colorSpace?: string } | null } | null;
    return gpu?.getConfiguration?.()?.colorSpace ?? 'unknown';
  });
  // A WebGPU canvas says how the engine configured it (GPUCanvasContext.getConfiguration).
  expect(space).toBe('display-p3');
  // A wide-gamut display that is not HDR: no HDR in the status bar and no HDR switch.
  await expect(page.getByTestId('status-hdr')).toHaveCount(0);
  await expect(page.getByTestId('status-hdr-view')).toHaveCount(0);
});
