import type { Rect } from '../../types';

export interface TranslatedMask {
  mask: Uint8ClampedArray;
  bounds: Rect;
}

/**
 * Shift a selection mask + bounds by (dx, dy) in document space. Returns a
 * new buffer the same size as the document; pixels that fall outside the
 * document are dropped. Used for moving a marquee in quick-mask mode
 * alongside translateQuickMaskContent (issue #315).
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
 * Translate the painted region of a quick-mask texture by (dx, dy) in
 * document space (issue #315).
 *
 * `origPixels` is the full quick-mask texture as a single-channel doc-sized
 * buffer (255 = selected, 0 = unselected). `marqueeMask` is the selection
 * marquee defining which region moves. Pixels covered by the marquee are
 * cut from their original location and pasted at the offset position;
 * pixels outside the marquee are left untouched. Marquee pixels that land
 * outside the document are dropped.
 *
 * Returns a new buffer the same size as `origPixels`. Does not mutate the
 * input.
 */
export function translateQuickMaskContent(
  origPixels: Uint8Array,
  marqueeMask: Uint8ClampedArray,
  dx: number,
  dy: number,
  docW: number,
  docH: number,
): Uint8Array {
  const out = new Uint8Array(origPixels);

  // 1) Clear the original marquee region.
  for (let i = 0; i < marqueeMask.length; i++) {
    if (marqueeMask[i]! > 0) out[i] = 0;
  }

  // 2) Paste the original marquee content at (x+dx, y+dy).
  for (let y = 0; y < docH; y++) {
    const dstY = y + dy;
    if (dstY < 0 || dstY >= docH) continue;
    const srcRow = y * docW;
    const dstRow = dstY * docW;
    for (let x = 0; x < docW; x++) {
      const dstX = x + dx;
      if (dstX < 0 || dstX >= docW) continue;
      if (marqueeMask[srcRow + x]! > 0) {
        const src = origPixels[srcRow + x]!;
        const cur = out[dstRow + dstX]!;
        out[dstRow + dstX] = src > cur ? src : cur;
      }
    }
  }

  return out;
}
