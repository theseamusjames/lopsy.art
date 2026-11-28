import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './test';
import type { Page } from './test';
import { isChromium } from './gpu-args';
import { previewCount, settledPreview, waitForPreview, waitForReady } from './harness';

/**
 * RAW parity: what the Edit view renders for each real RAF, at its working
 * size, under three recipes, fingerprinted and compared with fingerprints
 * recorded before the RAW develop path is made format-neutral, so that
 * moving RAF onto the neutral path is proved to change nothing.
 *
 * The fingerprint is read through the screen engine's development hook
 * (`readRendered`, develop-engine.ts): on the linear path the engine's
 * `readRenderedF32` (linear Rec. 2020 floats before the output step), on
 * the legacy path the sRGB picture an 8-bit export draws, at 2048 px on
 * its long edge, as a PNG decoded in the page. It is a 64-bit hash of the exact bits (FNV-1a 32
 * over the bytes and MurmurHash3's 32-bit mixing over the words) and, to
 * say where a change is when the hash differs, the mean R, G and B of a
 * 12 × 8 grid of cells.
 *
 * Each sample is rendered three ways: on the page's own path (linear,
 * since every GPU the tests run on renders to float targets); with
 * `?develop=legacy` (the legacy calls, on the float RAW decode); and with
 * `?develop=no-float` (as on a GPU without float targets: the RAF decoded
 * to its finished look in bands and edited as an ordinary photo).
 *
 * Stored per sample in e2e/raw-parity/<name>.txt, keyed by browser,
 * renderer and way (`chromium-wgpu-linear`, `chromium-webgl-no-float`, ...).
 * The recipes are
 * cumulative, in one load: the defaults; then a white balance (typed in
 * Kelvin where the Temperature readout takes it, as relative units
 * elsewhere), a tint, an exposure and a profile other than the default;
 * then tone, colour, local contrast, sharpening and noise reduction on top.
 *
 * DNG and Sony ARW samples are fingerprinted the same way, on the linear
 * and no-float ways (the second opens them with the baked decode): the
 * four Sony bodies from LOPSY_ARW_SAMPLES, the four Canon DNGs (lossless
 * and lossy JPEG, mosaic and linear) from LOPSY_DNG_ADOBE_SAMPLES and the
 * two iPhone ProRAW files from
 * LOPSY_DNG_SAMPLES, and two DNGs a camera wrote from
 * LOPSY_DNG_CAMERA_SAMPLES (a Leica M10-R, whose raw image is in the
 * file's first directory, and a Leica Q2, whose 8368 pixels are wider
 * than SwiftShader's 8192-pixel textures: the no-float way's baked decode
 * opens it reduced to the largest size the GPU can edit, full-size.ts),
 * two Canon CR2s from LOPSY_CR2_SAMPLES (a 5D Mark III, which has a matrix
 * of the engine's own, and a 7D, which has none and whose colour filter
 * starts with green) and two Nikon NEFs from LOPSY_NEF_SAMPLES (a D850,
 * which has a matrix and is 8256 pixels wide, a 14-bit packed Z 6,
 * which has none, and a portrait Z 30 in Nikon's lossless compression). In recipe 2 a DNG, ARW, CR2 or NEF takes the first look after
 * its camera's (Neutral, or a ProRAW's Standard).
 *
 * Needs LOPSY_RAF_SAMPLES (and the others for their files); each set is
 * skipped without its variable. LOPSY_RAW_PARITY_UPDATE=1 records the
 * current renders for the key the run is on (other keys are kept): run it
 * with -g to record only the samples meant to change.
 */
const samples = process.env.LOPSY_RAF_SAMPLES;
const arwSamples = process.env.LOPSY_ARW_SAMPLES;
const dngSamples = process.env.LOPSY_DNG_ADOBE_SAMPLES;
const prorawSamples = process.env.LOPSY_DNG_SAMPLES;
const cameraDngSamples = process.env.LOPSY_DNG_CAMERA_SAMPLES;
const cr2Samples = process.env.LOPSY_CR2_SAMPLES;
const nefSamples = process.env.LOPSY_NEF_SAMPLES;
/** The other RAW samples fingerprinted: four Sony bodies (two with measured colour, two without), four Canon DNGs (a mosaic, a linear one and their lossy JPEG conversions), two ProRAW files, two Leica DNGs, two Canon CR2s and three Nikon NEFs. */
const OTHER_RAW: readonly { readonly dir: string | undefined; readonly name: string }[] = [
  { dir: arwSamples, name: 'ILCE-7M3_DSC0009.ARW' },
  { dir: arwSamples, name: 'ILCE-7M4_DSC06677_FullFrame-Raw-Compressed.ARW' },
  { dir: arwSamples, name: 'ILCE-6000_DSC01542.ARW' },
  { dir: arwSamples, name: 'DSC-RX100M3_DSC00734.ARW' },
  { dir: dngSamples, name: '5D3-adobe-lossless.dng' },
  { dir: dngSamples, name: '5D3-adobe-lossless-rgb.dng' },
  { dir: dngSamples, name: '5D3-adobe-lossy.dng' },
  { dir: dngSamples, name: '5D3-adobe-lossy-rgb.dng' },
  { dir: prorawSamples, name: 'sample_dng_00.dng' },
  { dir: prorawSamples, name: 'sample_dng_01.dng' },
  { dir: cameraDngSamples, name: 'Leica-M10-R-compressed.dng' },
  { dir: cameraDngSamples, name: 'Leica-Q2.dng' },
  { dir: cr2Samples, name: 'EOS-5D-Mark-III_RAW.CR2' },
  { dir: cr2Samples, name: 'EOS-7D_RAW.CR2' },
  { dir: nefSamples, name: 'D850_14bit_uncompressed.NEF' },
  { dir: nefSamples, name: 'Z6_14bit_uncompressed.NEF' },
  { dir: nefSamples, name: 'Z30_14bit_lossless.NEF' },
];
const isUpdate = process.env.LOPSY_RAW_PARITY_UPDATE === '1';
const STORE = join(dirname(fileURLToPath(import.meta.url)), 'raw-parity');
const GRID_COLUMNS = 12;
const GRID_ROWS = 8;

interface Fingerprint {
  readonly key: string;
  readonly hash: string;
  readonly width: number;
  readonly height: number;
  /** GRID_ROWS × GRID_COLUMNS cells of [R, G, B] means, as written to the file. */
  readonly cells: readonly string[];
}

const files = samples && existsSync(samples) ? readdirSync(samples).filter((f) => /\.raf$/i.test(f)).sort() : [];

/** Reads the rendered picture in the page and reduces it there, as imageStats does; only the fingerprint comes back. */
async function fingerprint(page: Page): Promise<Fingerprint> {
  return page.evaluate(
    async ({ columns, rows }) => {
      const rendered = await window.__photonamousScreenEngine?.readRendered();
      if (!rendered) throw new Error('the Edit view has nothing rendered to read');
      let pixels: Float32Array | Uint8ClampedArray;
      if (rendered.kind === 'linear-f32') {
        pixels = rendered.pixels;
      } else {
        // The legacy picture comes as a PNG: decoded as imageStats decodes a preview.
        const bitmap = await createImageBitmap(rendered.png);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0);
        pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      }
      const read = { path: rendered.path, kind: rendered.kind, width: rendered.width, height: rendered.height, pixels };
      const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
      // FNV-1a 32 over the bytes, and MurmurHash3's 32-bit mixing over the words: 64 bits between them.
      let a = 0x811c9dc5;
      let b = 0x9747b28c;
      const rotl = (x: number, r: number) => (x << r) | (x >>> (32 - r));
      const eat = (word: number) => {
        a = Math.imul(a ^ (word & 0xff), 0x01000193);
        a = Math.imul(a ^ ((word >>> 8) & 0xff), 0x01000193);
        a = Math.imul(a ^ ((word >>> 16) & 0xff), 0x01000193);
        a = Math.imul(a ^ (word >>> 24), 0x01000193);
        let k = Math.imul(word, 0xcc9e2d51);
        k = Math.imul(rotl(k, 15), 0x1b873593);
        b = (Math.imul(rotl(b ^ k, 13), 5) + 0xe6546b64) | 0;
      };
      eat(read.width);
      eat(read.height);
      for (let i = 0; i < words.length; i++) eat(words[i] ?? 0);
      b ^= words.length * 4;
      b = Math.imul(b ^ (b >>> 16), 0x85ebca6b);
      b = Math.imul(b ^ (b >>> 13), 0xc2b2ae35);
      b ^= b >>> 16;
      a >>>= 0;
      b >>>= 0;
      const sums = new Float64Array(columns * rows * 3);
      const counts = new Float64Array(columns * rows);
      for (let y = 0; y < read.height; y++) {
        const row = Math.min(rows - 1, Math.floor((y * rows) / read.height));
        for (let x = 0; x < read.width; x++) {
          const cell = row * columns + Math.min(columns - 1, Math.floor((x * columns) / read.width));
          const p = (y * read.width + x) * 4;
          sums[cell * 3] += read.pixels[p] ?? 0;
          sums[cell * 3 + 1] += read.pixels[p + 1] ?? 0;
          sums[cell * 3 + 2] += read.pixels[p + 2] ?? 0;
          counts[cell] += 1;
        }
      }
      const isFloat = read.kind === 'linear-f32';
      const cells = Array.from(counts, (n, cell) =>
        [0, 1, 2].map((c) => ((sums[cell * 3 + c] ?? 0) / Math.max(1, n)).toFixed(isFloat ? 6 : 3)).join(','),
      );
      const engine = window.__photonamousEngine;
      const hash = a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
      const override = new URLSearchParams(location.search).get('develop');
      return { key: `chromium-${engine?.rendererName() ?? 'unknown'}-${override ?? read.path}`, hash, width: read.width, height: read.height, cells };
    },
    { columns: GRID_COLUMNS, rows: GRID_ROWS },
  );
}

/** Reads until two reads agree: the render has settled, and the read is repeatable within the run. */
async function settledFingerprint(page: Page): Promise<Fingerprint> {
  let last = await fingerprint(page);
  for (let i = 0; i < 4; i++) {
    const next = await fingerprint(page);
    if (next.hash === last.hash) return next;
    last = next;
  }
  throw new Error(`the render did not settle: the last reads differ (${last.hash})`);
}

async function setValue(page: Page, label: string, value: string): Promise<void> {
  // The first of its name: Saturation is also a tab of Color by hue, further down.
  const readout = page.getByLabel(`${label} value`, { exact: true }).first();
  await readout.fill(value);
  await readout.press('Enter');
}

/** Applies edits, then waits until the harness has the preview of the last one: the engine has rendered it. */
async function edit(page: Page, steps: () => Promise<void>): Promise<void> {
  const from = await previewCount(page);
  const stepsFrom = await page.evaluate(() => window.__photosHarness?.steps.length ?? 0);
  await steps();
  await expect.poll(() => page.evaluate(() => window.__photosHarness?.steps.length ?? 0)).toBeGreaterThan(stepsFrom);
  await waitForPreview(page, from, 3 * 60_000);
  await settledPreview(page, from);
}

/**
 * The profile the second recipe picks: the one its stored line names, so a
 * change to the menu's order or wording cannot change which profile is
 * rendered; for a new recording, a film look where there is one, else
 * Neutral, else Monochrome.
 */
async function otherProfile(page: Page, stored: string | null): Promise<string> {
  if (stored) return stored;
  const values = await page.getByRole('combobox', { name: 'Profile' }).locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const film = values.find((v) => !['standard', 'camera', 'neutral', 'monochrome'].includes(v));
  return film ?? (values.includes('neutral') ? 'neutral' : 'monochrome');
}

/** The key of the way this page renders (as `fingerprint` gives it), before anything is read. */
async function pageKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const engine = window.__photonamousEngine;
    const override = new URLSearchParams(location.search).get('develop');
    return `chromium-${engine?.rendererName() ?? 'unknown'}-${override ?? (engine?.isWorkingSpace ? 'linear' : 'legacy')}`;
  });
}

const RECIPES: readonly { readonly name: string; readonly apply: (page: Page, storedProfile: string | null) => Promise<string> }[] = [
  { name: 'defaults', apply: async () => 'standard' },
  {
    name: 'white-balance-exposure-profile',
    apply: async (page, storedProfile) => {
      const profile = await otherProfile(page, storedProfile);
      await edit(page, async () => {
        const temperature = page.getByLabel('Temperature value', { exact: true });
        const isKelvin = (await temperature.inputValue()).endsWith(' K');
        await setValue(page, 'Temperature', isKelvin ? '6500' : '40');
        await setValue(page, 'Tint', '-15');
        await setValue(page, 'Exposure', '0.7');
        await page.getByRole('combobox', { name: 'Profile' }).selectOption(profile);
      });
      return profile;
    },
  },
  {
    name: 'tone-colour-detail',
    apply: async (page) => {
      await edit(page, async () => {
        await setValue(page, 'Contrast', '25');
        await setValue(page, 'Highlights', '-40');
        await setValue(page, 'Shadows', '30');
        await setValue(page, 'Vibrance', '20');
        await setValue(page, 'Saturation', '-10');
        await setValue(page, 'Haze', '20');
        await setValue(page, 'Sharpen', '60');
        await setValue(page, 'Noise', '20');
      });
      return '';
    },
  },
];

function storePath(name: string): string {
  return join(STORE, `${name.replace(/\.(raf|dng|arw|cr2|nef)$/i, '')}.txt`);
}

/** Stored lines by `<key> <recipe>`: the header line, then the grid lines. */
function readStore(name: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const path = storePath(name);
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [key = '', recipe = ''] = line.split(' ');
    const id = `${key} ${recipe}`;
    out.set(id, [...(out.get(id) ?? []), line]);
  }
  return out;
}

function linesFor(recipe: string, print: Fingerprint, profile: string): string[] {
  const head = `${print.key} ${recipe} hash ${print.hash} size ${print.width} ${print.height}${profile ? ` profile ${profile}` : ''}`;
  const grid: string[] = [];
  for (let row = 0; row < GRID_ROWS; row++) grid.push(`${print.key} ${recipe} ${row} ${print.cells.slice(row * GRID_COLUMNS, (row + 1) * GRID_COLUMNS).join(' ')}`);
  return [head, ...grid];
}

function writeStore(name: string, stored: Map<string, string[]>): void {
  mkdirSync(STORE, { recursive: true });
  const header = [
    `# RAW parity fingerprints of ${name}: e2e/raw-parity.spec.ts.`,
    '# Remade for the key a run is on with LOPSY_RAW_PARITY_UPDATE=1; a change to the RAW develop comes with new ones.',
    '# Per key (browser renderer, develop path) and recipe: the hash of the exact render and its size, then',
    `# ${GRID_ROWS} lines of ${GRID_COLUMNS} cells, the mean R,G,B of each (linear: Rec. 2020 floats; legacy: sRGB 0..255).`,
  ];
  const body = [...stored.keys()].sort().flatMap((id) => stored.get(id) ?? []);
  writeFileSync(storePath(name), [...header, ...body, ''].join('\n'));
}

/** Where two stored grids differ, for the failure message. */
function gridMovement(expected: readonly string[], got: readonly string[]): string {
  const values = (lines: readonly string[]) => lines.slice(1).flatMap((line) => line.split(' ').slice(3).flatMap((cell) => cell.split(',').map(Number)));
  const a = values(expected);
  const b = values(got);
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return `largest cell-mean change ${worst}`;
}

/** Renders `path` each way and compares (or records) its fingerprints. */
async function checkSample(page: Page, name: string, path: string, queries: readonly string[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const stored = readStore(name);
  const problems: string[] = [];
  for (const query of queries) {
    await page.goto(`/edit-harness.html${query}`);
    await expect(page.getByTestId('harness-file')).toBeAttached();
    await page.getByTestId('harness-file').setInputFiles(path);
    await waitForReady(page, 150_000);
    // The first preview: the load has rendered.
    await waitForPreview(page, 0, 3 * 60_000);
    await settledPreview(page, 0);
    const key = await pageKey(page);
    const storedProfile = / profile (\S+)$/.exec(stored.get(`${key} white-balance-exposure-profile`)?.[0] ?? '')?.[1] ?? null;
    for (const recipe of RECIPES) {
      const profile = await recipe.apply(page, storedProfile);
      const print = await settledFingerprint(page);
      const lines = linesFor(recipe.name, print, profile);
      const id = `${print.key} ${recipe.name}`;
      console.log(`${name} ${id}: ${print.hash} ${print.width}x${print.height}`);
      if (isUpdate) {
        stored.set(id, lines);
        continue;
      }
      const expected = stored.get(id);
      if (!expected) {
        problems.push(`${id}: nothing stored (record with LOPSY_RAW_PARITY_UPDATE=1)`);
      } else if (expected[0] !== lines[0]) {
        problems.push(`${id}: expected "${expected[0]}", got "${lines[0]}"; ${gridMovement(expected, lines)}`);
      }
    }
  }
  if (isUpdate) writeStore(name, stored);
  expect(problems, name).toEqual([]);
}

test.describe('RAW parity: each RAF renders as recorded', () => {
  test.skip(files.length === 0, 'Set LOPSY_RAF_SAMPLES to the directory of sample RAFs to run this test');
  test.skip(!isChromium, 'The fingerprints are recorded in Chromium; other browsers render on other GPU stacks');
  test.setTimeout(12 * 60_000);

  for (const name of files) {
    // The page's own develop path (linear: every GPU the tests run on has float targets), the legacy
    // calls on the float RAW decode, and the path of a GPU without float targets (develop-override.ts).
    test(name, ({ page }) => checkSample(page, name, join(samples ?? '', name), ['', '?develop=legacy', '?develop=no-float']));
  }
});

test.describe('RAW parity: each DNG, ARW, CR2 and NEF renders as recorded', () => {
  test.skip(!isChromium, 'The fingerprints are recorded in Chromium; other browsers render on other GPU stacks');
  test.setTimeout(12 * 60_000);

  for (const { dir, name } of OTHER_RAW) {
    test(name, async ({ page }) => {
      const path = dir ? join(dir, name) : '';
      test.skip(!dir || !existsSync(path), `needs ${name} (LOPSY_ARW_SAMPLES, LOPSY_DNG_ADOBE_SAMPLES, LOPSY_DNG_SAMPLES, LOPSY_DNG_CAMERA_SAMPLES, LOPSY_CR2_SAMPLES, LOPSY_NEF_SAMPLES)`);
      // The RAW path, and the baked decode a GPU without float targets opens these formats with.
      await checkSample(page, name, path, ['', '?develop=no-float']);
    });
  }
});
