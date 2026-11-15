import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';

const MAX_SKEW = Math.PI / 3;

/**
 * Which shear a skew handle drives, and which side of the box centre its
 * edge sits on in the box's own (pre-skew) space: `top`/`left` on the
 * negative side, `bottom`/`right` on the positive. Corners drive the
 * horizontal shear of their top or bottom edge.
 */
const SKEW_HANDLES: Partial<Record<TransformHandle, { axis: 'x' | 'y'; side: 1 | -1 }>> = {
  'top': { axis: 'x', side: -1 },
  'top-left': { axis: 'x', side: -1 },
  'top-right': { axis: 'x', side: -1 },
  'bottom': { axis: 'x', side: 1 },
  'bottom-left': { axis: 'x', side: 1 },
  'bottom-right': { axis: 'x', side: 1 },
  'left': { axis: 'y', side: -1 },
  'right': { axis: 'y', side: 1 },
};

function clampSkew(angle: number): number {
  return Math.max(-MAX_SKEW, Math.min(MAX_SKEW, angle));
}

/**
 * Skew from an edge or corner handle so the dragged edge follows the pointer
 * 1:1 along the edge while the opposite edge stays pinned.
 *
 * The shear is applied about the box centre (`x' = x + y·tan(skewX)`, then
 * scale), so a change of `Δtan` slides the edge at `y = side·hh` by
 * `side·hh·Δtan·scaleX` and the opposite edge by the negative of that.
 * Pinning the opposite edge with a translate makes the dragged edge travel
 * `2·side·hh·Δtan·scaleX`, which is solved for `Δtan` from the pointer delta.
 * The vertical shear is the same with `hw`, `scaleY` and `tan(skewY)`.
 * Accumulating tangents rather than angles keeps a drag that starts from an
 * already-skewed box linear in the pointer.
 */
export function computeSkew(
  handle: TransformHandle,
  startPoint: Point,
  currentPoint: Point,
  state: TransformState,
): { skewX: number; skewY: number; translateX: number; translateY: number } {
  const unchanged = {
    skewX: state.skewX,
    skewY: state.skewY,
    translateX: state.translateX,
    translateY: state.translateY,
  };
  const spec = SKEW_HANDLES[handle];
  if (!spec) return unchanged;

  // Pointer delta in the box's own, un-rotated axes.
  const cos = Math.cos(-state.rotation);
  const sin = Math.sin(-state.rotation);
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  const deltaX = dx * cos - dy * sin;
  const deltaY = dx * sin + dy * cos;

  const { side } = spec;
  const hw = state.originalBounds.width / 2;
  const hh = state.originalBounds.height / 2;

  let skewX = state.skewX;
  let skewY = state.skewY;
  let compX = 0;
  let compY = 0;

  if (spec.axis === 'x') {
    const travelPerTan = 2 * hh * state.scaleX;
    if (Math.abs(travelPerTan) < 1e-9) return unchanged;
    const oldTan = Math.tan(state.skewX);
    skewX = clampSkew(Math.atan(oldTan + (side * deltaX) / travelPerTan));
    compX = side * hh * (Math.tan(skewX) - oldTan) * state.scaleX;
  } else {
    const travelPerTan = 2 * hw * state.scaleY;
    if (Math.abs(travelPerTan) < 1e-9) return unchanged;
    const oldTan = Math.tan(state.skewY);
    skewY = clampSkew(Math.atan(oldTan + (side * deltaY) / travelPerTan));
    compY = side * hw * (Math.tan(skewY) - oldTan) * state.scaleY;
  }

  // translateX/Y are applied after rotation, so rotate the compensation forward.
  const fwdCos = Math.cos(state.rotation);
  const fwdSin = Math.sin(state.rotation);
  return {
    skewX,
    skewY,
    translateX: state.translateX + compX * fwdCos - compY * fwdSin,
    translateY: state.translateY + compX * fwdSin + compY * fwdCos,
  };
}
