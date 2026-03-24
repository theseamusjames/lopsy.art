/**
 * GPU Pixel Access — wraps WASM readback functions with per-frame caching.
 *
 * Multiple callers in the same frame get the cached result from readLayerAsImageData.
 * Compressed readback and upload are uncached (used for undo snapshots).
 */

import {
  readLayerPixels,
  getLayerTextureDimensions,
  readLayerPixelsCompressed,
  uploadLayerPixelsCompressed,
  readLayerThumbnail as wasmReadLayerThumbnail,
} from './wasm-bridge';
import type { Engine } from './wasm-bridge';

// Per-frame cache for readLayerAsImageData
const frameCache = new Map<string, ImageData | null>();
let currentEngine: Engine | null = null;

export function setEngine(engine: Engine): void {
  currentEngine = engine;
}

/**
 * Read a layer's GPU texture as ImageData.
 * Results are cached per frame — call clearFrameCache() at the start of each render frame.
 */
export function readLayerAsImageData(layerId: string): ImageData | null {
  if (!currentEngine) return null;

  const cached = frameCache.get(layerId);
  if (cached !== undefined) return cached;

  const dims = getLayerTextureDimensions(currentEngine, layerId);
  const width = dims?.[0] ?? 0;
  const height = dims?.[1] ?? 0;
  if (width === 0 || height === 0) {
    frameCache.set(layerId, null);
    return null;
  }
  const pixels = readLayerPixels(currentEngine, layerId);
  if (!pixels || pixels.length === 0) {
    frameCache.set(layerId, null);
    return null;
  }

  const clamped = new Uint8ClampedArray(width * height * 4);
  clamped.set(pixels);
  const imageData = new ImageData(clamped, width, height);
  frameCache.set(layerId, imageData);
  return imageData;
}

/**
 * Read layer pixels as a compressed blob (header + RLE data).
 * Not cached — used for undo snapshots, called once per pushHistory.
 */
export function readLayerCompressed(layerId: string): Uint8Array | null {
  if (!currentEngine) return null;

  const data = readLayerPixelsCompressed(currentEngine, layerId);
  if (!data || data.length === 0) return null;

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Upload a compressed pixel blob to a layer's GPU texture.
 */
export function uploadCompressed(layerId: string, data: Uint8Array): void {
  if (!currentEngine) return;
  uploadLayerPixelsCompressed(currentEngine, layerId, data);
}

/**
 * Read a layer's GPU texture as a downscaled thumbnail ImageData.
 */
export function readLayerThumbnail(layerId: string, maxSize: number): ImageData | null {
  if (!currentEngine) return null;

  const result = wasmReadLayerThumbnail(currentEngine, layerId, maxSize);
  if (!result || result.length < 8) return null;

  // The WASM function prepends an 8-byte header: [tw: u32 LE, th: u32 LE]
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  const tw = view.getUint32(0, true);
  const th = view.getUint32(4, true);

  if (tw === 0 || th === 0) return null;

  const pixelData = new Uint8ClampedArray(tw * th * 4);
  pixelData.set(new Uint8Array(result.buffer, result.byteOffset + 8, tw * th * 4));

  return new ImageData(pixelData, tw, th);
}

/**
 * Clear the per-frame readback cache.
 * Call at the start of each render frame.
 */
export function clearFrameCache(): void {
  frameCache.clear();
}
