import { expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    /** Recorded by src/edit/EditHarness/EditHarness.tsx. */
    __photosHarness?: {
      readonly previews: { readonly recipeHash: string; readonly thumb: Blob; readonly screen: Blob }[];
      readonly exports: { readonly blob: Blob; readonly fileName: string }[];
      readonly steps: string[];
      readonly lopsyPngs: ArrayBuffer[];
    };
  }
}

/** Statistics of an encoded image, decoded in the page by the browser. */
export interface ImageStats {
  readonly width: number;
  readonly height: number;
  /** Mean of R, G and B over every pixel, 0..255. */
  readonly mean: number;
  /** Per-channel means, 0..255. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  /** Standard deviation of the per-pixel luminance. */
  readonly spread: number;
  readonly type: string;
  /** First bytes, to check the file signature. */
  readonly head: number[];
}

export async function openHarness(page: Page): Promise<void> {
  await page.goto('/edit-harness.html');
  await expect(page.getByTestId('harness-file')).toBeAttached();
}

/** Draws a test image with OffscreenCanvas in the page and opens it in the harness as a JPEG (or PNG, WebP). */
export async function openGeneratedImage(
  page: Page,
  width = 640,
  height = 480,
  type: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg',
  colors: readonly [string, string, string] = ['#203040', '#c08060', '#707070'],
): Promise<void> {
  await page.evaluate(
    async ({ width, height, type, colors }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(1, colors[1]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = colors[2];
      ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
      const blob = await canvas.convertToBlob({ type, quality: 0.9 });
      const name = `generated.${type === 'image/jpeg' ? 'jpg' : type.slice(6)}`;
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], name, { type }));
      const input = document.querySelector<HTMLInputElement>('[data-testid="harness-file"]');
      if (!input) throw new Error('no file input');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { width, height, type, colors },
  );
}

/** Several generated JPEGs at once, for the filmstrip: each a different colour. */
export async function openGeneratedImages(page: Page, colors: readonly string[]): Promise<void> {
  await page.evaluate(async (list) => {
    const transfer = new DataTransfer();
    for (const [i, color] of list.entries()) {
      const canvas = new OffscreenCanvas(320, 240);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#808080';
      ctx.fillRect(80, 60, 160, 120);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      transfer.items.add(new File([blob], `photo-${i + 1}.jpg`, { type: 'image/jpeg' }));
    }
    const input = document.querySelector<HTMLInputElement>('[data-testid="harness-file"]');
    if (!input) throw new Error('no file input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, colors);
}

/** A JPEG whose top half is red and bottom half blue, to tell a vertical flip. */
export async function openTopBottomImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(400, 300);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#c03030';
    ctx.fillRect(0, 0, 400, 150);
    ctx.fillStyle = '#3040c0';
    ctx.fillRect(0, 150, 400, 150);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'top-bottom.jpg', { type: 'image/jpeg' }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="harness-file"]');
    if (!input) throw new Error('no file input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** A flat grey JPEG, so any change in one part of it shows. */
export async function openFlatImage(page: Page, color = '#808080'): Promise<void> {
  await page.evaluate(async (fill) => {
    const canvas = new OffscreenCanvas(480, 360);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 480, 360);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'flat.jpg', { type: 'image/jpeg' }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="harness-file"]');
    if (!input) throw new Error('no file input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
}

export async function waitForReady(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId('edit-view')).toHaveAttribute('data-status', 'ready', { timeout });
}

export async function previewCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__photosHarness?.previews.length ?? 0);
}

/** Waits for a preview rendered after `count` previews, and returns its recipe hash. */
export async function waitForPreview(page: Page, count: number, timeout = 60_000): Promise<string> {
  await page.waitForFunction((n) => (window.__photosHarness?.previews.length ?? 0) > n, count, { timeout });
  return page.evaluate((n) => window.__photosHarness?.previews[n]?.recipeHash ?? '', count);
}

/**
 * After edits made in quick succession: waits for a preview past `count`,
 * then for the edit to settle, and answers the index of the last preview.
 */
export async function settledPreview(page: Page, count: number): Promise<number> {
  await waitForPreview(page, count);
  await page.waitForTimeout(2500);
  return (await previewCount(page)) - 1;
}

type BlobSource = (
 { readonly kind: 'preview'; readonly index: number; readonly which: 'thumb' | 'screen' } | { readonly kind: 'export'; readonly index: number }) & {
  /** Measure only the top or bottom half, or the middle tenth of the image. */
  readonly half?: 'top' | 'bottom' | 'centre';
};

/** Decodes a recorded preview or export in the page and measures it. */
export async function imageStats(page: Page, source: BlobSource): Promise<ImageStats> {
  return page.evaluate(async (src) => {
    const record = window.__photosHarness;
    if (!record) throw new Error('no harness');
    const blob = src.kind === 'preview' ? record.previews[src.index]?.[src.which] : record.exports[src.index]?.blob;
    if (!blob) throw new Error(`no ${src.kind} ${src.index}`);
    const head = Array.from(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const half = Math.floor(bitmap.height / 2);
    const isCentre = src.half === 'centre';
    const cw = Math.max(1, Math.floor(bitmap.width / 10));
    const ch = Math.max(1, Math.floor(bitmap.height / 10));
    const data = isCentre
      ? ctx.getImageData(Math.floor((bitmap.width - cw) / 2), Math.floor((bitmap.height - ch) / 2), cw, ch).data
      : ctx.getImageData(0, src.half === 'bottom' ? bitmap.height - half : 0, bitmap.width, src.half ? half : bitmap.height).data;
    let sum = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let lumaSum = 0;
    let lumaSq = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      sum += r + g + b;
      red += r;
      green += g;
      blue += b;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaSum += y;
      lumaSq += y * y;
    }
    const lumaMean = lumaSum / pixels;
    return {
      width: bitmap.width,
      height: bitmap.height,
      mean: sum / (pixels * 3),
      red: red / pixels,
      green: green / pixels,
      blue: blue / pixels,
      spread: Math.sqrt(Math.max(0, lumaSq / pixels - lumaMean * lumaMean)),
      type: blob.type,
      head,
    };
  }, source);
}

/** Raises Exposure from the keyboard by `tenths` tenths of a stop, as one held key (one history step). */
export async function raiseExposure(page: Page, tenths: number): Promise<void> {
  await page.getByRole('slider', { name: 'Exposure' }).focus();
  // Each press steps 0.01; a held key repeats.
  for (let i = 0; i < tenths * 10; i++) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
}

/** A JPEG's size from its frame header, without decoding it. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let p = 2;
  while (p + 9 < bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1] ?? 0;
    const length = ((bytes[p + 2] ?? 0) << 8) | (bytes[p + 3] ?? 0);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: ((bytes[p + 5] ?? 0) << 8) | (bytes[p + 6] ?? 0), width: ((bytes[p + 7] ?? 0) << 8) | (bytes[p + 8] ?? 0) };
    }
    p += 2 + length;
  }
  return null;
}

/** The size of the harness's last export (a JPEG), read from its header. */
export async function lastExportSize(page: Page): Promise<{ width: number; height: number } | null> {
  const head = await page.evaluate(async () => {
    const blob = window.__photosHarness?.exports.at(-1)?.blob;
    return blob ? Array.from(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer())) : [];
  });
  return jpegSize(Uint8Array.from(head));
}

/** The harness's history steps so far. */
export async function harnessSteps(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__photosHarness?.steps ?? [])]);
}

/**
 * Asks for the full resolution (Full), as zooming to 50 % or closer does,
 * and waits for it: the working image came first, and the full-size
 * decode replaces it.
 */
export async function loadFullResolution(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(page.getByTestId('loading-badge')).toHaveText('Loading full resolution…', { timeout: 30_000 });
  await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 5 * 60_000 });
  await expect(page.getByTestId('zoom-readout')).toHaveValue('100%');
}

/** The Temperature readout in Kelvin, as a number; NaN when it does not read in Kelvin. */
export async function temperatureKelvin(page: Page): Promise<number> {
  const text = await page.getByLabel('Temperature value').inputValue();
  return /^\d+ K$/.test(text) ? Number(text.replace(' K', '')) : Number.NaN;
}
