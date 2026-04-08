declare const __FONT_ASSETS_URL__: string;

const FONT_ASSETS_BASE =
  (typeof __FONT_ASSETS_URL__ !== 'undefined' && __FONT_ASSETS_URL__) ||
  '/font-previews';

export interface GoogleFont {
  family: string;
  category: string;
}

let manifestCache: GoogleFont[] | null = null;
let manifestPromise: Promise<GoogleFont[]> | null = null;

export function getGoogleFontList(): Promise<GoogleFont[]> {
  if (manifestCache) return Promise.resolve(manifestCache);
  if (manifestPromise) return manifestPromise;

  manifestPromise = fetch(`${FONT_ASSETS_BASE}/manifest.json`)
    .then((res) => res.json() as Promise<GoogleFont[]>)
    .then((fonts) => {
      manifestCache = fonts;
      return fonts;
    });

  return manifestPromise;
}

const loadedFonts = new Set<string>();

export function loadGoogleFont(family: string): Promise<void> {
  if (loadedFonts.has(family)) return Promise.resolve();
  loadedFonts.add(family);

  const name = family.replace(/\s+/g, '+');
  const url = `https://fonts.googleapis.com/css2?family=${name}:wght@100..900&display=swap`;

  return new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => {
      document.fonts
        .load(`16px "${family}"`)
        .then(() => resolve())
        .catch(() => resolve());
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

export function getPreviewUrl(family: string): string {
  return `${FONT_ASSETS_BASE}/${family.replace(/\s+/g, '_')}.png`;
}

export function fontFamilyCssValue(family: string, category: string): string {
  const quoted = family.includes(' ') ? `"${family}"` : family;
  return `${quoted}, ${category}`;
}

export function extractFontName(cssValue: string): string {
  const first = cssValue.split(',')[0].trim();
  return first.replace(/^["']|["']$/g, '');
}
