/**
 * Browser FontFaces registered from the exact binaries the WASM engine
 * loaded, under an internal alias per family / weight / style.
 *
 * Point text is laid out by the engine from the catalog TTF, while
 * path-bound text is drawn with Canvas2D. Drawing path text with the
 * family's CSS face could pick up a different build of the font (the css2
 * WOFF2) or a locally installed copy that shadows it, so the two kinds of
 * text could draw different glyphs (#1560). Path text names the alias first
 * so Canvas2D uses the engine's bytes whenever they are available.
 */

import { normalizeFamilyName } from './font-face-readiness';

type Listener = (family: string) => void;

const pending = new Set<string>();
const loadedAliases = new Map<string, string>();
const listeners = new Set<Listener>();

function faceKey(family: string, weight: number, isItalic: boolean): string {
  return `${normalizeFamilyName(family)}\0${weight}\0${isItalic ? 'italic' : 'normal'}`;
}

/** The internal family name a registered engine face is installed under. */
export function engineFaceAlias(family: string, weight: number, isItalic: boolean): string {
  const safe = normalizeFamilyName(family).replace(/[^a-z0-9 _-]/g, '');
  return `Lopsy Engine ${safe} ${weight}${isItalic ? ' Italic' : ''}`;
}

/** The alias for a face whose engine binary has loaded in the browser, or null. */
export function loadedEngineFaceAlias(family: string, weight: number, isItalic: boolean): string | null {
  return loadedAliases.get(faceKey(family, weight, isItalic)) ?? null;
}

/**
 * Prefix `fontFamily` (a CSS family list) with the engine face for its first
 * family when one is loaded, so Canvas2D draws the engine's glyphs.
 */
export function withEngineFace(fontFamily: string, weight: number, isItalic: boolean): string {
  const first = fontFamily.split(',')[0];
  if (first === undefined) return fontFamily;
  const alias = loadedEngineFaceAlias(first, weight, isItalic);
  return alias ? `'${alias}', ${fontFamily}` : fontFamily;
}

/** Listen for engine faces becoming usable. Gets the normalized source family. */
export function onEngineFaceLoaded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Install `bytes` (the binary the engine loaded for this face) as a browser
 * FontFace under its alias. A binary the browser cannot parse is dropped and
 * path text keeps drawing with the family's CSS face.
 */
export function registerEngineFontFace(
  family: string,
  weight: number,
  isItalic: boolean,
  bytes: ArrayBuffer,
): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  const key = faceKey(family, weight, isItalic);
  if (pending.has(key) || loadedAliases.has(key)) return;
  pending.add(key);

  const alias = engineFaceAlias(family, weight, isItalic);
  let face: FontFace;
  try {
    face = new FontFace(alias, bytes.slice(0), {
      weight: String(weight),
      style: isItalic ? 'italic' : 'normal',
    });
  } catch {
    pending.delete(key);
    return;
  }
  face.load().then(
    (loaded) => {
      pending.delete(key);
      document.fonts.add(loaded);
      loadedAliases.set(key, alias);
      const source = normalizeFamilyName(family);
      for (const listener of listeners) listener(source);
    },
    () => {
      pending.delete(key);
    },
  );
}

/** For tests: forget every registered face. */
export function resetEngineFontFacesForTests(): void {
  pending.clear();
  loadedAliases.clear();
  listeners.clear();
}
