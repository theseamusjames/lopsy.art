// Pure URL construction for font loading. No DOM, no engine imports —
// shared by the app (font-loader.ts) and by scripts/check-font-loading.ts,
// which verifies every catalog font against these exact URLs. Keeping the
// URL logic here guarantees the checker probes what the app actually loads.

import type { FontEntry } from './font-catalog';

const PREVIEW_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/getstencil/GoogleWebFonts-FontFamilyPreviewImages@master/48px/compressed/';

// jsDelivr CDN for the google/fonts GitHub repo (raw TTF files).
const GOOGLE_FONTS_GH_CDN = 'https://cdn.jsdelivr.net/gh/google/fonts@main';

/** Stylesheet URL used by loadGoogleFont() to load a family into the DOM. */
export function buildCss2StylesheetUrl(family: string, weights: readonly number[]): string {
  const weightsStr = weights.join(';');
  const encoded = encodeURIComponent(family);
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weightsStr}&display=swap`;
}

/** Single-weight CSS URL used by the engine's CSS-API fallback. */
export function buildCss2SingleWeightUrl(family: string, weight: number): string {
  const encoded = encodeURIComponent(family);
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@${weight}&display=swap`;
}

/**
 * URL of the TTF that serves this family at this weight, from the paths
 * baked into the catalog at generation time (see
 * scripts/generate-font-catalog.ts and font-ttf-resolution.ts).
 *
 * Null means no repo file serves this weight — the family is not in the
 * google/fonts repo, its dir is ambiguous, its file exceeds jsDelivr's
 * 20 MB limit, or a static family lacks this weight. Callers then use the
 * css2 API fallback.
 *
 * Paths are baked rather than derived at runtime because many families'
 * repo filenames follow no derivable convention (Roboto[wdth,wght].ttf,
 * PT_Sans-Web-Regular.ttf, PTM55FT.ttf, …) — guessing requires a waterfall
 * of speculative requests and still misses hundreds of families (#665).
 */
export function resolveTtfUrl(entry: FontEntry, weight: number): string | null {
  if (!entry.ttfDir) return null;
  const file = entry.ttfFile ?? entry.ttfWeightFiles?.[weight] ?? null;
  if (!file) return null;
  return `${GOOGLE_FONTS_GH_CDN}/${entry.ttfDir}/${file}`;
}

/**
 * Extract the first font URL from a css2 response. Note this is the FIRST
 * @font-face block, which for multi-subset fonts is not necessarily latin.
 */
export function extractFirstFontUrl(css: string): string | null {
  const match = /url\(([^)]+)\)/.exec(css);
  if (!match?.[1]) return null;
  return match[1].replace(/['"]/g, '');
}

/**
 * Extract the font URL the engine should load from a css2 response.
 *
 * css2 emits one @font-face block per unicode-range subset, each preceded
 * by a subset name comment ("latin", "cyrillic-ext", …), and lists
 * non-latin subsets FIRST. Taking the first url() therefore
 * yields a binary with no A–Z glyphs for most multi-subset families, and
 * the engine silently renders Inter instead. Prefer the latin block, then
 * latin-ext; fall back to the first url() for responses without labelled
 * subsets (single-subset fonts, CJK numbered slices).
 */
export function extractFontUrlPreferLatin(css: string): string | null {
  const blocks = [...css.matchAll(/\/\*\s*([\w[\]-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
  for (const preferred of ['latin', 'latin-ext']) {
    const block = blocks.find((b) => b[1] === preferred);
    const url = block?.[2] ? extractFirstFontUrl(block[2]) : null;
    if (url) return url;
  }
  return extractFirstFontUrl(css);
}

export function getPreviewImageUrl(previewFile: string): string {
  return `${PREVIEW_CDN_BASE}${previewFile}`;
}
