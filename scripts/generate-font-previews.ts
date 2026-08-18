/**
 * Bake every Google-source family in FONT_CATALOG into a single blob of
 * name-only WOFF2 subsets, plus an offset/length index the runtime uses to
 * carve out per-family slices.
 *
 * Why: the picker used to fetch preview PNGs from a third-party CDN that has
 * since been deleted. Baking name-glyph-only subsets ourselves is small
 * (~1-2 KB per family, ~3 MB total for ~1900 fonts) and eliminates every
 * external dependency at runtime — the picker never talks to Google Fonts
 * again just to draw its own dropdown.
 *
 * Output:
 *   public/font-previews.bin           — concatenated WOFF2 bytes
 *   src/utils/font-previews-index.ts   — { [family]: { offset, length } }
 *
 * Run: npx tsx scripts/generate-font-previews.ts
 *
 * Fetches per family: (1) css2 with text=Family to get the subset URL,
 * (2) the WOFF2 itself. Families that fail either step are logged and
 * omitted from the index; the runtime falls back to the css2 API on demand
 * for those, so no picker row breaks — it just won't render offline.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_CATALOG } from '../src/utils/font-catalog';
import { buildCss2PreviewUrl, extractFirstFontUrl } from '../src/utils/font-urls';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_BIN = join(REPO_ROOT, 'public', 'font-previews.bin');
const OUT_INDEX = join(REPO_ROOT, 'src', 'utils', 'font-previews-index.ts');

const CONCURRENCY = Number(process.env.PREVIEW_CONCURRENCY ?? 24);
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

// css2 varies its response on UA — with a Chrome UA we get WOFF2, which is
// what browsers accept via new FontFace(...). Any other UA can return raw TTF
// and inflate the blob by ~2x.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function request(url: string, kind: 'text' | 'bytes'): Promise<string | Uint8Array | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': CHROME_UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if ([429, 500, 502, 503].includes(resp.status) && attempt < MAX_ATTEMPTS) {
        await resp.arrayBuffer().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      if (!resp.ok) return null;
      return kind === 'text' ? await resp.text() : new Uint8Array(await resp.arrayBuffer());
    } catch {
      if (attempt === MAX_ATTEMPTS) return null;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return null;
}

interface PreviewBytes {
  family: string;
  bytes: Uint8Array;
}

async function fetchPreview(family: string): Promise<PreviewBytes | null> {
  const cssUrl = buildCss2PreviewUrl(family, family);
  const css = await request(cssUrl, 'text');
  if (typeof css !== 'string') return null;
  const fontUrl = extractFirstFontUrl(css);
  if (!fontUrl) return null;
  const bytes = await request(fontUrl, 'bytes');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return null;
  return { family, bytes };
}

async function runPool<T, R>(items: T[], worker: (item: T) => Promise<R>, size: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx]!);
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${items.length} previews fetched...`);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function main(): Promise<void> {
  const fonts = FONT_CATALOG.filter((f) => f.source === 'google');
  console.log(`Baking previews for ${fonts.length} Google fonts (concurrency ${CONCURRENCY})...`);
  const started = Date.now();

  const results = await runPool(fonts, (f) => fetchPreview(f.family), CONCURRENCY);
  const succeeded = results.filter((r): r is PreviewBytes => r !== null);
  const failed = fonts
    .map((f, i) => (results[i] === null ? f.family : null))
    .filter((f): f is string => f !== null);

  console.log(`Done fetching in ${((Date.now() - started) / 1000).toFixed(0)}s: ` +
    `${succeeded.length} ok, ${failed.length} failed`);
  if (failed.length) {
    console.log(`Failed (runtime will fall back to css2 for these):`);
    console.log(`  ${failed.slice(0, 25).join(', ')}${failed.length > 25 ? `, … (+${failed.length - 25})` : ''}`);
  }

  // Concatenate and index. Sort by family for a deterministic diff.
  succeeded.sort((a, b) => a.family.localeCompare(b.family));
  const totalBytes = succeeded.reduce((sum, r) => sum + r.bytes.byteLength, 0);
  const blob = new Uint8Array(totalBytes);
  const index: Record<string, { offset: number; length: number }> = {};
  let cursor = 0;
  for (const { family, bytes } of succeeded) {
    index[family] = { offset: cursor, length: bytes.byteLength };
    blob.set(bytes, cursor);
    cursor += bytes.byteLength;
  }

  mkdirSync(dirname(OUT_BIN), { recursive: true });
  writeFileSync(OUT_BIN, blob);
  console.log(`Wrote ${OUT_BIN} (${(totalBytes / 1024).toFixed(0)} KB)`);

  const indexLines = [
    '// GENERATED by scripts/generate-font-previews.ts — do not edit by hand.',
    '// Byte offsets into public/font-previews.bin for each Google-font family',
    '// name-only WOFF2 subset. See src/utils/font-previews.ts for the runtime',
    '// that maps a family name to a document.fonts FontFace using this table.',
    '',
    'export interface FontPreviewSlice {',
    '  readonly offset: number;',
    '  readonly length: number;',
    '}',
    '',
    `export const FONT_PREVIEWS_TOTAL_BYTES = ${totalBytes};`,
    '',
    'export const FONT_PREVIEWS_INDEX: Readonly<Record<string, FontPreviewSlice>> = {',
    ...succeeded.map(({ family }) => {
      const slice = index[family]!;
      return `  ${JSON.stringify(family)}: { offset: ${slice.offset}, length: ${slice.length} },`;
    }),
    '};',
    '',
  ].join('\n');
  writeFileSync(OUT_INDEX, indexLines);
  console.log(`Wrote ${OUT_INDEX} (${succeeded.length} entries)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
