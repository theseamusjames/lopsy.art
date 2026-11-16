import {
  clearSelection,
  compositeFloat,
  floatSelection,
  setSelectionMask,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { isLayerAlphaSelection } from './layer-alpha-selection';
import { transformLiftMask } from './transform-lift-mask';

interface FloatableSelection {
  readonly mask: Uint8ClampedArray;
  readonly maskWidth: number;
  readonly maskHeight: number;
}

function bytesOf(mask: Uint8ClampedArray): Uint8Array {
  return new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength);
}

/**
 * Lift `selection` off `layerId` into the engine's float, composited in place.
 *
 * A selection past a canvas edge is carried on by projecting the edge row or
 * column outwards, which cuts a diagonal shape hanging off the canvas in two.
 * A layer-alpha selection means the whole layer, so it is lifted unmasked:
 * the off-canvas part moves with the rest (#994, #1605). A selection carried
 * through a scale or rotate is lifted through its lift mask, which takes the
 * resampled edge whole (#1675). The selection mask is installed on the
 * engine afterwards either way, for the tools that clip to it.
 */
export function floatLayerSelection(engine: Engine, layerId: string, selection: FloatableSelection): void {
  const { mask, maskWidth, maskHeight } = selection;
  const isWholeLayer = isLayerAlphaSelection(layerId, mask);
  const liftMask = isWholeLayer ? null : transformLiftMask(layerId, mask);
  if (isWholeLayer) {
    clearSelection(engine);
  } else {
    setSelectionMask(engine, bytesOf(liftMask ?? mask), maskWidth, maskHeight);
  }
  floatSelection(engine, layerId);
  compositeFloat(engine, 0, 0);
  if (isWholeLayer || liftMask) setSelectionMask(engine, bytesOf(mask), maskWidth, maskHeight);
}
