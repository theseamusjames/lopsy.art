/**
 * Caches ImageBitmap objects derived from layer pixel data.
 *
 * Drawing an ImageBitmap via `ctx.drawImage(bitmap, ...)` gives the browser
 * a single, direct color-managed path from pixel data to display.  This
 * avoids the lossy `putImageData → drawImage` chain where the intermediate
 * canvas can introduce rounding through premultiplied-alpha conversion and
 * color-space re-interpretation.
 */

import { contextOptions } from './color-space';
import { markLayerGpuDirty } from '../engine-wasm/gpu-dirty';

const cache = new Map<string, ImageBitmap>();
const pending = new Set<string>();

let notifyRender: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Painting canvas — persistent off-screen canvas for the active stroke.
// Avoids re-uploading the entire layer via putImageData each frame.
// Only the dirty region (brush dab area) gets updated per frame.
// ---------------------------------------------------------------------------
interface PaintingCanvasEntry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
const paintingCanvases = new Map<string, PaintingCanvasEntry>();

interface DirtyRect {
  x: number;
  y: number;
  x2: number;
  y2: number;
}
const dirtyRects = new Map<string, DirtyRect>();

/** Mark a region as dirty during painting. Called by brush/eraser dab functions. */
export function markPaintDirty(layerId: string, x: number, y: number, w: number, h: number): void {
  const existing = dirtyRects.get(layerId);
  if (existing) {
    existing.x = Math.min(existing.x, x);
    existing.y = Math.min(existing.y, y);
    existing.x2 = Math.max(existing.x2, x + w);
    existing.y2 = Math.max(existing.y2, y + h);
  } else {
    dirtyRects.set(layerId, { x, y, x2: x + w, y2: y + h });
  }
  // Also mark for GPU texture re-upload (WASM engine)
  markLayerGpuDirty(layerId);
}

/**
 * Get the painting canvas for a layer. If one exists but the dirty rect
 * needs updating, applies the dirty region from the source ImageData.
 * Returns null if no painting canvas exists (layer not being painted).
 */
export function getPaintingCanvas(
  layerId: string,
  imageData: ImageData,
): HTMLCanvasElement | null {
  const entry = paintingCanvases.get(layerId);
  if (!entry) return null;

  const dirty = dirtyRects.get(layerId);
  if (dirty) {
    // Clamp to canvas bounds
    const dx = Math.max(0, Math.floor(dirty.x));
    const dy = Math.max(0, Math.floor(dirty.y));
    const dx2 = Math.min(imageData.width, Math.ceil(dirty.x2));
    const dy2 = Math.min(imageData.height, Math.ceil(dirty.y2));
    const dw = dx2 - dx;
    const dh = dy2 - dy;
    if (dw > 0 && dh > 0) {
      entry.ctx.putImageData(imageData, 0, 0, dx, dy, dw, dh);
    }
    dirtyRects.delete(layerId);
  }

  return entry.canvas;
}

/** Create a painting canvas with full initial content. Called at stroke start. */
export function createPaintingCanvas(layerId: string, imageData: ImageData): void {
  let entry = paintingCanvases.get(layerId);
  if (!entry) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', contextOptions);
    if (!ctx) return;
    entry = { canvas, ctx };
    paintingCanvases.set(layerId, entry);
  }
  entry.canvas.width = imageData.width;
  entry.canvas.height = imageData.height;
  entry.ctx.putImageData(imageData, 0, 0);
  dirtyRects.delete(layerId);
}

/** Destroy the painting canvas. Called at stroke end. */
export function destroyPaintingCanvas(layerId: string): void {
  paintingCanvases.delete(layerId);
  dirtyRects.delete(layerId);
}

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

/** Invalidate a layer's bitmap without scheduling a rebuild.
 *  Used at stroke start so the renderer falls through to putImageData
 *  while painting, avoiding expensive createImageBitmap per move. */
export function invalidateBitmapCache(layerId: string): void {
  pending.delete(layerId);
  const old = cache.get(layerId);
  if (old) old.close();
  cache.delete(layerId);
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
