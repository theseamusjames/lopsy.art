/**
 * Object URLs for previews, in two small LRUs (grid thumbnails and the
 * 2048 px screen previews). Evicted URLs are revoked, so memory stays
 * bounded however far the grid scrolls.
 */

import type { LibrarySession, PreviewRef } from '@lopsy/photos-core/library/types';
import { LruCache } from '../library/lru';
import { getBackend } from './backend-registry';

type Size = 'thumb' | 'screen';

const caches: Record<Size, LruCache<string, string>> = {
  thumb: new LruCache<string, string>(900, (_k, url) => URL.revokeObjectURL(url)),
  screen: new LruCache<string, string>(16, (_k, url) => URL.revokeObjectURL(url)),
};
const inFlight = new Map<string, Promise<string>>();

export function previewKey(ref: PreviewRef): string {
  return `${ref.fileId}|${ref.recipeHash}`;
}

/** A cached URL, without loading. */
export function peekPreviewUrl(size: Size, ref: PreviewRef): string | undefined {
  return caches[size].get(previewKey(ref));
}

export function loadPreviewUrl(session: LibrarySession, size: Size, ref: PreviewRef): Promise<string> {
  const key = previewKey(ref);
  const cached = caches[size].get(key);
  if (cached) return Promise.resolve(cached);
  const flightKey = `${size}|${key}`;
  const pending = inFlight.get(flightKey);
  if (pending) return pending;
  const promise = getBackend()
    .readPreview(session, ref)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      caches[size].set(key, url);
      return url;
    })
    .finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, promise);
  return promise;
}

export function clearPreviewCache(): void {
  caches.thumb.clear();
  caches.screen.clear();
  inFlight.clear();
}
