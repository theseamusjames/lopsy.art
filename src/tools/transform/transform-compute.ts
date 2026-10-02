import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';
import { getTransformedBounds } from './transform';

export function computeScale(
  handle: TransformHandle,
  startPoint: Point,
  currentPoint: Point,
  state: TransformState,
  isProportional: boolean,
): { scaleX: number; scaleY: number; translateX: number; translateY: number } {
  const bounds = getTransformedBounds(state);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  // Un-rotate the points relative to center so we can work in axis-aligned space
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

  let newScaleX = state.scaleX;
  let newScaleY = state.scaleY;
  let localShiftX = 0;
  let localShiftY = 0;

  const origW = state.originalBounds.width;
  const origH = state.originalBounds.height;

  switch (handle) {
    case 'right':
      newScaleX = state.scaleX + (deltaX / origW);
      localShiftX = deltaX / 2;
      break;
    case 'left':
      newScaleX = state.scaleX - (deltaX / origW);
      localShiftX = deltaX / 2;
      break;
    case 'bottom':
      newScaleY = state.scaleY + (deltaY / origH);
      localShiftY = deltaY / 2;
      break;
    case 'top':
      newScaleY = state.scaleY - (deltaY / origH);
      localShiftY = deltaY / 2;
      break;
    case 'bottom-right':
      newScaleX = state.scaleX + (deltaX / origW);
      newScaleY = state.scaleY + (deltaY / origH);
      localShiftX = deltaX / 2;
      localShiftY = deltaY / 2;
      break;
    case 'bottom-left':
      newScaleX = state.scaleX - (deltaX / origW);
      newScaleY = state.scaleY + (deltaY / origH);
      localShiftX = deltaX / 2;
      localShiftY = deltaY / 2;
      break;
    case 'top-right':
      newScaleX = state.scaleX + (deltaX / origW);
      newScaleY = state.scaleY - (deltaY / origH);
      localShiftX = deltaX / 2;
      localShiftY = deltaY / 2;
      break;
    case 'top-left':
      newScaleX = state.scaleX - (deltaX / origW);
      newScaleY = state.scaleY - (deltaY / origH);
      localShiftX = deltaX / 2;
      localShiftY = deltaY / 2;
      break;
  }

  // The shift is in the box's own axes; the centre lives in document axes,
  // so rotate it back or the pinned edge drifts on a rotated box.
  const rotCos = Math.cos(state.rotation);
  const rotSin = Math.sin(state.rotation);
  const newTranslateX = state.translateX + localShiftX * rotCos - localShiftY * rotSin;
  const newTranslateY = state.translateY + localShiftX * rotSin + localShiftY * rotCos;

  // Enforce minimum size
  newScaleX = Math.max(0.01, newScaleX);
  newScaleY = Math.max(0.01, newScaleY);

  if (isProportional) {
    const avgScale = (newScaleX + newScaleY) / 2;
    newScaleX = avgScale;
    newScaleY = avgScale;
  }

  return {
    scaleX: newScaleX,
    scaleY: newScaleY,
    translateX: newTranslateX,
    translateY: newTranslateY,
  };
}

export function computeRotation(
  currentPoint: Point,
  state: TransformState,
): number {
  const bounds = getTransformedBounds(state);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return Math.atan2(currentPoint.y - cy, currentPoint.x - cx);
}
