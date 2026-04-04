import type { Layer } from '../../../types';
import {
  cropToContentBounds,
  expandFromCrop,
} from '../../../engine/canvas-ops';
import { createImageData } from '../../../engine/color-space';

interface CropExpandResult {
  layers: readonly Layer[];
  pixelData: Map<string, ImageData>;
}

/**
 * Crop a raster layer's pixel data to its non-transparent content bounds.
 * Updates the layer's x/y/width/height to match.  Fully transparent layers
 * collapse to 1×1.
 */
export function cropLayerToContent(
  layers: readonly Layer[],
  pixelData: Map<string, ImageData>,
  layerId: string,
): CropExpandResult {
  const layer = layers.find((l) => l.id === layerId);
  const data = pixelData.get(layerId);
  if (!layer || !data || layer.type !== 'raster') {
    return { layers, pixelData };
  }

  const cropped = cropToContentBounds(data);
  if (cropped) {
    const newPixelData = new Map(pixelData);
    newPixelData.set(layerId, cropped.data);
    const newLayers = layers.map((l) =>
      l.id === layerId
        ? { ...l, x: layer.x + cropped.x, y: layer.y + cropped.y, width: cropped.data.width, height: cropped.data.height } as Layer
        : l,
    );
    return { layers: newLayers, pixelData: newPixelData };
  }

  // Fully transparent — collapse to 1x1
  const newPixelData = new Map(pixelData);
  newPixelData.set(layerId, createImageData(1, 1));
  const newLayers = layers.map((l) =>
    l.id === layerId
      ? { ...l, width: 1, height: 1 } as Layer
      : l,
  );
  return { layers: newLayers, pixelData: newPixelData };
}

/**
 * Expand a raster layer's pixel data to full document dimensions,
 * setting x=0, y=0 so tools can paint anywhere on the canvas.
 */
export function expandLayerToDocument(
  layers: readonly Layer[],
  pixelData: Map<string, ImageData>,
  layerId: string,
  docWidth: number,
  docHeight: number,
): CropExpandResult {
  const layer = layers.find((l) => l.id === layerId);
  const data = pixelData.get(layerId);
  if (!layer || !data || layer.type !== 'raster') {
    return { layers, pixelData };
  }

  // Compute union of canvas area and content area so off-canvas content
  // is preserved (non-destructive move).
  const minX = Math.min(0, layer.x);
  const minY = Math.min(0, layer.y);
  const maxX = Math.max(docWidth, layer.x + data.width);
  const maxY = Math.max(docHeight, layer.y + data.height);
  const bufW = maxX - minX;
  const bufH = maxY - minY;

  const expanded = expandFromCrop(data, layer.x - minX, layer.y - minY, bufW, bufH);
  const newPixelData = new Map(pixelData);
  newPixelData.set(layerId, expanded);
  const newLayers = layers.map((l) =>
    l.id === layerId
      ? { ...l, x: minX, y: minY, width: bufW, height: bufH } as Layer
      : l,
  );
  return { layers: newLayers, pixelData: newPixelData };
}

/**
 * Handle an active layer transition: crop the old active layer's pixel data
 * to its content bounds, and expand the new active layer to document size.
 * Either ID may be null (no-op for that side).
 */
export function transitionActiveLayer(
  layers: readonly Layer[],
  pixelData: Map<string, ImageData>,
  oldActiveId: string | null,
  newActiveId: string | null,
  docWidth: number,
  docHeight: number,
): CropExpandResult {
  let result: CropExpandResult = { layers, pixelData };

  if (oldActiveId && oldActiveId !== newActiveId) {
    result = cropLayerToContent(result.layers, result.pixelData, oldActiveId);
  }

  if (newActiveId && newActiveId !== oldActiveId) {
    result = expandLayerToDocument(result.layers, result.pixelData, newActiveId, docWidth, docHeight);
  }

  return result;
}
