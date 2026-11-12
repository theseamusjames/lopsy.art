import {
  clearSelection,
  compositeFloat,
  floatSelection,
  setSelectionMask,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { isLayerAlphaSelection } from './layer-alpha-selection';

interface FloatableSelection {
  readonly mask: Uint8ClampedArray;
  readonly maskWidth: number;
  readonly maskHeight: number;
}

/**
 * Lift `selection` off `layerId` into the engine's float, composited in place.
 *
 * A selection past a canvas edge is carried on by projecting the edge row or
 * column outwards, which cuts a diagonal shape hanging off the canvas in two.
 * A layer-alpha selection means the whole layer, so it is lifted unmasked:
 * the off-canvas part moves with the rest (#994, #1605). The selection mask
 * is installed on the engine either way, for the tools that clip to it.
 */
export function floatLayerSelection(engine: Engine, layerId: string, selection: FloatableSelection): void {
  const { mask, maskWidth, maskHeight } = selection;
  const maskBytes = new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
  const isWholeLayer = isLayerAlphaSelection(layerId, mask);
  if (isWholeLayer) {
    clearSelection(engine);
  } else {
    setSelectionMask(engine, maskBytes, maskWidth, maskHeight);
  }
  floatSelection(engine, layerId);
  compositeFloat(engine, 0, 0);
  if (isWholeLayer) setSelectionMask(engine, maskBytes, maskWidth, maskHeight);
}
