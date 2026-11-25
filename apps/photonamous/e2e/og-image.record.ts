/**
 * Makes the social preview image, public/og-image.jpg: a RAW photo opened
 * in a library in this browser, edited with the settings in
 * og-image-edit.json, shown in the Edit view's split before and after with
 * the divider half way, captured from the full-size image and scaled to
 * 1200 × 630. Everything in the picture is the app: the photograph on both
 * sides, the divider, its knob and the Before and After labels. See
 * og-image.config.ts for how to run it.
 *
 * OG_EDITS: a JSON file of other edits to compare in the same run
 * ([{ name, changes }], changes as og-image-edit.json has them, each made
 * on top of the one before); they go to OG_OUT, not public/.
 * OG_OUT (default test-results/og-image) also gets each image at 500 and
 * 300 px wide, the sizes a card is often shown at, to judge it there.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForReady } from './harness';
import { importStrip, tiles } from './library';

const here = dirname(fileURLToPath(import.meta.url));
const raw = process.env.OG_RAW ?? '';
const outDir = process.env.OG_OUT ?? join(here, '../test-results/og-image');
const publicImage = join(here, '../public/og-image.jpg');

/** Recipe paths and their values, as LibrarySession.editRecipe takes them: a crop is an object, a curve its points. */
type Changes = Record<string, number | string | boolean | null | { readonly [key: string]: number } | readonly { readonly x: number; readonly y: number }[]>;
interface Edit {
  readonly name: string;
  readonly changes: Changes;
}

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
/**
 * The photograph's width on the page, in CSS pixels. The split view's
 * divider, knob and labels are sized in CSS pixels, so this sets how large
 * they come out on the card: at 400 the labels are about 30 px tall at
 * 1200 px wide, still readable on a card 500 px wide. With the config's six
 * device pixels to the CSS pixel the capture is 2400 px wide, twice the
 * card's size.
 */
const PHOTO_CSS_WIDTH = 400;

async function editRecipe(page: Page, edit: Edit): Promise<void> {
  await page.evaluate(
    async ({ changes, label }) => {
      const { useUi } = await import('/src/app/store.ts');
      const { connection, editing } = useUi.getState();
      if (!connection || !editing) throw new Error('No photo is open in the Edit view');
      connection.session.editRecipe(editing.versionId, changes, label);
    },
    { changes: edit.changes, label: edit.name },
  );
}

/** The engine's render counts (src/engine/render-counts.ts, on the window in a development build). */
async function renderCounts(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify((window as unknown as { __lopsyRenderCounts?: unknown }).__lopsyRenderCounts ?? null));
}

/** Makes an edit and waits for the Edit view to render it and then to rest: a full-size render takes seconds. */
async function editAndSettle(page: Page, edit: Edit): Promise<void> {
  const before = await renderCounts(page);
  await editRecipe(page, edit);
  await expect.poll(() => renderCounts(page), { timeout: 120_000 }).not.toBe(before);
  let last = await renderCounts(page);
  let since = Date.now();
  while (Date.now() - since < 3000) {
    await page.waitForTimeout(250);
    const now = await renderCounts(page);
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
}

/** Where the photograph is on the page, as the split view lays its divider over it. */
async function photoBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.getByTestId('split-divider').evaluate((el: HTMLElement) => {
    const stage = el.parentElement?.getBoundingClientRect() ?? new DOMRect();
    const px = (name: string) => parseFloat(el.style.getPropertyValue(name)) || 0;
    return { x: stage.left + px('--split-left'), y: stage.top + px('--split-top'), width: px('--split-width'), height: px('--split-height') };
  });
}

/** Captures the photograph until two captures a few seconds apart are the same: the edit and the before have both settled. */
async function settledCapture(page: Page): Promise<Buffer> {
  let last: Buffer | null = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('split-before')).toBeVisible();
    await expect(page.getByTestId('loading-badge')).toHaveCount(0);
    const shot = await page.screenshot({ clip: await photoBox(page), animations: 'disabled', caret: 'hide' });
    if (last && shot.equals(last)) return shot;
    last = shot;
  }
  throw new Error('The Edit view did not settle');
}

/** Scales the capture to `width` at the card's shape with the browser's high-quality resize, and encodes it. */
async function scaled(page: Page, png: Buffer, width: number, type: 'image/jpeg' | 'image/png'): Promise<Buffer> {
  const height = Math.round((width * OG_HEIGHT) / OG_WIDTH);
  const base64 = await page.evaluate(
    async ({ data, width, height, type }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const source = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const bitmap = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type, quality: 0.92 });
      const out = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(text);
    },
    { data: png.toString('base64'), width, height, type },
  );
  return Buffer.from(base64, 'base64');
}

test('social preview image', async ({ page }) => {
  test.skip(!existsSync(raw), 'Set OG_RAW to the RAW file the image is made from');
  mkdirSync(outDir, { recursive: true });
  page.on('pageerror', (error) => console.log(`Page error: ${error.message}`));
  const main = JSON.parse(readFileSync(join(here, 'og-image-edit.json'), 'utf8')) as Edit;
  const others = process.env.OG_EDITS ? (JSON.parse(readFileSync(process.env.OG_EDITS, 'utf8')) as Edit[]) : [];

  await page.goto('/');
  await page.getByRole('button', { name: /This browser/ }).click();
  await page.getByRole('button', { name: /Import photos/ }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Choose photos/ }).click();
  await (await chooser).setFiles([raw]);
  await page.getByRole('button', { name: /^Import 1 photo/ }).click();
  await expect(importStrip(page)).toHaveCount(0, { timeout: 10 * 60_000 });
  await page.getByRole('button', { name: /^All photos/ }).click();
  await tiles(page).first().click();
  await page.keyboard.press('Enter');
  await waitForReady(page, 10 * 60_000);
  const edit = page.getByTestId('edit-view');
  await editAndSettle(page, main);

  // The full-size image, not the working one: 100 % loads it, and Fit keeps it.
  await edit.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 15 * 60_000 });
  await edit.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.getByTestId('status-working-size')).toHaveText(/full size$/);
  await edit.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByTestId('split-divider')).toHaveAttribute('aria-valuenow', '50');

  // A smaller window, until the fitted photograph is PHOTO_CSS_WIDTH wide.
  for (let i = 0; i < 8; i++) {
    const box = await photoBox(page);
    if (Math.abs(box.width - PHOTO_CSS_WIDTH) < 0.5) break;
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const k = PHOTO_CSS_WIDTH / box.width;
    await page.setViewportSize({
      width: Math.round(viewport.width - box.width + box.width * k),
      height: Math.round(viewport.height - box.height + box.height * k),
    });
    await page.waitForTimeout(1500);
  }
  expect(Math.abs((await photoBox(page)).width - PHOTO_CSS_WIDTH)).toBeLessThan(0.5);
  // No pointer over the photograph: it would show the pixel readout.
  await page.mouse.move(0, 0);

  for (const [i, each] of [main, ...others].entries()) {
    if (i > 0) await editAndSettle(page, each);
    const capture = await settledCapture(page);
    const jpeg = await scaled(page, capture, OG_WIDTH, 'image/jpeg');
    writeFileSync(i === 0 ? publicImage : join(outDir, `${each.name}.jpg`), jpeg);
    writeFileSync(join(outDir, `${each.name}-500.png`), await scaled(page, capture, 500, 'image/png'));
    writeFileSync(join(outDir, `${each.name}-300.png`), await scaled(page, capture, 300, 'image/png'));
    console.log(`${each.name}: ${jpeg.length} bytes`);
  }
});
