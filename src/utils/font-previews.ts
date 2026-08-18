/**
 * Runtime loader for the baked font-preview blob (public/font-previews.bin).
 *
 * The FontPicker used to fetch preview PNGs from a third-party CDN that has
 * since been deleted. To avoid another external dependency, we bake every
 * Google-source family's name-only WOFF2 subset into one blob at build time
 * (see scripts/generate-font-previews.ts) and register a per-family FontFace
 * on demand at runtime.
 *
 * Flow:
 *   1. First call to `loadPreviewFace(family)` kicks off `fetchBlob()`, which
 *      requests the blob once and caches the promise so concurrent callers
 *      share the same request.
 *   2. Each family look-up slices the requested subset out of the blob and
 *      registers a new FontFace, keyed by family so repeat calls no-op.
 *   3. Once the FontFace is `.load()`-ed and added to `document.fonts`, the
 *      browser re-renders any element already using that family — the picker
 *      row updates from the category fallback to the real face automatically.
 *
 * Families missing from the index (a handful failed to fetch at bake time —
 * see scripts/generate-font-previews.ts logs) resolve to null; callers should
 * fall back to css2 in that case.
 */

import { FONT_PREVIEWS_INDEX } from './font-previews-index';

const BLOB_URL = '/font-previews.bin';

let blobPromise: Promise<ArrayBuffer> | null = null;
const registeredFaces = new Map<string, Promise<FontFace | null>>();

function fetchBlob(): Promise<ArrayBuffer> {
  if (!blobPromise) {
    blobPromise = fetch(BLOB_URL)
      .then((resp) => {
        if (!resp.ok) throw new Error(`font-previews.bin: HTTP ${resp.status}`);
        return resp.arrayBuffer();
      })
      .catch((err) => {
        // Reset so a later call can retry from a fresh page state.
        blobPromise = null;
        throw err;
      });
  }
  return blobPromise;
}

/**
 * Kick off the blob fetch without blocking the caller. Safe to call at
 * app startup — subsequent `loadPreviewFace` calls reuse the same promise.
 */
export function prefetchFontPreviewsBlob(): void {
  fetchBlob().catch(() => {
    // Prefetch is best-effort; loadPreviewFace surfaces real failures.
  });
}

/**
 * Register `family`'s preview subset with `document.fonts` and resolve once
 * the browser has it loaded, so text using that family re-renders in-face.
 * Resolves null when the family isn't baked (call sites should fall back to
 * the css2 network path) or when the blob failed to fetch.
 */
export function loadPreviewFace(family: string): Promise<FontFace | null> {
  const cached = registeredFaces.get(family);
  if (cached) return cached;

  const slice = FONT_PREVIEWS_INDEX[family];
  if (!slice) {
    const missing = Promise.resolve<FontFace | null>(null);
    registeredFaces.set(family, missing);
    return missing;
  }

  const promise = (async (): Promise<FontFace | null> => {
    try {
      const blob = await fetchBlob();
      const bytes = new Uint8Array(blob, slice.offset, slice.length);
      const face = new FontFace(family, bytes);
      await face.load();
      document.fonts.add(face);
      return face;
    } catch {
      // Retry-able: drop the cache entry so the next call tries again once
      // the blob (or the FontFace API) is available.
      registeredFaces.delete(family);
      return null;
    }
  })();
  registeredFaces.set(family, promise);
  return promise;
}

/** For tests: forget the blob fetch and every registered face. */
export function resetFontPreviewsForTests(): void {
  blobPromise = null;
  registeredFaces.clear();
}
