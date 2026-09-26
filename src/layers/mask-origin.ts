import type { Layer, Point } from '../types';

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
