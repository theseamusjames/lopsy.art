import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './test';
import type { Page } from './test';
import { imageStats, jpegSize, lastExportSize, openGeneratedImage, openHarness, waitForPreview, waitForReady, type ImageStats } from './harness';
import { generatedJpeg, importFiles, importStrip, toast } from './library';

/**
 * A photo wider than the GPU's largest texture. Headless Chromium's
 * software GPU (SwiftShader) takes textures up to 8192 pixels on a side on
 * WebGPU and WebGL alike, and the Leica Q2's frame is 8368 × 5584: its full
 * size is then the largest that fits with straighten's border, 8190 × 5465,
 * rendered by the workers
 * reduced band by band (or, on `?develop=no-float`, the baked decode
 * reduced before its upload). The Edit view says so in words and in its
 * live region, and the full-size load ends and is not asked for again.
 * Exports are made by the export renderer, as the app's are (the Edit
 * harness's `__photosHarnessExport`, and the library's Export): at the
 * photo's own size, a tile at a time (plan section 10), where the GPU
 * renders in floating point; at the held size on `?develop=no-float`. The
 * Edit harness's own Export button is the Edit view's engine, which never
 * makes tiles: it exports at the held size.
 *
 * The sample is not in the repository: LOPSY_DNG_CAMERA_SAMPLES is the
 * folder holding Leica-Q2.dng. On a GPU that holds the Q2 at its own size
 * the test has nothing to show and skips.
 */
const dir = process.env.LOPSY_DNG_CAMERA_SAMPLES;
const q2 = dir && existsSync(join(dir, 'Leica-Q2.dng')) ? join(dir, 'Leica-Q2.dng') : null;
const OWN = { width: 8368, height: 5584 };
/** The largest the GPU can edit at 8192: two pixels under it, for straighten's border (full-size.ts). */
const HELD_AT_8192 = { width: 8190, height: 5465 };
const NOTE = 'This photo is 8368 × 5584 pixels, larger than this device’s graphics can edit (8190 on a side), so it is shown at 8190 × 5465. It is exported at its full size, a part at a time.';
/** On a GPU without float targets nothing is made in tiles. */
const NOTE_NO_TILES = 'This photo is 8368 × 5584 pixels, larger than this device’s graphics can edit (8190 on a side), so it is shown and exported at 8190 × 5465.';

declare global {
  interface Window {
    __photosHarnessExport?: (settings: Record<string, unknown>) => Promise<Blob>;
    __photonamousTiles?: { plan: { columns: number; rows: number; apron: number } | null; done: number; finished: boolean };
  }
}

/** The open photo exported as a JPEG through the export renderer, the app's export path: its size, the plan it was made in, and how long it took. */
async function rendererExport(
  page: Page,
  settings: Record<string, unknown> = { format: 'jpeg', quality: 0.9, maxLongEdge: null, metadata: 'none' },
): Promise<{ size: { width: number; height: number } | null; plan: { columns: number; rows: number; apron: number } | null; seconds: number }> {
  return page.evaluate(async (settings) => {
    const run = window.__photosHarnessExport;
    if (!run) throw new Error('no export hook');
    window.__photonamousTiles = undefined;
    const started = performance.now();
    const blob = await run(settings);
    const seconds = (performance.now() - started) / 1000;
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const tiles = window.__photonamousTiles;
    return { size, plan: tiles?.finished ? tiles.plan : null, seconds };
  }, settings);
}

async function open(page: Page, path: string, query = ''): Promise<void> {
  await page.goto(`/edit-harness.html${query}`);
  await expect(page.getByTestId('harness-file')).toBeAttached();
  await page.getByTestId('harness-file').setInputFiles(path);
}

/** The engine's document and texture limit (development builds' hooks). */
async function engineSizes(page: Page): Promise<{ document: { width: number; height: number }; limit: number }> {
  return page.evaluate(() => {
    const hook = window.__photonamousScreenEngine;
    if (!hook) throw new Error('no screen engine');
    return { document: hook.documentSize(), limit: hook.textureLimit() };
  });
}

async function skipUnlessTooLarge(page: Page, longEdge = Math.max(OWN.width, OWN.height)): Promise<void> {
  const { limit } = await engineSizes(page);
  test.skip(limit - 2 >= longEdge, `this GPU holds ${limit} pixels on a side, so the photo fits at its own size`);
  expect(limit).toBe(8192);
}

/**
 * The full-size export against the screen preview made from the working
 * image before it: the same picture, so the same brightness and contrast in
 * each half, to within the JPEGs' and the two sizes' differences. A band
 * reduced wrongly, misplaced or left empty moves a half by far more.
 */
async function expectSamePicture(page: Page): Promise<void> {
  const measure = (half: 'top' | 'bottom'): Promise<[ImageStats, ImageStats]> =>
    Promise.all([imageStats(page, { kind: 'preview', index: 0, which: 'screen', half }), imageStats(page, { kind: 'export', index: 0, half })]);
  for (const half of ['top', 'bottom'] as const) {
    const [preview, exported] = await measure(half);
    expect(Math.abs(exported.mean - preview.mean), `${half} half: mean ${exported.mean} against ${preview.mean}`).toBeLessThan(3);
    expect(Math.abs(exported.spread - preview.spread), `${half} half: spread ${exported.spread} against ${preview.spread}`).toBeLessThan(3);
  }
}

async function exportedSize(page: Page): Promise<{ width: number; height: number } | null> {
  const download = page.waitForEvent('download', { timeout: 5 * 60_000 });
  await page.getByRole('button', { name: 'Export' }).click();
  await download;
  return lastExportSize(page);
}

test.describe('a photo larger than the GPU’s textures', () => {
  test.setTimeout(12 * 60_000);

  test('Full loads the largest size the GPU holds, once, says so, and exports at it', async ({ page }) => {
    test.skip(!q2, 'Set LOPSY_DNG_CAMERA_SAMPLES to the folder with Leica-Q2.dng to run this test');
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await open(page, q2 ?? '');
    await waitForReady(page, 150_000);
    await skipUnlessTooLarge(page);
    await waitForPreview(page, 0, 120_000);
    // The working image, the frame binned by a whole factor; nothing is said yet.
    const working = (await engineSizes(page)).document;
    expect(working.width).toBeLessThan(HELD_AT_8192.width);
    expect(working.width / working.height).toBeCloseTo(OWN.width / OWN.height, 2);
    await expect(page.getByTestId('size-note')).toHaveCount(0);

    await page.getByRole('button', { name: 'Full', exact: true }).click();
    await expect(page.getByTestId('loading-badge')).toHaveText('Loading full resolution…', { timeout: 30_000 });
    await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 6 * 60_000 });
    await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
    expect((await engineSizes(page)).document).toEqual(HELD_AT_8192);

    await expect(page.getByTestId('size-note')).toHaveText(NOTE);
    await expect(page.getByTestId('edit-status')).toHaveText(NOTE);

    // Zooming further asks for nothing more: the full size is what this device holds.
    await page.getByRole('group', { name: 'Photo' }).focus();
    await page.keyboard.press('+');
    await expect(page.getByTestId('zoom-readout')).toHaveValue('125%');
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('loading-badge')).toHaveCount(0);
    expect((await engineSizes(page)).document).toEqual(HELD_AT_8192);

    // The harness's own Export: the Edit view's engine, which makes no tiles.
    expect(await exportedSize(page)).toEqual(HELD_AT_8192);
    await expect(page.getByTestId('edit-problem')).toHaveCount(0);
    await expectSamePicture(page);
    // The app's export: at its own size, in tiles.
    const tiled = await rendererExport(page);
    console.log(`Leica Q2 at its own size: ${JSON.stringify(tiled)}`);
    expect(tiled.size).toEqual(OWN);
    expect(tiled.plan?.columns ?? 0).toBeGreaterThanOrEqual(2);

    // Straightened, the turned picture is wider than the GPU's textures: it keeps to the frame, and the crop inside it is the document.
    const angle = page.getByLabel('Angle value', { exact: true });
    await angle.fill('10');
    await angle.press('Enter');
    await expect.poll(async () => (await engineSizes(page)).document.width).toBeLessThan(HELD_AT_8192.width);
    const straightened = (await engineSizes(page)).document;
    // A 3:2 frame turned by 10° keeps about 82 % of each side.
    expect(straightened.width).toBeGreaterThan(HELD_AT_8192.width * 0.8);
    expect(straightened.width).toBeLessThan(HELD_AT_8192.width * 0.84);
    const download = page.waitForEvent('download', { timeout: 5 * 60_000 });
    await page.getByRole('button', { name: 'Export' }).click();
    await download;
    expect(await lastExportSize(page)).toEqual(straightened);
    await expect(page.getByTestId('edit-problem')).toHaveCount(0);
    // In tiles, the straightened crop at the photo's own size: the held one's, larger in proportion.
    const turned = await rendererExport(page);
    console.log(`Leica Q2 straightened at its own size: ${JSON.stringify(turned)}`);
    expect(turned.plan).not.toBeNull();
    expect(Math.abs((turned.size?.width ?? 0) - (straightened.width * OWN.width) / HELD_AT_8192.width)).toBeLessThan(4);
    expect(Math.abs((turned.size?.height ?? 0) - (straightened.height * OWN.height) / HELD_AT_8192.height)).toBeLessThan(4);
    expect(pageErrors).toEqual([]);
  });

  test('on a GPU without float targets the baked decode opens it at the largest size the GPU holds', async ({ page }) => {
    test.skip(!q2, 'Set LOPSY_DNG_CAMERA_SAMPLES to the folder with Leica-Q2.dng to run this test');
    await open(page, q2 ?? '', '?develop=no-float');
    await waitForReady(page, 240_000);
    await skipUnlessTooLarge(page);
    await waitForPreview(page, 0, 120_000);
    expect((await engineSizes(page)).document).toEqual(HELD_AT_8192);
    await expect(page.getByTestId('size-note')).toHaveText(NOTE_NO_TILES);
    await expect(page.getByTestId('edit-status')).toContainText(NOTE_NO_TILES);
    expect(await exportedSize(page)).toEqual(HELD_AT_8192);
    await expectSamePicture(page);
    // Without float targets the export renderer makes no tiles either.
    const reduced = await rendererExport(page);
    expect(reduced.size).toEqual(HELD_AT_8192);
    expect(reduced.plan).toBeNull();
  });

  for (const type of ['image/jpeg', 'image/png'] as const) {
    test(`a ${type.slice(6).toUpperCase()} wider than the GPU's textures loads at the largest size it can edit`, async ({ page }) => {
      await openHarness(page);
      await openGeneratedImage(page, 8400, 600, type);
      await waitForReady(page);
      await skipUnlessTooLarge(page, 8400);
      await page.getByRole('button', { name: 'Full', exact: true }).click();
      await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 2 * 60_000 });
      // 600 · 8190 / 8400 = 585.
      const held = { width: 8190, height: 585 };
      await expect.poll(async () => (await engineSizes(page)).document).toEqual(held);
      const note =
        'This photo is 8400 × 600 pixels, larger than this device’s graphics can edit (8190 on a side), so it is shown at 8190 × 585. ' +
        'It is exported at its full size, a part at a time.';
      await expect(page.getByTestId('size-note')).toHaveText(note);
      await expect(page.getByTestId('edit-status')).toHaveText(note);
      const download = page.waitForEvent('download', { timeout: 2 * 60_000 });
      await page.getByRole('button', { name: 'Export' }).click();
      await download;
      expect(await lastExportSize(page)).toEqual(held);
      // The generated picture: the middle half grey (#707070), the sides a gradient.
      const centre = await imageStats(page, { kind: 'export', index: 0, half: 'centre' });
      expect(Math.abs(centre.mean - 0x70)).toBeLessThan(4);
      // The browser decodes a picture wider than the GPU's textures, and each tile is drawn from that decode.
      const tiled = await rendererExport(page);
      expect(tiled.size).toEqual({ width: 8400, height: 600 });
      expect(tiled.plan?.columns).toBe(2);
    });
  }

  test('the Export dialog says a photo larger than the GPU is exported a part at a time, and the library export makes it at its own size', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /This browser/ }).click();
    await expect(page.getByText('Your library is empty')).toBeVisible();
    await importFiles(page, [{ name: 'wide.jpg', buffer: await generatedJpeg(page, 200, 8400, 600) }]);
    await page.getByRole('button', { name: /^All photos/ }).click();
    await page.locator('[role="gridcell"][title="wide.jpg"]').click();
    await page.getByRole('button', { name: /^Export 1/ }).click();
    const limit = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0;
    });
    test.skip(limit - 2 >= 8400, `this GPU holds ${limit} pixels on a side, so the photo fits at its own size`);

    const note = page.getByTestId('export-device-size');
    await expect(note).toHaveText(
      'This photo is 8400 × 600 pixels, more than this device’s graphics can edit at once (8190 on a side). It is exported at its full size, a part at a time.',
    );
    // Said with the Size field, where it applies; a size the device holds says nothing.
    const size = page.getByRole('combobox', { name: 'Size' });
    await expect(size).toHaveAttribute('aria-describedby', (await note.getAttribute('id')) ?? 'missing');
    await size.selectOption('long');
    await page.getByRole('spinbutton', { name: 'Pixels' }).fill('4000');
    await expect(note).toHaveCount(0);
    await size.selectOption('original');
    await expect(note).toBeVisible();

    await page.getByRole('radio', { name: 'Download to this computer' }).check();
    const download = page.waitForEvent('download', { timeout: 3 * 60_000 });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await download;
    const bytes = await readFile(await file.path());
    await file.delete();
    expect(jpegSize(Uint8Array.from(bytes))).toEqual({ width: 8400, height: 600 });
    await expect(page.getByText('Exported 1 photo.')).toBeVisible();
  });

  test('a library export of the Q2 is made at its own size, in tiles', async ({ page }) => {
    test.skip(!q2, 'Set LOPSY_DNG_CAMERA_SAMPLES to the folder with Leica-Q2.dng to run this test');
    await page.goto('/');
    await page.getByRole('button', { name: /This browser/ }).click();
    await expect(page.getByText('Your library is empty')).toBeVisible();
    await page.getByRole('button', { name: /Import photos/ }).first().click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Choose photos/ }).click();
    await (await chooser).setFiles(q2 ?? '');
    await page.getByRole('button', { name: 'Import 1 photo' }).click();
    await expect(toast(page, 'Imported 1 photo')).toBeVisible({ timeout: 150_000 });
    await expect(importStrip(page)).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Library' }).getByRole('button', { name: /^All photos/ }).click();
    await page.locator('[role="gridcell"][title="Leica-Q2.dng"]').click();
    await page.getByRole('button', { name: /^Export 1/ }).click();
    await expect(page.getByTestId('export-device-size')).toContainText('It is exported at its full size, a part at a time.');

    await page.getByRole('radio', { name: 'Download to this computer' }).check();
    const download = page.waitForEvent('download', { timeout: 6 * 60_000 });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const file = await download;
    const bytes = await readFile(await file.path());
    await file.delete();
    expect(jpegSize(Uint8Array.from(bytes))).toEqual(OWN);
    await expect(page.getByText('Exported 1 photo.')).toBeVisible();
  });
});
