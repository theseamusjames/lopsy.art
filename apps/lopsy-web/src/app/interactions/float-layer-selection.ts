import {
  clearSelection,
  compositeFloat,
  floatSelection,
  setSelectionMask,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { isLayerAlphaSelection } from './layer-alpha-selection';
import { transformLiftMask } from './transform-lift-mask';
import { useEditorStore } from '../editor-store';
import type { Rect } from '../../types';

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
  lastLift = { layerId, wholeLayerRect: isWholeLayer ? layerRect(layerId) : null };
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

/**
 * The most recent lift. Every float is made here, so this always describes
 * the live float when there is one.
 */
let lastLift: { layerId: string; wholeLayerRect: Rect | null } | null = null;

function layerRect(layerId: string): Rect | null {
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  if (layer?.type !== 'raster' || layer.width <= 0 || layer.height <= 0) return null;
  return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

/**
 * The document rect the layer covered when the live float lifted it whole,
 * past the canvas edge included, or null when the float holds a masked lift.
 * A transform of a whole-layer float must carry all of it, not only the part
 * inside the canvas-sized selection box (#1785).
 */
export function wholeLayerFloatRect(layerId: string): Rect | null {
  return lastLift?.layerId === layerId ? lastLift.wholeLayerRect : null;
}
