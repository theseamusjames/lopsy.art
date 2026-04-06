import { test, expect } from '@playwright/test';
import { waitForStore, createDocument, paintRect } from './helpers';

test.describe('Export formats (#57)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 100, 100, false);
    await page.waitForTimeout(300);
    await paintRect(page, 10, 10, 20, 20, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(200);
  });

  test('export menu shows all format options', async ({ page }) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);

    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export JPEG' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export WebP' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export BMP' })).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/export-formats-menu.png' });
  });

  test('WebP export triggers download with correct filename', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Export WebP' }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lopsy.webp');

    await page.screenshot({ path: 'test-results/screenshots/export-webp-menu.png' });
  });

  test('BMP export triggers download with correct filename', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Export BMP' }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lopsy.bmp');

    await page.screenshot({ path: 'test-results/screenshots/export-bmp-menu.png' });
  });

  test('BMP export produces valid BMP data', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Export BMP' }).click();

    const download = await downloadPromise;
    const readable = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(chunk as Buffer);
    }
    const buf = Buffer.concat(chunks);

    // BMP magic bytes: 'BM'
    expect(buf[0]).toBe(0x42);
    expect(buf[1]).toBe(0x4d);

    // File size at offset 2 (uint32 LE) should match buffer length
    const fileSize = buf.readUInt32LE(2);
    expect(fileSize).toBe(buf.length);

    // DIB header size at offset 14 should be 40 (BITMAPINFOHEADER)
    const dibSize = buf.readUInt32LE(14);
    expect(dibSize).toBe(40);

    // Image dimensions (100x100)
    const width = buf.readInt32LE(18);
    const height = buf.readInt32LE(22);
    expect(width).toBe(100);
    expect(height).toBe(100);

    // 24 bits per pixel
    const bpp = buf.readUInt16LE(28);
    expect(bpp).toBe(24);
  });

  test('WebP export produces valid WebP data', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Export WebP' }).click();

    const download = await downloadPromise;
    const readable = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(chunk as Buffer);
    }
    const buf = Buffer.concat(chunks);

    // WebP files start with RIFF header, bytes 8-11 are 'WEBP'
    expect(buf.length).toBeGreaterThan(12);
    const riffTag = buf.slice(0, 4).toString('ascii');
    expect(riffTag).toBe('RIFF');
    const webpTag = buf.slice(8, 12).toString('ascii');
    expect(webpTag).toBe('WEBP');
  });
});
