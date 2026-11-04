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
