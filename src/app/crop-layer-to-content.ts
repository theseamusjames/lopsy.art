import type { Rect } from '../types';
import type { Engine } from '../engine-wasm/wasm-bridge';
import { cropLayerToContent as wasmCropLayerToContent } from '../engine-wasm/wasm-bridge';
import {
  noteLayerCroppedToContent,
  peekLayerContentRectLocal,
  readLayerContentRectLocal,
} from './layer-content-rect';

/**
 * A raster layer's bounds after a crop to its content: `[x, y, width,
 * height]`. Empty when the layer has no content or the engine refused.
 */
export type CroppedBounds = ArrayLike<number>;

function cropTo(engine: Engine, layerId: string, content: Rect | null): CroppedBounds {
  if (!content) return [];
  const bounds = wasmCropLayerToContent(engine, layerId, content.x, content.y, content.width, content.height);
  const width = bounds[2] ?? 0;
  const height = bounds[3] ?? 0;
  if (bounds.length === 4 && width > 0 && height > 0) {
    noteLayerCroppedToContent(engine, layerId, width, height);
  }
  return bounds;
}

/**
 * Crop a raster layer's GPU texture to its content, without reading
 * anything, when the content bounds are already known for the pixels it
 * holds now. Undefined when they are not: they are then being read, and the
 * caller either goes without the crop or awaits `cropLayerToContent`.
 */
export function cropLayerToContentIfMeasured(engine: Engine, layerId: string): CroppedBounds | undefined {
  const content = peekLayerContentRectLocal(engine, layerId);
  return content === undefined ? undefined : cropTo(engine, layerId, content);
}

/**
 * Crop a raster layer's GPU texture to its content, reading the content
 * bounds first when they are not known. If the layer is written again
 * while they are read, nothing is cropped.
 */
export async function cropLayerToContent(engine: Engine, layerId: string): Promise<CroppedBounds> {
  await readLayerContentRectLocal(engine, layerId);
  return cropLayerToContentIfMeasured(engine, layerId) ?? [];
}
