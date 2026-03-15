/**
 * Caches ImageBitmap objects derived from layer pixel data.
 *
 * Drawing an ImageBitmap via `ctx.drawImage(bitmap, ...)` gives the browser
 * a single, direct color-managed path from pixel data to display.  This
 * avoids the lossy `putImageData → drawImage` chain where the intermediate
 * canvas can introduce rounding through premultiplied-alpha conversion and
 * color-space re-interpretation.
 */

const cache = new Map<string, ImageBitmap>();
const pending = new Set<string>();

let notifyRender: (() => void) | null = null;

/** Provide a callback the cache will invoke after a bitmap is ready. */
export function setBitmapReadyCallback(cb: () => void): void {
  notifyRender = cb;
}

/** Return the cached bitmap for a layer, or null if not yet available. */
export function getCachedBitmap(layerId: string): ImageBitmap | null {
  return cache.get(layerId) ?? null;
}

/** Schedule an async bitmap build for the given layer's ImageData. */
export function updateBitmapCache(layerId: string, data: ImageData): void {
  if (typeof createImageBitmap === 'undefined') return;

  // Mark any in-flight build as stale so its result is discarded
  pending.delete(layerId);
  pending.add(layerId);

  createImageBitmap(data).then((bitmap) => {
    if (!pending.has(layerId)) {
      bitmap.close();
      return;
    }
    pending.delete(layerId);
    const old = cache.get(layerId);
    if (old) old.close();
    cache.set(layerId, bitmap);
    notifyRender?.();
  });
}

/**
 * Seed the cache with a bitmap built directly from the original image
 * source (File/Blob).  This uses the browser's native image decoder —
 * the same pipeline as `<img>` — so the bitmap preserves the source's
 * full color fidelity without a canvas round-trip.
 */
export function seedBitmapFromBlob(layerId: string, blob: Blob): void {
  if (typeof createImageBitmap === 'undefined') return;

  pending.delete(layerId);
  pending.add(layerId);

  createImageBitmap(blob).then((bitmap) => {
    if (!pending.has(layerId)) {
      bitmap.close();
      return;
    }
    pending.delete(layerId);
    const old = cache.get(layerId);
    if (old) old.close();
    cache.set(layerId, bitmap);
    notifyRender?.();
  });
}

/** Remove a layer's cached bitmap (e.g. when the layer is deleted). */
export function removeBitmapCache(layerId: string): void {
  pending.delete(layerId);
  const old = cache.get(layerId);
  if (old) old.close();
  cache.delete(layerId);
}

/** Clear the entire cache (e.g. when creating a new document). */
export function clearBitmapCache(): void {
  for (const bitmap of cache.values()) bitmap.close();
  cache.clear();
  pending.clear();
}
