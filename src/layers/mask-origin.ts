import type { Layer, Point } from '../types';
import { getDescendantIds } from './group-utils';

/**
 * Document-space position of a layer mask's texel (0, 0). Mirrors
 * `mask_doc_offset` in engine-rs `compositor.rs`, which is where the
 * compositor samples the mask.
 *
 * Raster and group masks are document-anchored (created doc-sized at the
 * origin): a raster layer's x/y moves whenever its texture is cropped to
 * content or expanded for painting, without the content moving, so a mask
 * that followed x/y would drift away from what it was painted over (#850,
 * #907). Shape and text layers keep a stable x/y, and their mask tracks it.
 */
export function getMaskDocOrigin(layer: Layer): Point {
  if (layer.type === 'raster' || layer.type === 'group') return { x: 0, y: 0 };
  return { x: layer.x, y: layer.y };
}

/** Size a newly added mask should have: the document for doc-anchored
 *  masks, the layer's own box for a shape. */
export function getNewMaskSize(
  layer: Layer,
  docWidth: number,
  docHeight: number,
): { width: number; height: number } {
  if (layer.type === 'shape') return { width: layer.width, height: layer.height };
  return { width: docWidth, height: docHeight };
}

/**
 * Ids of the document-anchored masks a whole-layer move of `movedIds` has
 * to carry along: the moved layers themselves and, for a moved group,
 * every descendant, since moving a group moves them all. Text and shape
 * masks already follow `x`/`y` and are left out (#1504).
 */
export function getMasksMovedWithLayers(
  layers: readonly Layer[],
  movedIds: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const id of movedIds) {
    ids.add(id);
    for (const d of getDescendantIds(layers, id)) ids.add(d);
  }
  const result: string[] = [];
  for (const layer of layers) {
    if (!ids.has(layer.id) || !layer.mask) continue;
    if (layer.type !== 'raster' && layer.type !== 'group') continue;
    result.push(layer.id);
  }
  return result;
}
