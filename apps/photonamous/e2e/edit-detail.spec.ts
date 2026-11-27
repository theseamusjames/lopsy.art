import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from './test';
import { waitForReady } from './harness';
import { isHardwareGpu } from './gpu-args';

/**
 * The Edit view's detail at 100 % (src/engine/detail-view.ts, plan section
 * 10): a photo larger than the GPU can edit is shown from the held image,
 * and once the view magnifies it, the part on screen from the photo's own
 * pixels, as one tile on the screen engine. A development build's
 * `?texture-limit=N` makes an ordinary photo too large: the same photo,
 * edit and view (100 % of its own size, the same pan) are shown once with
 * it (the detail) and once without (the photo fits: the whole render), and
 * the canvases compared. On the machine's GPU they are the same pixels
 * (but for Straighten); on SwiftShader they differ by its rounding (see
 * export-tiles.spec.ts), with no seam.
 *
 * The RAW case reads a real camera file from LOPSY_RAF_SAMPLES and is
 * skipped without it.
 */

declare global {
  interface Window {
    __photonamousDetail?: {
      requests: number;
      loads: number;
      shown: { kept: Rect; rect: Rect } | null;
      loadMs: number | null;
      switchInMs: number | null;
      switchOutMs: number | null;
    };
    __photonamousScreenEngine?: {
      setView: (ownZoom: number, panX: number, panY: number) => void;
      sampleAt: (x: number, y: number) => Promise<readonly number[] | null>;
      readHistogram: () => Promise<number[] | null>;
      documentSize: () => { width: number; height: number };
      isSettled: () => boolean;
    };
    __photosHarnessStep?: (recipe: unknown) => void;
    __photosHarness?: { recipe: unknown; previews: unknown[]; exports: { blob: Blob }[] };
  }
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type RecipePatch = Record<string, unknown>;

/** A picture with hard edges, fine texture and text, for every stage to work on. */
async function picture(page: Page, width: number, height: number): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ width, height }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#1b2a3f');
      g.addColorStop(0.5, '#8a6a4a');
      g.addColorStop(1, '#e8e0c8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      let seed = 4242;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `hsl(${Math.floor(random() * 360)} ${40 + Math.floor(random() * 50)}% ${15 + Math.floor(random() * 70)}%)`;
        ctx.fillRect(random() * width, random() * height, 4 + random() * width * 0.05, 4 + random() * height * 0.05);
      }
      ctx.font = `${Math.round(height / 30)}px sans-serif`;
      ctx.fillStyle = '#101010';
      for (let y = 0; y < height; y += height / 12) ctx.fillText('Photonamous detail 0123456789 ABCDEFGHIJ', width * 0.03, y + height / 20);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { width, height },
  );
  return Buffer.from(bytes);
}

/** Opens `file` in the Edit harness at a fixed window, the size note hidden so both pages lay out the same. */
async function open(page: Page, file: { name: string; mimeType: string; buffer: Buffer } | string, query: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/edit-harness.html${query}`);
  await page.addStyleTag({ content: '[data-testid="size-note"] { display: none !important; }' });
  await expect(page.getByTestId('harness-file')).toBeAttached();
  await page.getByTestId('harness-file').setInputFiles(file);
  await waitForReady(page, 240_000);
}

/** The open version's recipe changed by `patch`, as one step. */
async function edit(page: Page, patch: RecipePatch): Promise<void> {
  await page.evaluate((patch) => {
    const merge = (a: unknown, b: unknown): unknown => {
      if (typeof a !== 'object' || a === null || Array.isArray(a) || typeof b !== 'object' || b === null || Array.isArray(b)) return b;
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    };
    const base = window.__photosHarness?.recipe;
    const recipe = merge(base, patch) as Record<string, unknown>;
    const areas = (recipe.areas ?? {}) as Record<string, Record<string, unknown>>;
    for (const area of Object.values(areas)) area.effects = merge({ ...(base as Record<string, unknown>), areas: {} }, area.effects ?? {});
    window.__photosHarnessStep?.(recipe);
  }, patch);
  // The Edit view hands the step to the engine on its next render, and a new crop refits the view.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(300);
}

async function setView(page: Page, ownZoom: number, panX: number, panY: number): Promise<void> {
  await page.evaluate(({ ownZoom, panX, panY }) => window.__photonamousScreenEngine?.setView(ownZoom, panX, panY), { ownZoom, panX, panY });
}

/**
 * The view, set once the full size is in: zooming in loads it, and its
 * arrival keeps the zoom but centres the view again, whenever it lands.
 */
async function setViewWhenFull(page: Page, ownZoom: number, panX: number, panY: number): Promise<void> {
  await setView(page, ownZoom, panX, panY);
  await page.waitForFunction(() => window.__photonamousScreenEngine?.isSettled(), undefined, { timeout: 240_000 });
  await setView(page, ownZoom, panX, panY);
}

async function detail(page: Page): Promise<NonNullable<Window['__photonamousDetail']>> {
  return page.evaluate(() => window.__photonamousDetail ?? { requests: 0, loads: 0, shown: null, loadMs: null, switchInMs: null, switchOutMs: null });
}

/** Waits for the screen to settle: no load badge, and with `isDetail` a detail shown; then two frames. */
async function settled(page: Page, isDetail: boolean): Promise<void> {
  // The full size in (the engine's word: a badge shows a render later than the load starts), then the detail.
  await page.waitForFunction(() => window.__photonamousScreenEngine?.isSettled(), undefined, { timeout: 240_000 });
  await expect(page.getByTestId('loading-badge')).toHaveCount(0, { timeout: 240_000 });
  if (isDetail) await page.waitForFunction(() => window.__photonamousDetail?.shown != null, undefined, { timeout: 240_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(300);
}

interface Decoded {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

/** A screenshot's pixels (8-bit RGBA PNG, as Playwright writes it). */
function decodePng(bytes: Buffer): Decoded {
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const colorType = bytes[25] ?? 6;
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride);
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= bpp ? (row[x - bpp] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      let value = v;
      if (filter === 1) value = v + a;
      else if (filter === 2) value = v + b;
      else if (filter === 3) value = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      row[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) for (let ch = 0; ch < 4; ch++) out[(y * width + x) * 4 + ch] = ch < bpp ? (row[x * bpp + ch] ?? 0) : 255;
    prev = row;
  }
  return { width, height, data: out };
}

/** The canvas as the page shows it. */
async function canvasShot(page: Page, saveAs?: string): Promise<Decoded> {
  const png = await page.getByTestId('edit-view').locator('canvas').first().screenshot({ animations: 'disabled' });
  if (saveAs && process.env.DETAIL_SAVE) writeFileSync(join(process.env.DETAIL_SAVE, `${saveAs}.png`), png);
  return decodePng(png);
}

interface Difference {
  readonly count: number;
  readonly max: number;
  readonly mean: number;
}

function difference(a: Decoded, b: Decoded): Difference {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let count = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (i % 4 === 3) continue;
    const d = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
    sum += d;
    if (d === 0) continue;
    count++;
    max = Math.max(max, d);
  }
  return { count, max, mean: sum / ((a.data.length / 4) * 3) };
}

/**
 * The canvas for `patch` at the view, with the override (`limit`) and
 * without. The tile is no larger than the held image (the tile budget), so
 * the photo and limit leave room for the view's part and its apron.
 */
async function compareDetail(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer } | string,
  limit: number,
  patch: RecipePatch,
  view: { zoom: number; panX: number; panY: number },
): Promise<{ whole: Decoded; tiled: Decoded; record: NonNullable<Window['__photonamousDetail']> }> {
  await open(page, file, '');
  await edit(page, patch);
  await setViewWhenFull(page, view.zoom, view.panX, view.panY);
  await settled(page, false);
  const whole = await canvasShot(page, `${limit}-whole`);
  expect((await detail(page)).requests, 'a photo that fits asks for no detail').toBe(0);
  await open(page, file, `?texture-limit=${limit}`);
  await edit(page, patch);
  await setViewWhenFull(page, view.zoom, view.panX, view.panY);
  await settled(page, true);
  const tiled = await canvasShot(page, `${limit}-tiled`);
  const record = await detail(page);
  console.log(`detail: ${JSON.stringify(record)}`);
  return { whole, tiled, record };
}

/** The difference SwiftShader's rounding makes (export-tiles.spec.ts), 8-bit; the machine's GPU must make none. */
function expectNearlyWhole(name: string, d: Difference, limits = { max: 8, mean: 0.05 }): void {
  console.log(`${name}: ${JSON.stringify(d)}`);
  if (isHardwareGpu && limits.max <= 8) expect.soft(d.count, `${name}: on the machine's GPU the detail is the whole render's pixels`).toBe(0);
  expect.soft(d.max, `${name}: the largest difference`).toBeLessThanOrEqual(limits.max);
  expect.soft(d.mean, `${name}: the mean difference`).toBeLessThan(limits.mean);
}

const EVERYTHING: RecipePatch = {
  tone: { exposure: 0.3, contrast: 20, highlights: -30, shadows: 25, whites: 10, blacks: -5 },
  color: { vibrance: 15, saturation: 5 },
  localContrast: { large: 40, small: 30, haze: 25 },
  sharpness: { amount: 60, radius: 1.5, edges: 20 },
  noise: { luminance: 40, color: 30, detail: 50 },
  finish: { vignette: 30, vignetteSize: 50, vignetteRoundness: 10, vignetteFeather: 50, grain: { amount: 25, size: 25, roughness: 50 } },
  framing: { crop: { x: 0.05, y: 0.04, width: 0.9, height: 0.92 } },
  areas: {
    'area-a': {
      id: 'area-a',
      kind: 'radial',
      invert: false,
      amount: 100,
      name: 'Radial',
      geometry: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.15, angle: 20, feather: 50 },
      adjustments: { exposure: 0.4, contrast: 10, highlights: 0, shadows: 15, temperature: 10, tint: 0, saturation: 10, localContrast: 0 },
      effects: { sharpness: { amount: 40, radius: 1, edges: 0 }, noise: { luminance: 30, color: 0, detail: 50 } },
    },
  },
};
const TURNED_QUARTER: RecipePatch = {
  noise: { luminance: 30, color: 20, detail: 50 },
  sharpness: { amount: 50, radius: 1, edges: 0 },
  framing: { rotate: 90, flipH: true, crop: { x: 0.03, y: 0.05, width: 0.9, height: 0.88 } },
};
const STRAIGHTENED: RecipePatch = { sharpness: { amount: 50, radius: 1, edges: 0 }, framing: { angle: 7 } };
const VIEW = { zoom: 1, panX: 140, panY: -90 };

test.describe('the detail at 100 %', () => {
  test.setTimeout(15 * 60_000);

  test('every stage at once, with a crop and an area: the detail is the whole render', async ({ page }) => {
    // Every stage's apron is 466 pixels: the held image (the tile budget) must be large enough for the view and it.
    const file = { name: 'detail.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 4000, 2600) };
    const { whole, tiled, record } = await compareDetail(page, file, 3072, EVERYTHING, VIEW);
    expect(record.shown).not.toBeNull();
    expectNearlyWhole('every stage', difference(whole, tiled));
  });

  test('Rotate and Flip', async ({ page }) => {
    const file = { name: 'turned.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 2600, 1700) };
    const { whole, tiled } = await compareDetail(page, file, 2048, TURNED_QUARTER, VIEW);
    expectNearlyWhole('Rotate and Flip', difference(whole, tiled));
  });

  test('Straighten, held to the export’s tolerance', async ({ page }) => {
    const file = { name: 'straight.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 2600, 1700) };
    const { whole, tiled } = await compareDetail(page, file, 2048, STRAIGHTENED, VIEW);
    expectNearlyWhole('Straighten', difference(whole, tiled), { max: 16, mean: 0.2 });
  });

  test('a RAW file', async ({ page }) => {
    const dir = process.env.LOPSY_RAF_SAMPLES;
    const path = dir ? join(dir, 'DSCF8078.RAF') : '';
    test.skip(!dir || !existsSync(path), 'Set LOPSY_RAF_SAMPLES to the sample-raf-images folder to run this test');
    const { whole, tiled, record } = await compareDetail(page, path, 4096, { framing: { crop: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } } }, VIEW);
    expect(record.shown).not.toBeNull();
    expectNearlyWhole('RAW', difference(whole, tiled));
  });
});

test.describe('the detail follows the view and the edit', () => {
  test.setTimeout(10 * 60_000);

  test('reads the whole photo, pans inside the tile without a load, and loads anew outside it', async ({ page }) => {
    const file = { name: 'detail.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 3000, 2000) };
    await open(page, file, '?texture-limit=2048');
    await setView(page, 0.5, 0, 0);
    await settled(page, false);
    const histogram = await page.evaluate(() => window.__photonamousScreenEngine?.readHistogram());
    await setView(page, 1, 0, 0);
    await settled(page, true);
    expect(await page.evaluate(() => window.__photonamousScreenEngine?.readHistogram()), 'the histogram is the whole photo’s').toEqual(histogram);
    // After the read the detail is back.
    await settled(page, true);
    const first = await detail(page);
    expect(first.loads).toBe(1);
    // The readout: the photo's own pixel under the point, read from the tile.
    const held = await page.evaluate(() => window.__photonamousScreenEngine?.documentSize());
    const centre = await page.evaluate(({ x, y }) => window.__photonamousScreenEngine?.sampleAt(x, y), { x: (held?.width ?? 0) / 2, y: (held?.height ?? 0) / 2 });
    expect(centre).not.toBeNull();

    await setView(page, 1, 40, -30);
    await page.waitForTimeout(600);
    expect((await detail(page)).loads, 'a pan inside the kept part loads nothing').toBe(1);
    expect((await detail(page)).shown).not.toBeNull();

    await setView(page, 1, 1200, 0);
    expect((await detail(page)).shown, 'a pan outside it shows the held image at once').toBeNull();
    await settled(page, true);
    expect((await detail(page)).loads).toBe(2);
  });

  test('an edit renders the detail; one that reaches past its apron loads a wider tile', async ({ page }) => {
    const file = { name: 'detail.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 3000, 2000) };
    await open(page, file, '?texture-limit=2048');
    await setView(page, 1, 0, 0);
    await settled(page, true);
    const before = await canvasShot(page);
    await edit(page, { tone: { exposure: 0.8 } });
    await settled(page, true);
    expect((await detail(page)).loads, 'a tone edit keeps the tile').toBe(1);
    expect(difference(before, await canvasShot(page)).mean).toBeGreaterThan(1);
    // Shown, not set aside for a moment by a read of the held document (the edit's previews).
    await page.waitForFunction(() => window.__photonamousDetail?.shown != null);
    const narrow = (await detail(page)).shown;
    await edit(page, { localContrast: { large: 40, small: 30, haze: 0 } });
    // The details reach past the tile's apron: a wider tile (on a fast GPU it is there before this looks).
    await settled(page, true);
    await page.waitForFunction(() => window.__photonamousDetail?.shown != null);
    const wide = await detail(page);
    expect(wide.loads).toBe(2);
    expect(wide.shown?.rect.width ?? 0).toBeGreaterThan(narrow?.rect.width ?? Infinity);
  });

  test('crop editing and an export are made on the held image, and the detail comes back', async ({ page }) => {
    const file = { name: 'detail.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 3000, 2000) };
    await open(page, file, '?texture-limit=2048');
    await setView(page, 1, 0, 0);
    await settled(page, true);
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Export' }).click();
    await download;
    const size = await page.evaluate(async () => {
      const blob = window.__photosHarness?.exports.at(-1)?.blob;
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      return { width: bitmap.width, height: bitmap.height };
    });
    // The Edit view's own export is the held image's, as before.
    expect(size).toEqual({ width: 2046, height: 1364 });
    await settled(page, true);
    await page.getByRole('button', { name: 'Crop', exact: true }).click();
    await expect.poll(async () => (await detail(page)).shown).toBeNull();
    await page.keyboard.press('Escape');
    await setView(page, 1, 0, 0);
    await settled(page, true);
  });

  test('a photo that fits never asks for a detail', async ({ page }) => {
    const file = { name: 'fits.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 3000, 2000) };
    await open(page, file, '');
    await setView(page, 2, 100, 50);
    await settled(page, false);
    await setView(page, 1, -300, 0);
    await settled(page, false);
    expect(await detail(page)).toMatchObject({ requests: 0, loads: 0, shown: null });
  });
});
