/**
 * Helpers for Canvas2D text that must be redrawn once its web font arrives.
 *
 * Canvas `fillText` never waits for a font: while a face is still loading it
 * draws with the fallback face and nothing redraws it later. Callers that
 * cache rendered text (path-bound text layers) use these to find out when the
 * faces a render depended on finish loading.
 */

/** Normalize a family name for comparison: unquoted, trimmed, lower-case. */
export function normalizeFamilyName(family: string): string {
  return family.trim().replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase();
}

/** The normalized family names in a CSS `font-family` list. */
export function parseFontFamilyList(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map(normalizeFamilyName)
    .filter((name) => name.length > 0);
}

function fontFaceSet(): FontFaceSet | null {
  if (typeof document === 'undefined') return null;
  return document.fonts ?? null;
}

const requestedLoads = new Set<string>();

/**
 * Returns true when every face `font` needs to draw `text` is loaded.
 * Otherwise asks the browser to load them and calls `onSettled` once the
 * load finishes (or fails). Each font/text pair is requested only once, so a
 * face that fails to load cannot trigger an endless redraw loop.
 */
export function ensureFontFacesLoaded(font: string, text: string, onSettled: () => void): boolean {
  const fonts = fontFaceSet();
  if (!fonts) return true;
  try {
    if (fonts.check(font, text)) return true;
  } catch {
    return true;
  }
  const key = `${font}\0${text}`;
  if (requestedLoads.has(key)) return false;
  requestedLoads.add(key);
  fonts.load(font, text).then(onSettled, onSettled);
  return false;
}

/**
 * Subscribe to font faces finishing loading anywhere in the document (a
 * stylesheet's @font-face, a FontFace added from script). The listener gets
 * the normalized family of every face in the batch. Returns an unsubscribe.
 */
export function onFontFacesLoaded(listener: (families: string[]) => void): () => void {
  const fonts = fontFaceSet();
  if (!fonts) return () => undefined;
  const handleLoadingDone = (event: FontFaceSetLoadEvent) => {
    const families = event.fontfaces.map((face) => normalizeFamilyName(face.family));
    if (families.length > 0) listener(families);
  };
  fonts.addEventListener('loadingdone', handleLoadingDone);
  return () => fonts.removeEventListener('loadingdone', handleLoadingDone);
}

/** For tests: forget which font loads were already requested. */
export function resetFontFaceReadinessForTests(): void {
  requestedLoads.clear();
}
