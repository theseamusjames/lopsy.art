import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';
import { getTransformedBounds } from './transform';

export function computeSkew(
  handle: TransformHandle,
  startPoint: Point,
  currentPoint: Point,
  state: TransformState,
): { skewX: number; skewY: number } {
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

  const hw = bounds.width / 2;
  const hh = bounds.height / 2;

  switch (handle) {
    case 'top':
    case 'bottom':
      skewX = state.skewX + Math.atan2(deltaX, hh);
      break;
    case 'left':
    case 'right':
      skewY = state.skewY + Math.atan2(deltaY, hw);
      break;
    case 'top-left':
    case 'top-right':
    case 'bottom-left':
    case 'bottom-right':
      skewX = state.skewX + Math.atan2(deltaX, hh);
      skewY = state.skewY + Math.atan2(deltaY, hw);
      break;
  }

  // Clamp to reasonable range
  skewX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, skewX));
  skewY = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, skewY));

  return { skewX, skewY };
}
