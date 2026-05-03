import {
  readLayerPixels,
  getLayerTextureDimensions,
  uploadLayerPixels,
} from '../engine-wasm/wasm-bridge';
import { applyTileOffsetPixels } from './tile-offset';
import type { FilterDefinition } from './filter-types';

/**
 * Tile/Offset GPU filter.
 *
 * Since no WASM shader exists for this, the filter reads the layer texture
 * into JS, applies the offset via CPU, then uploads the result back to the
 * GPU. The layer position (x, y) in the document is preserved — the texture
 * is replaced in-place at the same origin.
 *
 * Params:
 *   offsetX — horizontal shift in pixels (negative = shift left)
 *   offsetY — vertical shift in pixels (negative = shift up)
 *   wrap    — 0 = fill exposed edges with transparent, 1 = wrap around
 */
export const tileOffset: FilterDefinition = {
  id: 'tile-offset',
  title: 'Offset',
  params: [
    {
      key: 'offsetX',
      label: 'Horizontal Offset',
      min: -4096,
      max: 4096,
      step: 1,
      defaultValue: 0,
    },
    {
      key: 'offsetY',
      label: 'Vertical Offset',
      min: -4096,
      max: 4096,
      step: 1,
      defaultValue: 0,
    },
    {
      key: 'wrap',
      label: 'Wrap Around',
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 1,
    },
  ],
  applyGpu: (engine, layerId, values) => {
    let dims: Uint32Array;
    try {
      dims = getLayerTextureDimensions(engine, layerId);
    } catch {
      return;
    }
    const width = dims[0] ?? 0;
    const height = dims[1] ?? 0;
    if (width === 0 || height === 0) return;

    const pixels = readLayerPixels(engine, layerId);
    if (!pixels || pixels.length === 0) return;

    const offsetX = values['offsetX'] ?? 0;
    const offsetY = values['offsetY'] ?? 0;
    const wrap = (values['wrap'] ?? 1) >= 0.5;

    const result = applyTileOffsetPixels(
      new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      width,
      height,
      offsetX,
      offsetY,
      wrap,
    );

    uploadLayerPixels(engine, layerId, result, width, height, 0, 0);
  },
};
