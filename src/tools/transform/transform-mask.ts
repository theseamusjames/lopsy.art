import type { Rect } from '../../types';
import type { TransformState } from './transform';
import { getTransformedBounds } from './transform';

export function applyTransformToMask(
  originalMask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  state: TransformState,
): { mask: Uint8ClampedArray; bounds: Rect | null } {
  const result = new Uint8ClampedArray(maskWidth * maskHeight);
  const bounds = getTransformedBounds(state);
  const origBounds = state.originalBounds;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const cos = Math.cos(-state.rotation);
  const sin = Math.sin(-state.rotation);
  const tanSkewX = Math.tan(-(state.skewX ?? 0));
  const tanSkewY = Math.tan(-(state.skewY ?? 0));

  // Compute axis-aligned bounding box of the rotated rectangle
  const hw = bounds.width / 2;
  const hh = bounds.height / 2;
  const fwdCos = Math.cos(state.rotation);
  const fwdSin = Math.sin(state.rotation);
  const c0x = cx + (-hw) * fwdCos - (-hh) * fwdSin;
  const c0y = cy + (-hw) * fwdSin + (-hh) * fwdCos;
  const c1x = cx + (hw) * fwdCos - (-hh) * fwdSin;
  const c1y = cy + (hw) * fwdSin + (-hh) * fwdCos;
  const c2x = cx + (hw) * fwdCos - (hh) * fwdSin;
  const c2y = cy + (hw) * fwdSin + (hh) * fwdCos;
  const c3x = cx + (-hw) * fwdCos - (hh) * fwdSin;
  const c3y = cy + (-hw) * fwdSin + (hh) * fwdCos;
  const minX = Math.max(0, Math.floor(Math.min(c0x, c1x, c2x, c3x) - 1));
  const minY = Math.max(0, Math.floor(Math.min(c0y, c1y, c2y, c3y) - 1));
  const maxX = Math.min(maskWidth, Math.ceil(Math.max(c0x, c1x, c2x, c3x) + 1));
  const maxY = Math.min(maskHeight, Math.ceil(Math.max(c0y, c1y, c2y, c3y) + 1));

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      // Un-rotate and un-skew relative to center
      const dx = x - cx;
      const dy = y - cy;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      const ux = cx + rx - ry * tanSkewX;
      const uy = cy + ry - rx * tanSkewY;

      // Map back to original bounds coordinates
      const origX = origBounds.x + ((ux - (cx - bounds.width / 2)) / bounds.width) * origBounds.width;
      const origY = origBounds.y + ((uy - (cy - bounds.height / 2)) / bounds.height) * origBounds.height;

      const ix = Math.round(origX);
      const iy = Math.round(origY);
      if (ix >= 0 && ix < maskWidth && iy >= 0 && iy < maskHeight) {
        const val = originalMask[iy * maskWidth + ix] ?? 0;
        if (val > 0) {
          result[y * maskWidth + x] = val;
        }
      }
    }
  }

  // Compute bounds of result
  let bMinX = maskWidth;
  let bMinY = maskHeight;
  let bMaxX = -1;
  let bMaxY = -1;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if ((result[y * maskWidth + x] ?? 0) > 0) {
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
    }
  }

  const newBounds = bMaxX >= 0
    ? { x: bMinX, y: bMinY, width: bMaxX - bMinX + 1, height: bMaxY - bMinY + 1 }
    : null;

  return { mask: result, bounds: newBounds };
}
