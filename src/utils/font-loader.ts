import type { FontCategory } from './font-catalog';

const PREVIEW_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/getstencil/GoogleWebFonts-FontFamilyPreviewImages@master/48px/compressed/';

const loadCache = new Map<string, Promise<void>>();

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
