/**
 * Makes the social preview image, public/og-image.jpg: the whole app, the
 * Edit view of the start screen's trailer, with the trailer's hero photo in
 * the split before and after, divider half way. The photo is OG_RAW
 * (DSCF8078.RAF, the drink), opened in a library in this browser; the edit
 * is the trailer's own, demo-reel-edit.json, sent step by step the way the
 * Edit view sends its own (as demo-reel.record.ts does), so the sliders and
 * History show its real values. See og-image.config.ts for how to run it.
 *
 * The window is WINDOW's size in CSS pixels at the config's device scale,
 * captured whole and scaled to 1200 × 630. OG_COMPARE=1 also captures the
 * other compositions tried (COMPOSITIONS) into OG_OUT.
 * OG_OUT (default test-results/og-image) gets every image at 500 and
 * 300 px wide too, the sizes a card is often shown at, to judge it there.
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

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

interface Composition {
  readonly name: string;
  /** The window, in CSS pixels, the card's shape. */
  readonly width: number;
  readonly height: number;
  /** The photo's zoom as a percentage of its full size, or null for Fit. */
  readonly zoom: number | null;
}

/**
 * The one made for public/og-image.jpg: the window at the card's size, so
 * the interface reads at its natural size, and the photo at 10 % (Fit is
 * about 6 % here), so the glass fills the stage and the before and after
 * still read on a card 500 px wide. The stage shows the photo's middle,
 * the divider half way across it; the Before and After labels, at the
 * photo's top corners, are out of view.
 */
const WINDOW: Composition = { name: 'og-image', width: 1200, height: 630, zoom: 10 };
/** The others tried, made with OG_COMPARE=1. */
const COMPOSITIONS: readonly Composition[] = [
  { name: 'window-1200-fit', width: 1200, height: 630, zoom: null },
  { name: 'window-1440-fit', width: 1440, height: 756, zoom: null },
  { name: 'window-1440-zoomed', width: 1440, height: 756, zoom: 12 },
];

interface EditStep extends ReadonlyArray<unknown> {
  readonly 0: string;
  readonly 1: Record<string, unknown>;
}
const EDIT = JSON.parse(readFileSync(join(here, 'demo-reel-edit.json'), 'utf8')) as { photo: string; steps: EditStep[] };

async function applyStep(page: Page, [label, changes]: EditStep): Promise<void> {
  await page.evaluate(
    async ({ label, changes }) => {
      const { useUi } = await import('/src/app/store.ts');
      const { connection, editing } = useUi.getState();
      if (!connection || !editing) throw new Error('No photo is open in the Edit view');
      connection.session.editRecipe(editing.versionId, changes, label);
    },
    { label, changes },
  );
}

/** The engine's render counts (src/engine/render-counts.ts, on the window in a development build). */
async function renderCounts(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify((window as unknown as { __lopsyRenderCounts?: unknown }).__lopsyRenderCounts ?? null));
}

/** Waits until the engine has rendered nothing for three seconds: a full-size render takes seconds. */
async function settle(page: Page): Promise<void> {
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

/** Captures the window until two captures a few seconds apart are the same: the edit and the before have both settled. */
async function settledCapture(page: Page): Promise<Buffer> {
  let last: Buffer | null = null;
  for (let i = 0; i < 20; i++) {
    await settle(page);
    await expect(page.getByTestId('split-before')).toBeVisible();
    await expect(page.getByTestId('loading-badge')).toHaveCount(0);
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
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
      const blob = await canvas.convertToBlob({ type, quality: 0.9 });
      const out = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(text);
    },
    { data: png.toString('base64'), width, height, type },
  );
  return Buffer.from(base64, 'base64');
}

/** Sizes the window, frames the photo and takes away the pointer and focus, so nothing shows that a user did not leave. */
async function compose(page: Page, composition: Composition): Promise<void> {
  await page.setViewportSize({ width: composition.width, height: composition.height });
  const edit = page.getByTestId('edit-view');
  await edit.getByRole('button', { name: 'Fit', exact: true }).click();
  if (composition.zoom !== null) {
    const field = page.getByTestId('zoom-readout');
    await field.fill(`${composition.zoom}%`);
    await field.press('Enter');
    await expect(field).toHaveValue(`${composition.zoom}%`);
  }
  await page.mouse.move(composition.width - 1, composition.height - 1);
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
}

test('social preview image', async ({ page }) => {
  test.skip(!existsSync(raw), 'Set OG_RAW to the trailer’s hero photo, DSCF8078.RAF');
  mkdirSync(outDir, { recursive: true });
  page.on('pageerror', (error) => console.log(`Page error: ${error.message}`));

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

  // The trailer's edit, as it applies it: the crop first, then every other step in the order History recorded them.
  const changesShape = ([, changes]: EditStep): boolean => Object.keys(changes).some((key) => key.startsWith('framing.'));
  for (const step of [...EDIT.steps.filter(changesShape), ...EDIT.steps.filter((step) => !changesShape(step))]) {
    await applyStep(page, step);
    await page.waitForTimeout(120);
  }
  await settle(page);

  // The full-size image, not the working one: 100 % loads it, and Fit keeps it.
  await edit.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 15 * 60_000 });
  await edit.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.getByTestId('status-working-size')).toHaveText(/full size$/);
  await edit.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByTestId('split-divider')).toHaveAttribute('aria-valuenow', '50');

  // Production libraries are in Google Drive, whose header says so; the label for a library in this browser,
  // which only development builds offer, is taken off the picture.
  await page.getByRole('banner').getByText('This browser', { exact: true }).evaluate((el: HTMLElement) => {
    el.style.visibility = 'hidden';
  });

  for (const composition of process.env.OG_COMPARE ? [WINDOW, ...COMPOSITIONS] : [WINDOW]) {
    await compose(page, composition);
    const capture = await settledCapture(page);
    const jpeg = await scaled(page, capture, OG_WIDTH, 'image/jpeg');
    writeFileSync(composition === WINDOW ? publicImage : join(outDir, `${composition.name}.jpg`), jpeg);
    writeFileSync(join(outDir, `${composition.name}-500.png`), await scaled(page, capture, 500, 'image/png'));
    writeFileSync(join(outDir, `${composition.name}-300.png`), await scaled(page, capture, 300, 'image/png'));
    console.log(`${composition.name}: ${jpeg.length} bytes, zoom ${await page.getByTestId('zoom-readout').inputValue()}`);
  }
});
