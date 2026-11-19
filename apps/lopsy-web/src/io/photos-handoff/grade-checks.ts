/** Pure checks for Grade in Photonamous (grade-layer.ts). */

import type { Layer } from '../../types/layers';

/** Whether a layer can be graded: an unlocked raster layer. */
export function canGradeLayer(layer: Layer | undefined): boolean {
  return layer !== undefined && layer.type === 'raster' && !layer.locked;
}

/** The full texture size a 16-bit layer blob describes (its geometry header's `full_w`, `full_h`). */
export function blobSize(blob: Uint8Array): { width: number; height: number } | null {
  if (blob.byteLength < 24) return null;
  const view = new DataView(blob.buffer, blob.byteOffset, 24);
  const width = view.getInt32(16, true);
  const height = view.getInt32(20, true);
  return width > 0 && height > 0 ? { width, height } : null;
}
