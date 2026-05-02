import type { FontCategory } from './font-catalog';
import { loadFontData } from '../engine-wasm/wasm-bridge';
import { getEngine } from '../engine-wasm/engine-state';

const PREVIEW_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/getstencil/GoogleWebFonts-FontFamilyPreviewImages@master/48px/compressed/';

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
 * Fetch the TTF binary for a Google Font and load it into the WASM engine's
 * fontdb so the engine can render that font natively.
 *
 * Strategy: fetch the Google Fonts CSS2 API with a non-WOFF2 User-Agent so
 * the response contains TTF `url(...)` entries instead of WOFF2. Parse the
 * first matching URL, fetch the binary, and send it to the engine. Falls back
 * silently — if the fetch fails the engine uses its bundled fallback font.
 */
export function loadFontBinaryToEngine(family: string, weight: number): void {
  const cacheKey = `${family}:${weight}`;
  if (binaryCache.has(cacheKey)) {
    const engine = getEngine();
    if (!engine) return;
    const buf = binaryCache.get(cacheKey)!;
    loadFontData(engine, new Uint8Array(buf));
    return;
  }

  void (async () => {
    try {
      const encoded = encodeURIComponent(family);
      const cssUrl = `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weight}&display=swap`;

      // Fetch with a TTF-requesting UA — Google Fonts returns TTF URLs for
      // older user agents that don't declare WOFF2 support.
      const cssResp = await fetch(cssUrl, {
        headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0)' },
      });
      if (!cssResp.ok) return;
      const css = await cssResp.text();

      // Extract the first url(...) from the CSS response.
      const match = /url\(([^)]+)\)/.exec(css);
      if (!match?.[1]) return;
      const fontUrl = match[1].replace(/['"]/g, '');

      const fontResp = await fetch(fontUrl);
      if (!fontResp.ok) return;
      const buf = await fontResp.arrayBuffer();

      binaryCache.set(cacheKey, buf);

      const engine = getEngine();
      if (!engine) return;
      loadFontData(engine, new Uint8Array(buf));
    } catch {
      // Fetch failed — engine will use fallback font.
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
