import type { Rect } from '../../types';
import type { WholeLayerFloat } from './interaction-types';
import {
  layerAlphaContent,
  layerAlphaContentMask,
  recordLayerAlphaSelection,
  translateLayerAlphaContent,
} from './layer-alpha-selection';

/**
 * What a lift of the selection `mask` off `layerId` carries when it is the
 * layer's alpha selection, which lifts the whole layer (#1605), or undefined
 * for a masked lift. `isLayerOnly` is false when the lift leaves a copy behind.
 */
export function wholeLayerFloatFor(
  layerId: string,
  mask: Uint8ClampedArray,
  isLayerOnly: boolean,
): WholeLayerFloat | undefined {
  const content = layerAlphaContent(layerId, mask);
  return content ? { content, isLayerOnly } : undefined;
}

/**
 * The selection framing a whole-layer float moved by (dx, dy): the layer's
 * alpha at its new place, clipped to the canvas, with bounds that take in
 * the part past the edge too. While the layer holds nothing but the float,
 * the new selection is again the layer's alpha, so a later move or transform
 * lifts the whole layer (#1801).
 */
export function wholeLayerSelectionAt(
  layerId: string,
  whole: WholeLayerFloat,
  dx: number,
  dy: number,
  docW: number,
  docH: number,
): { mask: Uint8ClampedArray; bounds: Rect } {
  const moved = translateLayerAlphaContent(whole.content, dx, dy);
  const selection = layerAlphaContentMask(moved, docW, docH);
  if (whole.isLayerOnly) recordLayerAlphaSelection(layerId, selection.mask, moved);
  return selection;
}
