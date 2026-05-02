import type { FontCategory } from './font-catalog';
import { loadFontData } from '../engine-wasm/wasm-bridge';
import { getEngine } from '../engine-wasm/engine-state';

const PREVIEW_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/getstencil/GoogleWebFonts-FontFamilyPreviewImages@master/48px/compressed/';

// jsDelivr CDN for the google/fonts GitHub repo (raw TTF files).
const GOOGLE_FONTS_GH_CDN = 'https://cdn.jsdelivr.net/gh/google/fonts@main';

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

const LICENSE_DIRS = ['ofl', 'apache', 'ufl'] as const;

const loadCache = new Map<string, Promise<void>>();

// Cache of already-fetched font binaries keyed by "family:weight".
// Avoids re-fetching when the user switches back to a previously loaded font.
const binaryCache = new Map<string, ArrayBuffer>();

export function loadGoogleFont(family: string, weights: readonly number[]): Promise<void> {
  const key = family;
  const cached = loadCache.get(key);
  if (cached) return cached;

  const weightsStr = weights.join(';');
  const encoded = encodeURIComponent(family);
  const href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weightsStr}&display=swap`;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;

  const promise = new Promise<void>((resolve, reject) => {
    link.onload = () => {
      document.fonts.ready.then(() => resolve());
    };
    link.onerror = () => reject(new Error(`Failed to load font: ${family}`));
    document.head.appendChild(link);
  });

  loadCache.set(key, promise);
  return promise;
}

/**
 * Derive candidate TTF URLs for a Google Font from the google/fonts GitHub repo.
 *
 * The repo uses: /{license}/{slug}/{FamilyNoSpaces}-{WeightName}.ttf
 * where slug = family.toLowerCase().replace(/\s+/g, '')
 * and FamilyNoSpaces = family.replace(/\s+/g, '')
 *
 * We try all three license directories (ofl, apache, ufl).
 */
function githubTtfUrls(family: string, weight: number): string[] {
  const slug = family.toLowerCase().replace(/\s+/g, '');
  const noSpaces = family.replace(/\s+/g, '');
  const weightName = WEIGHT_NAMES[weight] ?? 'Regular';
  const filename = `${noSpaces}-${weightName}.ttf`;
  return LICENSE_DIRS.map(dir => `${GOOGLE_FONTS_GH_CDN}/${dir}/${slug}/${filename}`);
}

/**
 * Try fetching a TTF from the google/fonts GitHub repo via jsDelivr CDN.
 * Returns the ArrayBuffer on success, or null if all candidates fail.
 */
async function fetchTtfFromGithub(family: string, weight: number): Promise<ArrayBuffer | null> {
  for (const url of githubTtfUrls(family, weight)) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return resp.arrayBuffer();
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Fall back to Google Fonts CSS API: fetch the @font-face CSS, extract the
 * first font URL (WOFF2 in practice), and return its bytes. The WASM engine
 * decodes WOFF2 internally via the brotli-based decoder.
 */
async function fetchFontFromCssApi(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const encoded = encodeURIComponent(family);
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weight}&display=swap`;
    const cssResp = await fetch(cssUrl);
    if (!cssResp.ok) return null;
    const css = await cssResp.text();

    const match = /url\(([^)]+)\)/.exec(css);
    if (!match?.[1]) return null;
    const fontUrl = match[1].replace(/['"]/g, '');

    const fontResp = await fetch(fontUrl);
    return fontResp.ok ? fontResp.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the font binary for a Google Font and load it into the WASM engine's
 * fontdb so the engine can render that font natively.
 *
 * Strategy:
 * 1. Try TTF directly from google/fonts GitHub via jsDelivr CDN — no decoding
 *    needed, works for all fonts in the repo.
 * 2. Fall back to Google Fonts CSS API → download WOFF2 → WASM decoder handles
 *    it (CFF-based fonts decode cleanly; TrueType falls back to Inter).
 *
 * Falls back silently — if all fetches fail the engine uses its bundled Inter.
 */
export function loadFontBinaryToEngine(family: string, weight: number): void {
  const cacheKey = `${family}:${weight}`;
  if (binaryCache.has(cacheKey)) {
    const engine = getEngine();
    if (!engine) return;
    loadFontData(engine, new Uint8Array(binaryCache.get(cacheKey)!));
    return;
  }

  void (async () => {
    try {
      const buf = await fetchTtfFromGithub(family, weight)
        ?? await fetchFontFromCssApi(family, weight);

      if (!buf) return;

      binaryCache.set(cacheKey, buf);

      const engine = getEngine();
      if (!engine) return;
      loadFontData(engine, new Uint8Array(buf));
    } catch {
      // All fetches failed — engine uses Inter fallback.
    }
  })();
}

export function isFontLoaded(family: string): boolean {
  return document.fonts.check(`16px "${family}"`);
}

export function buildFontFamilyValue(family: string, category: FontCategory): string {
  if (/^[a-zA-Z]+$/.test(family)) {
    return `${family}, ${category}`;
  }
  return `'${family}', ${category}`;
}

export function getPreviewImageUrl(previewFile: string): string {
  return `${PREVIEW_CDN_BASE}${previewFile}`;
}

export function extractFamilyName(cssFontFamily: string): string {
  const first = cssFontFamily.split(',')[0]?.trim() ?? cssFontFamily;
  return first.replace(/['"]/g, '');
}
