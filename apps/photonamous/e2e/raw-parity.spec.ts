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
 * Needs LOPSY_RAF_SAMPLES; LOPSY_RAW_PARITY_UPDATE=1 records the current
 * renders for the key the run is on (other keys are kept).
 */
const samples = process.env.LOPSY_RAF_SAMPLES;
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

/** The profile the second recipe picks: a film look where there is one, else Neutral, else Monochrome. */
async function otherProfile(page: Page): Promise<string> {
  const values = await page.getByRole('combobox', { name: 'Profile' }).locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const film = values.find((v) => !['standard', 'camera', 'neutral', 'monochrome'].includes(v));
  return film ?? (values.includes('neutral') ? 'neutral' : 'monochrome');
}

const RECIPES: readonly { readonly name: string; readonly apply: (page: Page) => Promise<string> }[] = [
  { name: 'defaults', apply: async () => 'standard' },
  {
    name: 'white-balance-exposure-profile',
    apply: async (page) => {
      const profile = await otherProfile(page);
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
  return join(STORE, `${name.replace(/\.raf$/i, '')}.txt`);
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

test.describe('RAW parity: each RAF renders as recorded', () => {
  test.skip(files.length === 0, 'Set LOPSY_RAF_SAMPLES to the directory of sample RAFs to run this test');
  test.skip(!isChromium, 'The fingerprints are recorded in Chromium; other browsers render on other GPU stacks');
  test.setTimeout(12 * 60_000);

  for (const name of files) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const stored = readStore(name);
      const problems: string[] = [];
      // The page's own develop path (linear: every GPU the tests run on has float targets), the legacy
      // calls on the float RAW decode, and the path of a GPU without float targets (develop-override.ts).
      for (const query of ['', '?develop=legacy', '?develop=no-float']) {
        await page.goto(`/edit-harness.html${query}`);
        await expect(page.getByTestId('harness-file')).toBeAttached();
        await page.getByTestId('harness-file').setInputFiles(join(samples ?? '', name));
        await waitForReady(page, 150_000);
        // The first preview: the load has rendered.
        await waitForPreview(page, 0, 3 * 60_000);
        await settledPreview(page, 0);
        for (const recipe of RECIPES) {
          const profile = await recipe.apply(page);
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
    });
  }
});
