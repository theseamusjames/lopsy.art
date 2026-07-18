/**
 * Font-loading health check for every Google font in the catalog.
 *
 * Probes the EXACT URLs the app requests — imported from
 * src/utils/font-urls.ts, the same module font-loader.ts uses — across all
 * three loading paths:
 *
 *   1. DOM path  (loadGoogleFont):        css2 stylesheet with ALL catalog
 *      weights joined by ';'. A non-200 here means <link>.onerror fires and
 *      the font never loads in the DOM (picker/editing preview).
 *   2. Engine path (loadFontBinaryToEngine): the TTF path baked into the
 *      catalog (single jsDelivr URL), then the css2 single-weight fallback
 *      (fetch CSS → latin-subset url() → font binary).
 *   3. Preview image (FontPicker):        getstencil CDN PNG, or "missing"
 *      when previewFile is null (picker shows plain fallback text).
 *
 * Binary URLs are checked with HEAD so nothing big is downloaded — jsDelivr
 * and fonts.gstatic.com return the same status for HEAD as GET. The css2 CSS
 * responses are fetched fully (a few KB) because we need the body to extract
 * the first url() exactly like the app does. A Chrome UA is sent to
 * fonts.googleapis.com so we get the same woff2-flavored CSS the browser gets.
 *
 * Run: npx tsx scripts/check-font-loading.ts [--all-weights] [--limit N] [--family "Name"]
 * Report: .context/font-check-report.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_CATALOG } from '../src/utils/font-catalog';
import type { FontEntry } from '../src/utils/font-catalog';
import {
  buildCss2StylesheetUrl,
  buildCss2SingleWeightUrl,
  extractFontUrlPreferLatin,
  resolveTtfUrl,
  getPreviewImageUrl,
} from '../src/utils/font-urls';

const CONCURRENCY = Number(process.env.FONT_CHECK_CONCURRENCY ?? 24);
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

// Same UA Chrome sends — fonts.googleapis.com varies its CSS (woff2 vs ttf,
// subset splitting) on UA, and the app always runs in a browser.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface CliOptions {
  allWeights: boolean;
  limit: number | null;
  families: string[];
}

interface EngineWeightResult {
  weight: number;
  ok: boolean;
  via: 'baked-ttf' | 'css-fallback' | 'none';
  /** URL baked into the catalog, or null when the family has none. */
  bakedUrl: string | null;
  /** Non-200 here means the baked path went stale (repo rename). */
  bakedStatus: number | string | null;
  fallbackCssStatus: number | string | null;
  fallbackFontUrl: string | null;
  fallbackFontStatus: number | string | null;
  /** css2 subset the app's extractor picked — anything but "latin" for a
   *  latin-script font means the engine gets a binary without A–Z glyphs. */
  fallbackChosenSubset: string | null;
  fallbackSubsetCount: number;
}

interface FontResult {
  family: string;
  category: string;
  weights: readonly number[];
  hasItalic: boolean;
  dom: { url: string; status: number | string; ok: boolean };
  engine: EngineWeightResult[];
  preview: { file: string | null; status: number | string | null; ok: boolean };
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { allWeights: false, limit: null, families: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all-weights') opts.allWeights = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--family') opts.families.push(String(argv[++i]));
  }
  return opts;
}

async function request(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
): Promise<{ status: number | 'network-error' | 'timeout'; body: string | null }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Retry transient server-side statuses; return everything else as-is.
      if ([429, 500, 502, 503].includes(resp.status) && attempt < MAX_ATTEMPTS) {
        await resp.arrayBuffer().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      const body = method === 'GET' && resp.ok ? await resp.text() : null;
      if (method === 'HEAD' || !resp.ok) await resp.arrayBuffer().catch(() => undefined);
      return { status: resp.status, body };
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      if (attempt === MAX_ATTEMPTS) {
        return { status: isTimeout ? 'timeout' : 'network-error', body: null };
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { status: 'network-error', body: null };
}

const headBinary = (url: string) => request(url, 'HEAD', { 'User-Agent': CHROME_UA });
const getCss = (url: string) => request(url, 'GET', { 'User-Agent': CHROME_UA });

/** Subset comment (e.g. "latin") preceding the given url() in css2 CSS. */
function subsetOfUrl(css: string, url: string): { subset: string | null; subsetCount: number } {
  const subsetCount = (css.match(/\/\*\s*[\w[\]-]+\s*\*\//g) ?? []).length;
  const urlIdx = css.indexOf(url);
  if (urlIdx === -1) return { subset: null, subsetCount };
  const before = css.slice(0, urlIdx);
  const comments = [...before.matchAll(/\/\*\s*([\w[\]-]+)\s*\*\//g)];
  const last = comments[comments.length - 1];
  return { subset: last?.[1] ?? null, subsetCount };
}

/** Nearest catalog weight to the default 400 — same reduce as TextOptions.tsx. */
function defaultTargetWeight(weights: readonly number[]): number {
  return weights.reduce((prev, curr) =>
    Math.abs(curr - 400) < Math.abs(prev - 400) ? curr : prev,
  );
}

async function checkEngineWeight(entry: FontEntry, weight: number): Promise<EngineWeightResult> {
  const result: EngineWeightResult = {
    weight,
    ok: false,
    via: 'none',
    bakedUrl: null,
    bakedStatus: null,
    fallbackCssStatus: null,
    fallbackFontUrl: null,
    fallbackFontStatus: null,
    fallbackChosenSubset: null,
    fallbackSubsetCount: 0,
  };

  // Mirror fetchTtfFromGithub: single fetch of the catalog-baked path.
  result.bakedUrl = resolveTtfUrl(entry, weight);
  if (result.bakedUrl) {
    const { status } = await headBinary(result.bakedUrl);
    result.bakedStatus = status;
    if (status === 200) {
      result.via = 'baked-ttf';
      result.ok = true;
      return result;
    }
  }

  // Mirror fetchFontFromCssApi.
  const cssUrl = buildCss2SingleWeightUrl(entry.family, weight);
  const cssResp = await getCss(cssUrl);
  result.fallbackCssStatus = cssResp.status;
  if (cssResp.status !== 200 || cssResp.body === null) return result;

  const fontUrl = extractFontUrlPreferLatin(cssResp.body);
  result.fallbackFontUrl = fontUrl;
  if (!fontUrl) return result;

  const { subset, subsetCount } = subsetOfUrl(cssResp.body, fontUrl);
  result.fallbackChosenSubset = subset;
  result.fallbackSubsetCount = subsetCount;

  const fontResp = await headBinary(fontUrl);
  result.fallbackFontStatus = fontResp.status;
  if (fontResp.status === 200) {
    result.via = 'css-fallback';
    result.ok = true;
  }
  return result;
}

async function checkFont(entry: FontEntry, allWeights: boolean): Promise<FontResult> {
  const domUrl = buildCss2StylesheetUrl(entry.family, entry.weights);
  const domResp = await getCss(domUrl);

  const weightsToCheck = allWeights ? entry.weights : [defaultTargetWeight(entry.weights)];
  const engine: EngineWeightResult[] = [];
  for (const w of weightsToCheck) {
    engine.push(await checkEngineWeight(entry, w));
  }

  let preview: FontResult['preview'] = { file: null, status: null, ok: false };
  if (entry.previewFile) {
    const { status } = await headBinary(getPreviewImageUrl(entry.previewFile));
    preview = { file: entry.previewFile, status, ok: status === 200 };
  }

  return {
    family: entry.family,
    category: entry.category,
    weights: entry.weights,
    hasItalic: entry.hasItalic,
    dom: { url: domUrl, status: domResp.status, ok: domResp.status === 200 },
    engine,
    preview,
  };
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
      if (done % 100 === 0) console.log(`  ${done}/${items.length} fonts checked...`);
    }
  });
  await Promise.all(lanes);
  return results;
}

function summarize(results: FontResult[]): void {
  const domFail = results.filter((r) => !r.dom.ok);
  const engineFail = results.filter((r) => r.engine.some((e) => !e.ok));
  const bakedStale = results.filter((r) =>
    r.engine.some((e) => e.bakedUrl !== null && e.bakedStatus !== null && e.bakedStatus !== 200),
  );
  const engineViaFallback = results.filter(
    (r) => r.engine.every((e) => e.ok) && r.engine.some((e) => e.via === 'css-fallback'),
  );
  const fallbackNonLatin = results.filter((r) =>
    r.engine.some((e) => e.via === 'css-fallback' && e.fallbackChosenSubset !== null && e.fallbackChosenSubset !== 'latin'),
  );
  const previewMissing = results.filter((r) => r.preview.file === null);
  const previewBroken = results.filter((r) => r.preview.file !== null && !r.preview.ok);

  const list = (rs: FontResult[], max = 25) =>
    rs.slice(0, max).map((r) => r.family).join(', ') + (rs.length > max ? `, … (+${rs.length - max})` : '');

  console.log('\n========== SUMMARY ==========');
  console.log(`Fonts checked: ${results.length}`);
  console.log(`\nDOM path (css2 stylesheet, all weights) FAILURES: ${domFail.length}`);
  if (domFail.length) console.log(`  ${list(domFail)}`);
  console.log(`\nEngine path FAILURES (no baked TTF, no css fallback): ${engineFail.length}`);
  if (engineFail.length) console.log(`  ${list(engineFail)}`);
  console.log(`\nBaked TTF path STALE (non-200 — regenerate the catalog): ${bakedStale.length}`);
  if (bakedStale.length) console.log(`  ${list(bakedStale)}`);
  console.log(`\nEngine path via css2 WOFF2 fallback (no baked path): ${engineViaFallback.length}`);
  if (engineViaFallback.length) console.log(`  ${list(engineViaFallback)}`);
  console.log(`\n  … of those, chosen url() is a NON-LATIN subset: ${fallbackNonLatin.length}`);
  if (fallbackNonLatin.length) console.log(`  ${list(fallbackNonLatin)}`);
  console.log(`\nPicker preview image missing from catalog (shows plain text): ${previewMissing.length}`);
  if (previewMissing.length) console.log(`  ${list(previewMissing)}`);
  console.log(`\nPicker preview image in catalog but CDN request failed: ${previewBroken.length}`);
  if (previewBroken.length) console.log(`  ${list(previewBroken)}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  let fonts = FONT_CATALOG.filter((f) => f.source === 'google');
  if (opts.families.length > 0) {
    fonts = fonts.filter((f) => opts.families.includes(f.family));
  }
  if (opts.limit !== null) fonts = fonts.slice(0, opts.limit);

  console.log(`Checking ${fonts.length} Google fonts (concurrency ${CONCURRENCY}, ` +
    `${opts.allWeights ? 'all weights' : 'default weight only'})...`);
  const started = Date.now();
  const results = await runPool([...fonts], (f) => checkFont(f, opts.allWeights), CONCURRENCY);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  summarize(results);

  const outDir = join(import.meta.dirname!, '..', '.context');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'font-check-report.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nFull report: ${outPath}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
