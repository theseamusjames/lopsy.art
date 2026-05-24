import type { Rect } from '../../types';

export interface TranslatedMask {
  mask: Uint8ClampedArray;
  bounds: Rect;
}

/**
 * Shift a selection mask + bounds by (dx, dy) in document space. Returns a
 * new buffer the same size as the document; pixels that fall outside the
 * document are dropped. Used for moving a marquee in quick-mask mode, where
 * we can't float pixels on the GPU (issue #315) and must keep the layer
 * texture untouched.
 */
export function translateSelectionMask(
  origMask: Uint8ClampedArray,
  origBounds: Rect,
  dx: number,
  dy: number,
  docW: number,
  docH: number,
): TranslatedMask {
  const newMask = new Uint8ClampedArray(docW * docH);
  for (let y = 0; y < docH; y++) {
    const srcY = y - dy;
    if (srcY < 0 || srcY >= docH) continue;
    const dstRow = y * docW;
    const srcRow = srcY * docW;
    for (let x = 0; x < docW; x++) {
      const srcX = x - dx;
      if (srcX < 0 || srcX >= docW) continue;
      newMask[dstRow + x] = origMask[srcRow + srcX] ?? 0;
    }
  }
  return {
    mask: newMask,
    bounds: {
      x: origBounds.x + dx,
      y: origBounds.y + dy,
      width: origBounds.width,
      height: origBounds.height,
    },
  };
}

/**
 * Translate the painted quick-mask pixels by (dx, dy) inside the marquee.
 *
 * Used by the move tool when in quick-mask mode with an active marquee. The
 * marquee defines which painted-mask pixels move; pixels outside the marquee
 * stay put. Pixels under the original marquee position are cleared, and the
 * moved content is placed at the offset position using max-blend so it adds
 * to (rather than replaces) any existing painted content it lands on.
 *
 * Inputs:
 * - `origPixels`: full quick-mask snapshot at drag-start (single-channel,
 *   `docW * docH` bytes, 0 = unselected, 255 = fully selected).
 * - `marqueeMask`: marquee selection mask at drag-start (same size). Any
 *   non-zero value marks a pixel as "inside the marquee".
 * - `dx`, `dy`: integer offset in document pixels.
 * - `docW`, `docH`: document size.
 *
 * Returns a new `Uint8Array` of the same size, suitable for upload via
 * `uploadQuickMaskPixels`.
 */
export function translateQuickMaskContent(
  origPixels: Uint8Array,
  marqueeMask: Uint8ClampedArray,
  dx: number,
  dy: number,
  docW: number,
  docH: number,
): Uint8Array {
  const total = docW * docH;
  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    out[i] = (marqueeMask[i] ?? 0) > 0 ? 0 : origPixels[i] ?? 0;
  }
  for (let y = 0; y < docH; y++) {
    const srcY = y - dy;
    if (srcY < 0 || srcY >= docH) continue;
    const dstRow = y * docW;
    const srcRow = srcY * docW;
    for (let x = 0; x < docW; x++) {
      const srcX = x - dx;
      if (srcX < 0 || srcX >= docW) continue;
      const srcIdx = srcRow + srcX;
      if ((marqueeMask[srcIdx] ?? 0) > 0) {
        const dstIdx = dstRow + x;
        const v = origPixels[srcIdx] ?? 0;
        if (v > out[dstIdx]!) out[dstIdx] = v;
      }
    }
  }
  return out;
}
