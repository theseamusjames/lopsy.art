import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';
import { getTransformedBounds } from './transform';

export function computeSkew(
  handle: TransformHandle,
  startPoint: Point,
  currentPoint: Point,
  state: TransformState,
): { skewX: number; skewY: number; translateX: number; translateY: number } {
  const bounds = getTransformedBounds(state);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  const cos = Math.cos(-state.rotation);
  const sin = Math.sin(-state.rotation);

  function unrotate(p: Point): Point {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  const startUR = unrotate(startPoint);
  const currentUR = unrotate(currentPoint);
  const deltaX = currentUR.x - startUR.x;
  const deltaY = currentUR.y - startUR.y;

  let skewX = state.skewX;
  let skewY = state.skewY;

  const origHW = state.originalBounds.width / 2;
  const origHH = state.originalBounds.height / 2;
  const hw = bounds.width / 2;
  const hh = bounds.height / 2;

  // Track which edge should stay fixed for translate compensation
  // +1 = bottom/right fixed, -1 = top/left fixed, 0 = center (no compensation)
  let pinY = 0;
  let pinX = 0;

  switch (handle) {
    case 'top':
      skewX = state.skewX + Math.atan2(deltaX, hh);
      pinY = 1; // bottom stays fixed
      break;
    case 'bottom':
      skewX = state.skewX + Math.atan2(deltaX, hh);
      pinY = -1; // top stays fixed
      break;
    case 'left':
      skewY = state.skewY + Math.atan2(deltaY, hw);
      pinX = 1; // right stays fixed
      break;
    case 'right':
      skewY = state.skewY + Math.atan2(deltaY, hw);
      pinX = -1; // left stays fixed
      break;
    case 'top-left':
    case 'top-right':
      skewX = state.skewX + Math.atan2(deltaX, hh);
      pinY = 1; // bottom stays fixed
      break;
    case 'bottom-left':
    case 'bottom-right':
      skewX = state.skewX + Math.atan2(deltaX, hh);
      pinY = -1; // top stays fixed
      break;
  }

  skewX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, skewX));
  skewY = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, skewY));

  // Compensate translate so the pinned edge stays fixed.
  // Skew is applied relative to center: x' = x + y*tan(skewX).
  // The pinned edge at y = pinY * origHH should not move, so add
  // a pre-rotation offset to cancel the skew shift at that edge.
  const oldTanX = Math.tan(state.skewX);
  const newTanX = Math.tan(skewX);
  const oldTanY = Math.tan(state.skewY);
  const newTanY = Math.tan(skewY);

  // Compensation in pre-rotation space (after skew+scale)
  let compX = 0;
  let compY = 0;
  if (pinY !== 0) {
    // The pinned edge is at y = pinY * origHH in original space.
    // After skew, its x shifts by pinY * origHH * tan(skewX).
    // After scale, that shift becomes pinY * origHH * tan(skewX) * scaleX.
    // We need to cancel the delta of that shift.
    compX = -pinY * origHH * (newTanX - oldTanX) * state.scaleX;
  }
  if (pinX !== 0) {
    compY = -pinX * origHW * (newTanY - oldTanY) * state.scaleY;
  }

  // Rotate the compensation into post-rotation space (where translateX/Y live)
  const fwdCos = Math.cos(state.rotation);
  const fwdSin = Math.sin(state.rotation);
  const translateX = state.translateX + compX * fwdCos - compY * fwdSin;
  const translateY = state.translateY + compX * fwdSin + compY * fwdCos;

  return { skewX, skewY, translateX, translateY };
}
