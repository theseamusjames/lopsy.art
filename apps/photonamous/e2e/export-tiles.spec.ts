import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from './test';
import { waitForReady } from './harness';
import { isHardwareGpu } from './gpu-args';

/**
 * Tiles (plan section 10): a photo larger than the GPU's textures is
 * exported at its own size one rectangle at a time and the rectangles put
 * together. Here the photo is ordinary and the GPU is taken to be smaller
 * than it, with a development build's `?texture-limit=N`
 * (develop-override.ts): the same photo with the same edit is exported
 * whole (no override) and in tiles (the override), through the export
 * renderer, the app's export path (the Edit harness's
 * `__photosHarnessExport`), and the files are compared.
 *
 * The 16-bit PNG, the TIFF and the HDR PNG are encoded from a whole picture
 * the engine assembles from the tiles' reads, and the JPEG and 8-bit PNG
 * from a canvas the tiles are drawn into, each tile's dither seeded by its
 * place in the whole. On a GPU whose interpolation and sampling land each
 * pixel exactly on its texel (Metal, `engine/tests/tiles.rs`) the files
 * are the whole's byte for byte. The suite's software GPU (SwiftShader)
 * does not: a full-screen pass reads its source at an interpolated
 * coordinate, which the rasterizer rounds differently for a tile's
 * viewport than for the whole's, and its sampler then gives the
 * neighbouring texel a weight of 1/256 now and then, in the whole render
 * as in a tile. So each file is compared with the whole's pixel by pixel,
 * held to those leaks (measured: under a quarter of an 8-bit step in 16
 * bits, one step in 8), and the difference along the tiles' edges must be
 * no larger than elsewhere: no seam. A straightened photo's tiles are
 * turned from windows of the framed image, and the affine transform's
 * bilinear read rounds differently again; it is held to a few 8-bit steps.
 *
 * The RAW case reads a real camera file from LOPSY_RAF_SAMPLES and is
 * skipped without it.
 */

declare global {
  interface Window {
    __photosHarnessExport?: (settings: Record<string, unknown>, recipe?: unknown, abort?: { aborted: boolean }) => Promise<Blob>;
    __photosHarnessNotes?: string[];
    __photonamousTiles?: {
      plan: { columns: number; rows: number; apron: number; tiles: readonly { kept: Rect; rect: Rect }[] } | null;
      done: number;
      finished: boolean;
      failAt: number | null;
    };
    __photosHarnessAbort?: { aborted: boolean };
    __photonamousEngine?: { rendererName: () => string };
  }
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Plan = NonNullable<NonNullable<Window['__photonamousTiles']>['plan']>;

/** A picture with something for every stage: gradients, hard edges, fine texture, noise and highlights. */
async function picture(page: Page, width: number, height: number, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ width, height, type }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#1b2a3f');
      g.addColorStop(0.5, '#8a6a4a');
      g.addColorStop(1, '#e8e0c8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      let seed = 12345;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `hsl(${Math.floor(random() * 360)} ${40 + Math.floor(random() * 50)}% ${15 + Math.floor(random() * 70)}%)`;
        const w = 10 + random() * width * 0.08;
        const h = 10 + random() * height * 0.08;
        ctx.fillRect(random() * width, random() * height, w, h);
      }
      ctx.strokeStyle = '#ffffff';
      for (let i = 0; i < 60; i++) {
        ctx.lineWidth = 1 + random() * 3;
        ctx.beginPath();
        ctx.moveTo(random() * width, random() * height);
        ctx.lineTo(random() * width, random() * height);
        ctx.stroke();
      }
      ctx.font = `${Math.round(height / 20)}px sans-serif`;
      ctx.fillStyle = '#101010';
      for (let y = 0; y < height; y += height / 8) ctx.fillText('Photonamous tiles 0123456789', width * 0.05, y + height / 12);
      // Fine noise, a pixel at a time, so neighbourhood stages have texture to work on.
      const noise = ctx.createImageData(width, Math.min(height, 256));
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = Math.floor(random() * 255);
        noise.data[i] = v;
        noise.data[i + 1] = 255 - v;
        noise.data[i + 2] = (v * 7) % 255;
        noise.data[i + 3] = 40;
      }
      const tile = await createImageBitmap(noise);
      for (let y = 0; y < height; y += 256) ctx.drawImage(tile, 0, y);
      const blob = await canvas.convertToBlob({ type, quality: 0.95 });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { width, height, type },
  );
  return Buffer.from(bytes);
}

/** Opens `file` in the Edit harness, with the query (the override) for the page, and waits for it. */
async function open(page: Page, file: { name: string; mimeType: string; buffer: Buffer } | string, query: string): Promise<void> {
  await page.goto(`/edit-harness.html${query}`);
  await expect(page.getByTestId('harness-file')).toBeAttached();
  await page.getByTestId('harness-file').setInputFiles(file);
  await waitForReady(page, 240_000);
}

/** An edit, as changes to the open version's recipe (deep-merged in the page). */
type RecipePatch = Record<string, unknown>;

/** The open photo exported through the export renderer with `settings` and the recipe changed by `patch`. */
async function exportBytes(page: Page, settings: Record<string, unknown>, patch: RecipePatch, abort = false): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ settings, patch, abort }) => {
      const merge = (a: unknown, b: unknown): unknown => {
        if (typeof a !== 'object' || a === null || Array.isArray(a) || typeof b !== 'object' || b === null || Array.isArray(b)) return b;
        const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
        for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
        return out;
      };
      const base = (window as unknown as { __photosHarness?: { recipe: unknown } }).__photosHarness?.recipe;
      // An area's own effects are a whole recipe: the version's, with what the patch gives it.
      const withAreas = merge(base, patch) as Record<string, unknown>;
      const areas = (withAreas.areas ?? {}) as Record<string, Record<string, unknown>>;
      for (const area of Object.values(areas)) area.effects = merge({ ...(base as Record<string, unknown>), areas: {} }, area.effects ?? {});
      const run = window.__photosHarnessExport;
      if (!run) throw new Error('no export hook');
      const signal = { aborted: false };
      window.__photosHarnessAbort = signal;
      const blob = await run(settings, withAreas, abort ? signal : undefined);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { settings, patch, abort },
  );
  return Buffer.from(base64, 'base64');
}

async function lastPlan(page: Page): Promise<Plan> {
  const plan = await page.evaluate(() => window.__photonamousTiles?.plan ?? null);
  if (!plan) throw new Error('no tiled export ran');
  return plan;
}

// ---- reading the files -----------------------------------------------------

interface Decoded {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  /** 8- or 16-bit values, row by row. */
  readonly data: Uint16Array;
}

/** A PNG's pixels (8 or 16 bits, RGB or RGBA), unfiltered here: the test reads files the app wrote. */
function decodePng(bytes: Buffer): Decoded {
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const bytesPer = depth / 8;
  const bpp = channels * bytesPer;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint16Array(width * height * channels);
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
    for (let i = 0; i < width * channels; i++) {
      out[y * width * channels + i] = bytesPer === 2 ? row.readUInt16BE(i * 2) : (row[i] ?? 0);
    }
    prev = row;
  }
  return { width, height, channels, data: out };
}

/** The engine's 16-bit RGBA TIFF (little-endian, Deflate strips, horizontal predictor), unpacked here. */
function decodeTiff(bytes: Buffer): Decoded {
  const ifd = bytes.readUInt32LE(4);
  const count = bytes.readUInt16LE(ifd);
  const tags = new Map<number, { type: number; count: number; value: number }>();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const type = bytes.readUInt16LE(at + 2);
    const n = bytes.readUInt32LE(at + 4);
    tags.set(bytes.readUInt16LE(at), { type, count: n, value: type === 3 && n === 1 ? bytes.readUInt16LE(at + 8) : bytes.readUInt32LE(at + 8) });
  }
  const tag = (id: number) => {
    const t = tags.get(id);
    if (!t) throw new Error(`no TIFF tag ${id}`);
    return t;
  };
  const width = tag(256).value;
  const height = tag(257).value;
  const rowsPerStrip = tag(278).value;
  const list = (id: number): number[] => {
    const t = tag(id);
    if (t.count === 1) return [t.value];
    return Array.from({ length: t.count }, (_, i) => (t.type === 3 ? bytes.readUInt16LE(t.value + i * 2) : bytes.readUInt32LE(t.value + i * 4)));
  };
  const offsets = list(273);
  const lengths = list(279);
  const out = new Uint16Array(width * height * 4);
  offsets.forEach((offset, strip) => {
    const raw = inflateSync(bytes.subarray(offset, offset + (lengths[strip] ?? 0)));
    const rows = Math.min(rowsPerStrip, height - strip * rowsPerStrip);
    for (let r = 0; r < rows; r++) {
      const y = strip * rowsPerStrip + r;
      for (let i = 0; i < width * 4; i++) {
        const v = raw.readUInt16LE((r * width * 4 + i) * 2);
        // Predictor 2: each sample is the difference from the same channel of the pixel to its left.
        out[y * width * 4 + i] = i >= 4 ? (v + (out[y * width * 4 + i - 4] ?? 0)) & 0xffff : v;
      }
    }
  });
  return { width, height, channels: 4, data: out };
}

/** A JPEG's or PNG's 8-bit RGBA pixels, decoded by the browser with no colour conversion. */
async function decodeInPage(page: Page, bytes: Buffer): Promise<Decoded> {
  const values = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data]), { colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let out = '';
    for (let i = 0; i < pixels.length; i += 0x8000) out += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
    return { width: bitmap.width, height: bitmap.height, data: btoa(out) };
  }, bytes.toString('base64'));
  return { width: values.width, height: values.height, channels: 4, data: Uint16Array.from(Buffer.from(values.data, 'base64')) };
}

interface Difference {
  /** Values that differ, of all of R, G and B. */
  readonly count: number;
  readonly max: number;
  readonly mean: number;
  /** The largest difference within 2 pixels of a kept part's edge inside the picture, and elsewhere. */
  readonly seamMax: number;
  readonly elsewhereMax: number;
}

function difference(a: Decoded, b: Decoded, plan: Plan | null): Difference {
  expect([a.width, a.height], 'the two files are the same size').toEqual([b.width, b.height]);
  const edgesX = new Set<number>();
  const edgesY = new Set<number>();
  for (const { kept } of plan?.tiles ?? []) {
    if (kept.x > 0) edgesX.add(kept.x);
    if (kept.y > 0) edgesY.add(kept.y);
  }
  const nearEdge = (v: number, edges: Set<number>) => [...edges].some((e) => Math.abs(v + 0.5 - e) <= 2);
  let count = 0;
  let max = 0;
  let sum = 0;
  let seamMax = 0;
  let elsewhereMax = 0;
  for (let y = 0; y < a.height; y++) {
    const isEdgeRow = nearEdge(y, edgesY);
    for (let x = 0; x < a.width; x++) {
      const isSeam = isEdgeRow || nearEdge(x, edgesX);
      for (let ch = 0; ch < 3; ch++) {
        const i = (y * a.width + x) * a.channels + ch;
        const d = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
        sum += d;
        if (d === 0) continue;
        count++;
        max = Math.max(max, d);
        if (isSeam) seamMax = Math.max(seamMax, d);
        else elsewhereMax = Math.max(elsewhereMax, d);
      }
    }
  }
  return { count, max, mean: sum / (a.width * a.height * 3), seamMax, elsewhereMax };
}

// ---- the edits -------------------------------------------------------------

/** Every neighbourhood stage, the areas (one with layer effects of its own), Finish and a crop. */
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
      geometry: { cx: 0.6, cy: 0.45, rx: 0.25, ry: 0.2, angle: 20, feather: 50 },
      adjustments: { exposure: 0.4, contrast: 10, highlights: 0, shadows: 15, temperature: 10, tint: 0, saturation: 10, localContrast: 0 },
      effects: { sharpness: { amount: 40, radius: 1, edges: 0 }, noise: { luminance: 30, color: 0, detail: 50 } },
    },
    'area-b': {
      id: 'area-b',
      kind: 'linear',
      invert: false,
      amount: 80,
      name: 'Linear',
      geometry: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.6 },
      adjustments: { exposure: -0.3, contrast: 0, highlights: -20, shadows: 0, temperature: -15, tint: 5, saturation: 0, localContrast: 20 },
      effects: {},
    },
  },
};

/** Per pixel and by position only: no apron. */
const PER_PIXEL: RecipePatch = {
  tone: { exposure: 0.2, contrast: 15, highlights: -20, shadows: 20, whites: 0, blacks: 0 },
  color: { vibrance: 10, saturation: 0 },
  finish: { vignette: 40, vignetteSize: 50, vignetteRoundness: 0, vignetteFeather: 50, grain: { amount: 30, size: 25, roughness: 50 } },
  framing: { crop: { x: 0.02, y: 0.03, width: 0.95, height: 0.94 } },
  areas: {
    'area-a': {
      id: 'area-a',
      kind: 'radial',
      invert: true,
      amount: 100,
      name: 'Radial',
      geometry: { cx: 0.4, cy: 0.5, rx: 0.3, ry: 0.25, angle: -15, feather: 60 },
      adjustments: { exposure: -0.5, contrast: 0, highlights: 0, shadows: 0, temperature: 15, tint: 0, saturation: -20, localContrast: 0 },
      effects: {},
    },
  },
};

/** A small neighbourhood (noise reduction and sharpening), with Rotate and Flip. */
const TURNED_QUARTER: RecipePatch = {
  noise: { luminance: 30, color: 20, detail: 50 },
  sharpness: { amount: 50, radius: 1, edges: 0 },
  finish: { vignette: 25, vignetteSize: 50, vignetteRoundness: 0, vignetteFeather: 50, grain: { amount: 0, size: 25, roughness: 50 } },
  framing: { rotate: 90, flipH: true, crop: { x: 0.03, y: 0.05, width: 0.9, height: 0.88 } },
};

const STRAIGHTENED: RecipePatch = {
  noise: { luminance: 30, color: 20, detail: 50 },
  sharpness: { amount: 50, radius: 1, edges: 0 },
  framing: { angle: 7 },
};

const PNG16 = { format: 'png', pngDepth: 16, maxLongEdge: null, metadata: 'none', quality: 1 };
const PNG8 = { format: 'png', pngDepth: 8, maxLongEdge: null, metadata: 'none', quality: 1, colorSpace: 'display-p3' };
const JPEG = { format: 'jpeg', maxLongEdge: null, metadata: 'none', quality: 0.92 };
const TIFF = { format: 'tiff', maxLongEdge: null, metadata: 'none', colorSpace: 'display-p3' };
const HDR_PNG = { format: 'hdr-png', maxLongEdge: null, metadata: 'none' };
const HDR_JPEG = { format: 'hdr-jpeg', maxLongEdge: null, metadata: 'none', quality: 0.9 };

/** The RAW sample, cropped to a part of its frame (so the files stay small enough to hand back), and a limit that makes that a few tiles. */
const RAF_SAMPLE = 'DSCF8078.RAF';
const RAF_LIMIT = 2048;
const RAF_EDIT: RecipePatch = { ...EVERYTHING, framing: { crop: { x: 0.31, y: 0.27, width: 0.42, height: 0.44 } } };

const STRAIGHTENED_SIXTEEN = { max: 1024, mean: 2, seam: 64 };
const STRAIGHTENED_JPEG = { max: 16, mean: 0.2, seam: 2 };

interface Exported {
  readonly whole: Buffer[];
  readonly tiled: Buffer[];
  readonly plan: Plan;
  readonly notes: string[];
}

/** Each of `formats` exported whole and in tiles at `limit`, the same photo and edit. */
async function exportBoth(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer } | string,
  limit: number,
  patch: RecipePatch,
  formats: readonly Record<string, unknown>[],
): Promise<Exported> {
  const started = Date.now();
  await open(page, file, '');
  const whole: Buffer[] = [];
  for (const settings of formats) whole.push(await exportBytes(page, settings, patch));
  console.log(`whole: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const tiledAt = Date.now();
  await open(page, file, `?texture-limit=${limit}`);
  const tiled: Buffer[] = [];
  for (const settings of formats) {
    tiled.push(await exportBytes(page, settings, patch));
    expect(await page.evaluate(() => window.__photonamousTiles?.finished), `${String(settings.format)} was made in tiles`).toBe(true);
  }
  const plan = await lastPlan(page);
  const notes = await page.evaluate(() => [...(window.__photosHarnessNotes ?? [])]);
  const renderer = await page.evaluate(() => window.__photonamousEngine?.rendererName());
  console.log(`tiles on ${renderer}: ${plan.columns} × ${plan.rows}, apron ${plan.apron}, ${((Date.now() - tiledAt) / 1000).toFixed(1)} s`);
  return { whole, tiled, plan, notes };
}

/** How far a tiled file may be from the whole's, by what it holds (see the top of this file). */
interface Limits {
  readonly max: number;
  readonly mean: number;
  /** The most the difference along the tiles' edges may be beyond elsewhere's. */
  readonly seam: number;
}
/**
 * SwiftShader's leaks, as measured (16-bit: the largest 1280 where
 * sharpening steepens an edge, on average 0.03 of a step; 8-bit: one step
 * at a hundred or so pixels), with room. On the machine's GPU the files
 * must be the same bytes.
 */
const SIXTEEN: Limits = { max: 2048, mean: 0.1, seam: 0 };
const EIGHT: Limits = { max: 2, mean: 0.001, seam: 0 };
/** JPEG: the same compression of two canvases a step apart here and there (measured: 11 at most, 0.006 on average). */
const JPEG_LIMITS: Limits = { max: 16, mean: 0.02, seam: 0 };

type Decoder = 'png' | 'tiff' | 'page';

/** The tiled file against the whole's: the same bytes, or pixels within `limits`, with no seam. */
async function expectNearlyWhole(page: Page, name: string, whole: Buffer | undefined, tiled: Buffer | undefined, plan: Plan, decoder: Decoder, limits: Limits): Promise<Difference | null> {
  if (!whole || !tiled) throw new Error(`${name}: a file is missing`);
  if (whole.equals(tiled)) {
    console.log(`${name}: the same bytes`);
    return null;
  }
  // The machine's GPU lands every read on its texel, so the tiles are exact there (but for Straighten's turn).
  if (isHardwareGpu && limits !== STRAIGHTENED_SIXTEEN && limits !== STRAIGHTENED_JPEG) expect.soft(false, `${name}: on the machine's GPU the tiles are the whole's bytes`).toBe(true);
  const decode = (bytes: Buffer) => (decoder === 'png' ? Promise.resolve(decodePng(bytes)) : decoder === 'tiff' ? Promise.resolve(decodeTiff(bytes)) : decodeInPage(page, bytes));
  const d = difference(await decode(whole), await decode(tiled), plan);
  console.log(`${name}: ${JSON.stringify(d)}`);
  expect.soft(d.max, `${name}: the largest difference`).toBeLessThanOrEqual(limits.max);
  expect.soft(d.mean, `${name}: the mean difference`).toBeLessThan(limits.mean);
  expect.soft(d.seamMax, `${name}: along the tiles' edges, against elsewhere`).toBeLessThanOrEqual(Math.max(d.elsewhereMax, 1) + limits.seam);
  return d;
}

test.describe('exports in tiles', () => {
  test.setTimeout(20 * 60_000);

  test('every stage at once: the 16-bit PNG, the JPEG and the HDR PNG are the whole photo’s', async ({ page }) => {
    const file = { name: 'tiles.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 3000, 2000) };
    const { whole, tiled, plan, notes } = await exportBoth(page, file, 2048, EVERYTHING, [PNG16, JPEG, HDR_PNG]);
    expect(notes).toEqual([]);
    expect(plan.tiles.length).toBeGreaterThan(1);
    expect(plan.apron).toBeGreaterThan(200);
    await expectNearlyWhole(page, 'every stage, 16-bit PNG', whole[0], tiled[0], plan, 'png', SIXTEEN);
    await expectNearlyWhole(page, 'every stage, JPEG', whole[1], tiled[1], plan, 'page', JPEG_LIMITS);
    await expectNearlyWhole(page, 'every stage, HDR PNG', whole[2], tiled[2], plan, 'png', SIXTEEN);
  });

  test('per pixel and by position in a 3 × 3 grid: the TIFF, the 8-bit PNG and the HDR JPEG are the whole photo’s', async ({ page }) => {
    const file = { name: 'grid.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 1500, 1500) };
    const { whole, tiled, plan } = await exportBoth(page, file, 640, PER_PIXEL, [TIFF, PNG8, HDR_JPEG]);
    expect([plan.columns, plan.rows]).toEqual([3, 3]);
    expect(plan.apron).toBe(0);
    await expectNearlyWhole(page, '3 × 3, TIFF', whole[0], tiled[0], plan, 'tiff', SIXTEEN);
    await expectNearlyWhole(page, '3 × 3, 8-bit PNG', whole[1], tiled[1], plan, 'png', EIGHT);
    // The gain-map JPEG's base picture, as a browser without HDR shows it.
    await expectNearlyWhole(page, '3 × 3, HDR JPEG', whole[2], tiled[2], plan, 'page', JPEG_LIMITS);
  });

  test('Rotate and Flip: the tiles’ windows are turned as the whole is', async ({ page }) => {
    const file = { name: 'turned.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 1600, 1000) };
    const { whole, tiled, plan } = await exportBoth(page, file, 1024, TURNED_QUARTER, [PNG16]);
    expect(plan.tiles.length).toBeGreaterThan(1);
    const a = decodePng(whole[0] ?? Buffer.alloc(0));
    expect([a.width, a.height]).toEqual([880, 1440]);
    await expectNearlyWhole(page, 'Rotate and Flip, 16-bit PNG', whole[0], tiled[0], plan, 'png', SIXTEEN);
  });

  test('Straighten: the tiles differ from the whole by a bilinear read’s rounding, and no more at their edges', async ({ page }) => {
    const file = { name: 'straight.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 1800, 1200) };
    const { whole, tiled, plan } = await exportBoth(page, file, 1024, STRAIGHTENED, [PNG16, JPEG]);
    expect(plan.tiles.length).toBeGreaterThan(1);
    // A few 8-bit steps at most where the turned picture has hard edges; on average far less than one.
    await expectNearlyWhole(page, 'Straighten, 16-bit PNG', whole[0], tiled[0], plan, 'png', STRAIGHTENED_SIXTEEN);
    await expectNearlyWhole(page, 'Straighten, JPEG', whole[1], tiled[1], plan, 'page', STRAIGHTENED_JPEG);
  });

  test('a RAW photo’s tiles are rendered from windows of its frame and are the whole photo’s', async ({ page }) => {
    const dir = process.env.LOPSY_RAF_SAMPLES;
    const name = dir && existsSync(dir) ? readdirSync(dir).find((f) => f === RAF_SAMPLE) : undefined;
    test.skip(!dir || !name, 'Set LOPSY_RAF_SAMPLES to the sample-raf-images folder to run this test');
    // A path: a camera file is larger than Playwright takes as a buffer.
    const { whole, tiled, plan } = await exportBoth(page, join(dir ?? '', name ?? ''), RAF_LIMIT, RAF_EDIT, [PNG16]);
    expect(plan.tiles.length).toBeGreaterThan(1);
    await expectNearlyWhole(page, 'RAW, 16-bit PNG', whole[0], tiled[0], plan, 'png', SIXTEEN);
  });
});

/**
 * A JPEG smaller than the held image, from the held image (sized by its
 * short edge, so the export renderer loads the full size rather than the
 * working image): what an export is when no tiles are made, before and
 * after a tile run.
 */
const SMALL_FROM_HELD = { ...JPEG, size: { mode: 'short', px: 400 } };

test.describe('when tiles cannot be made', () => {
  test.setTimeout(10 * 60_000);
  const DETAILS: RecipePatch = { localContrast: { large: 50, small: 40, haze: 0 } };

  test('an apron that leaves no workable tile exports at the held size, and says so', async ({ page }) => {
    const file = { name: 'wide.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 1600, 1100) };
    await open(page, file, '?texture-limit=640');
    const png = decodePng(await exportBytes(page, PNG16, DETAILS));
    expect([png.width, png.height]).toEqual([638, 439]);
    expect(await page.evaluate(() => window.__photonamousTiles?.plan)).toBeNull();
    expect(await page.evaluate(() => window.__photosHarnessNotes)).toEqual([
      'This photo could not be exported at its full size of 1600 × 1100 a part at a time with these settings, so it was exported at 638 × 439.',
    ]);
  });

  test('a tile that fails exports at the held size, says so, and leaves the engine as it was', async ({ page }) => {
    const file = { name: 'wide.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 1600, 1100) };
    await open(page, file, '?texture-limit=640');
    const small = SMALL_FROM_HELD;
    const before = await exportBytes(page, small, PER_PIXEL);
    await page.evaluate(() => {
      window.__photonamousTiles = { plan: null, done: 0, finished: false, failAt: 2 };
    });
    const png = decodePng(await exportBytes(page, PNG16, PER_PIXEL));
    expect([png.width, png.height]).toEqual([606, 413]);
    expect(await page.evaluate(() => window.__photonamousTiles?.done)).toBe(2);
    const notes = await page.evaluate(() => window.__photosHarnessNotes ?? []);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^This photo could not be exported at its full size of 1520 × 1034 a part at a time \(.*tile 2 failed.*\), so it was exported at 606 × 413\.$/);
    // The held image is back: a small export is what it was before the tiles.
    expect((await exportBytes(page, small, PER_PIXEL)).equals(before)).toBe(true);
    // And tiles work again.
    await page.evaluate(() => {
      window.__photonamousTiles = { plan: null, done: 0, finished: false, failAt: null };
    });
    const full = decodePng(await exportBytes(page, PNG16, PER_PIXEL));
    expect([full.width, full.height]).toEqual([1520, 1034]);
  });

  test('a cancelled export stops between tiles and leaves the engine as it was', async ({ page }) => {
    const file = { name: 'wide.jpg', mimeType: 'image/jpeg', buffer: await picture(page, 1600, 1100) };
    await open(page, file, '?texture-limit=640');
    const small = SMALL_FROM_HELD;
    const before = await exportBytes(page, small, PER_PIXEL);
    const cancelled = exportBytes(page, PNG16, PER_PIXEL, true).then(
      () => 'finished',
      (err: unknown) => String(err),
    );
    await page.waitForFunction(() => (window.__photonamousTiles?.done ?? 0) >= 1, undefined, { timeout: 120_000 });
    await page.evaluate(() => {
      if (window.__photosHarnessAbort) window.__photosHarnessAbort.aborted = true;
    });
    expect(await cancelled).toMatch(/cancelled/);
    expect(await page.evaluate(() => window.__photonamousTiles?.finished)).toBe(false);
    expect(await page.evaluate(() => window.__photosHarnessNotes)).toEqual([]);
    expect((await exportBytes(page, small, PER_PIXEL)).equals(before)).toBe(true);
  });
});
