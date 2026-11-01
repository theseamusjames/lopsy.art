import type { Rect } from '../../types';
import type { TransformHandle } from '../transform/transform';

/**
 * The box a marquee becomes when a scale handle is dragged by (dx, dy).
 * The opposite edge or corner stays put and the box never flips or drops
 * below 1 px. With a `ratio` (width / height) the box keeps that shape: a
 * corner drag shrinks the free side to fit inside the pointer's rectangle,
 * as drawing a locked marquee does, and an edge drag resizes the other
 * side about the box's centre.
 */
export function resizeMarqueeBounds(
  handle: TransformHandle,
  start: Rect,
  dx: number,
  dy: number,
  ratio: number | null,
): Rect {
  const movesLeft = handle === 'left' || handle === 'top-left' || handle === 'bottom-left';
  const movesRight = handle === 'right' || handle === 'top-right' || handle === 'bottom-right';
  const movesTop = handle === 'top' || handle === 'top-left' || handle === 'top-right';
  const movesBottom = handle === 'bottom' || handle === 'bottom-left' || handle === 'bottom-right';

  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let x0 = movesLeft ? Math.min(start.x + dx, right - 1) : start.x;
  let x1 = movesRight ? Math.max(right + dx, start.x + 1) : right;
  let y0 = movesTop ? Math.min(start.y + dy, bottom - 1) : start.y;
  let y1 = movesBottom ? Math.max(bottom + dy, start.y + 1) : bottom;

  if (ratio !== null && ratio > 0 && Number.isFinite(ratio)) {
    const isHorizontal = movesLeft || movesRight;
    const isVertical = movesTop || movesBottom;
    let w = x1 - x0;
    let h = y1 - y0;
    if (isHorizontal && isVertical) {
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
      if (movesLeft) x0 = x1 - w; else x1 = x0 + w;
      if (movesTop) y0 = y1 - h; else y1 = y0 + h;
    } else if (isHorizontal) {
      h = w / ratio;
      const cy = start.y + start.height / 2;
      y0 = cy - h / 2;
      y1 = cy + h / 2;
    } else if (isVertical) {
      w = h * ratio;
      const cx = start.x + start.width / 2;
      x0 = cx - w / 2;
      x1 = cx + w / 2;
    }
  }

  const x = Math.round(x0);
  const y = Math.round(y0);
  return {
    x,
    y,
    width: Math.max(1, Math.round(x1) - x),
    height: Math.max(1, Math.round(y1) - y),
  };
}

/**
 * The shape a marquee resize keeps: the locked aspect ratio when the lock
 * is on, otherwise the box's own shape while Cmd is held, else none.
 */
export function marqueeResizeRatio(
  start: Rect,
  options: { isLocked: boolean; ratioW: number; ratioH: number; isProportional: boolean },
): number | null {
  if (options.isLocked && options.ratioW > 0 && options.ratioH > 0) return options.ratioW / options.ratioH;
  if (options.isProportional && start.height > 0) return start.width / start.height;
  return null;
}
