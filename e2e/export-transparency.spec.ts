import { test, expect } from './fixtures';
import { waitForStore, createDocument, paintRect, getPixelAt } from './helpers';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Transparency export roundtrip', () => {
  test('exported PNG preserves transparency when re-opened', async ({ page }) => {
    // Auto-accept any "unsaved changes" dialogs
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/');
    await waitForStore(page);

    // Create a transparent 100x100 document
    await createDocument(page, 100, 100, true);
    await page.waitForTimeout(300);

    // Paint a fully opaque red rectangle, leaving the rest transparent
    await paintRect(page, 10, 10, 30, 30, { r: 255, g: 0, b: 0, a: 255 });
    await page.waitForTimeout(200);

    // Sanity-check before export: transparent area vs painted area
    const prePainted = await getPixelAt(page, 20, 20);
    expect(prePainted.r).toBe(255);
    expect(prePainted.a).toBe(255);

    const preTransparent = await getPixelAt(page, 50, 50);
    expect(preTransparent.a).toBe(0);

    // Export as PNG
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Export PNG' }).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lopsy.png');

    // Save the downloaded PNG to a temp location
    const tmpDir = path.join(process.cwd(), 'test-results', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, 'transparency-roundtrip.png');
    await download.saveAs(tmpFile);

    // Verify the exported PNG has transparency by decoding it in-browser
    const pngBase64 = fs.readFileSync(tmpFile).toString('base64');
    const exportedPixels = await page.evaluate(async (b64: string) => {
      const response = await fetch(`data:image/png;base64,${b64}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      // Sample a transparent pixel (50,50) and a painted pixel (20,20)
      const tIdx = (50 * data.width + 50) * 4;
      const pIdx = (20 * data.width + 20) * 4;
      return {
        transparent: {
          r: data.data[tIdx]!, g: data.data[tIdx + 1]!,
          b: data.data[tIdx + 2]!, a: data.data[tIdx + 3]!,
        },
        painted: {
          r: data.data[pIdx]!, g: data.data[pIdx + 1]!,
          b: data.data[pIdx + 2]!, a: data.data[pIdx + 3]!,
        },
      };
    }, pngBase64);

    // The exported PNG must preserve transparency
    expect(exportedPixels.transparent.a).toBe(0);
    expect(exportedPixels.painted.r).toBe(255);
    expect(exportedPixels.painted.a).toBe(255);

    // Refresh the UI completely
    await page.goto('/');
    await waitForStore(page);

    // Load the exported PNG back into the app programmatically
    // (same code path as File > Open, avoids file chooser UI timing issues)
    await page.evaluate(async (b64: string) => {
      return new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          if (!ctx) { reject(new Error('no 2d context')); return; }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const store = (window as unknown as Record<string, unknown>).__editorStore as {
            getState: () => { openImageAsDocument: (data: ImageData, name: string) => void };
          };
          store.getState().openImageAsDocument(imageData, 'transparency-test');
          resolve();
        };
        img.onerror = () => reject(new Error('failed to load image'));
        img.src = `data:image/png;base64,${b64}`;
      });
    }, pngBase64);

    await page.waitForTimeout(500);

    // The app should detect transparency and set a transparent background
    const bgColor = await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__editorStore as {
        getState: () => {
          document: { backgroundColor: { r: number; g: number; b: number; a: number } };
        };
      };
      return store.getState().document.backgroundColor;
    });
    expect(bgColor.a).toBe(0);

    // Transparent regions must still have alpha = 0
    const postTransparent = await getPixelAt(page, 50, 50);
    expect(postTransparent.a).toBe(0);

    // Painted region must retain full red at full opacity
    const postPainted = await getPixelAt(page, 20, 20);
    expect(postPainted.r).toBe(255);
    expect(postPainted.a).toBe(255);

    await page.screenshot({
      path: 'test-results/screenshots/export-transparency-roundtrip.png',
    });

    // Clean up temp file
    fs.unlinkSync(tmpFile);
  });
});
