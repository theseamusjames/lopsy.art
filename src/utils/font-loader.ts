import type { FontCategory } from './font-catalog';
import { fontsByFamily } from './font-catalog';
import { loadFontData } from '../engine-wasm/wasm-bridge';
import { getEngine } from '../engine-wasm/engine-state';
import { loadPreviewFace } from './font-previews';
import {
  buildCss2StylesheetUrl,
  buildCss2SingleWeightUrl,
  buildCss2PreviewUrl,
  extractFontUrlPreferLatin,
  resolveTtfUrl,
} from './font-urls';

export { prefetchFontPreviewsBlob } from './font-previews';

const loadCache = new Map<string, Promise<void>>();
const previewLoadCache = new Map<string, Promise<void>>();

// Cache of already-fetched font binaries keyed by "family:weight".
// Avoids re-fetching when the user switches back to a previously loaded font.
const binaryCache = new Map<string, ArrayBuffer>();

export function loadGoogleFont(family: string, weights: readonly number[]): Promise<void> {
  const key = family;
  const cached = loadCache.get(key);
  if (cached) return cached;

  const href = buildCss2StylesheetUrl(family, weights);

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
 * Load a preview face for `family` in the DOM — the picker uses this so each
 * row renders its own family name in its own face.
 *
 * Fast path: the family's name-only WOFF2 subset lives in the baked
 * public/font-previews.bin blob (see scripts/generate-font-previews.ts). The
 * runtime fetches that blob once and slices per-family FontFaces out of it,
 * so a single ~4 MB request covers ~1900 fonts and every subsequent row is
 * offline. Slow path: for the handful of families that fail at bake time (or
 * anything not in the catalog) we fall back to the css2 API's `text=` subset
 * so the row still renders.
 */
export function loadGoogleFontPreview(family: string, text: string): Promise<void> {
  const key = `${family}:${text}`;
  const cached = previewLoadCache.get(key);
  if (cached) return cached;
  const fullyLoaded = loadCache.get(family);
  if (fullyLoaded) return fullyLoaded;

  const promise = (async () => {
    const baked = await loadPreviewFace(family);
    if (baked) return;
    // Not in the baked blob — fall back to the css2 text= subset over the
    // network so the picker row still renders in-face.
    await loadCss2Preview(family, text);
  })();

  previewLoadCache.set(key, promise);
  return promise;
}

function loadCss2Preview(family: string, text: string): Promise<void> {
  const href = buildCss2PreviewUrl(family, text);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;

  return new Promise<void>((resolve, reject) => {
    link.onload = () => {
      document.fonts.ready.then(() => resolve());
    };
    link.onerror = () => reject(new Error(`Failed to load font preview: ${family}`));
    document.head.appendChild(link);
  });
}

/**
 * Fetch the family's TTF from the google/fonts GitHub repo via jsDelivr,
 * using the exact path baked into the catalog. Returns null when no path
 * is baked for this weight or the fetch fails (e.g. the baked path went
 * stale after a repo rename) — callers fall back to the css2 API.
 */
async function fetchTtfFromGithub(family: string, weight: number): Promise<ArrayBuffer | null> {
  const entry = fontsByFamily.get(family);
  if (!entry) return null;
  const url = resolveTtfUrl(entry, weight);
  if (!url) return null;
  try {
    const resp = await fetch(url);
    return resp.ok ? resp.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/**
 * Fall back to Google Fonts CSS API: fetch the @font-face CSS, extract the
 * first font URL (WOFF2 in practice), and return its bytes. The WASM engine
 * decodes WOFF2 internally via the brotli-based decoder.
 */
async function fetchFontFromCssApi(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = buildCss2SingleWeightUrl(family, weight);
    const cssResp = await fetch(cssUrl);
    if (!cssResp.ok) return null;
    const css = await cssResp.text();

    const fontUrl = extractFontUrlPreferLatin(css);
    if (!fontUrl) return null;

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
 * 1. Fetch the TTF from the google/fonts GitHub repo via jsDelivr CDN, at
 *    the exact path baked into the catalog — no decoding needed.
 * 2. Fall back to Google Fonts CSS API → download the latin-subset WOFF2 →
 *    the WASM decoder reconstructs it (both TrueType and CFF outlines).
 *
 * Falls back silently — if all fetches fail the engine uses its bundled Inter.
 *
 * Resolves `true` when the font binary had to be freshly fetched and loaded
 * (so callers should re-render text that uses it), and `false` when it was
 * already available in the engine or could not be loaded.
 */
export function loadFontBinaryToEngine(family: string, weight: number): Promise<boolean> {
  const cacheKey = `${family}:${weight}`;
  if (binaryCache.has(cacheKey)) {
    const engine = getEngine();
    if (engine) loadFontData(engine, new Uint8Array(binaryCache.get(cacheKey)!));
    // Already loaded — the caller's immediate render already uses this font.
    return Promise.resolve(false);
  }

  return (async () => {
    try {
      const buf = await fetchTtfFromGithub(family, weight)
        ?? await fetchFontFromCssApi(family, weight);

      if (!buf) return false;

      binaryCache.set(cacheKey, buf);

      const engine = getEngine();
      if (!engine) return false;
      loadFontData(engine, new Uint8Array(buf));
      return true;
    } catch {
      // All fetches failed — engine uses Inter fallback.
      return false;
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

export function extractFamilyName(cssFontFamily: string): string {
  const first = cssFontFamily.split(',')[0]?.trim() ?? cssFontFamily;
  return first.replace(/['"]/g, '');
}
