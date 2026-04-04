import type { Rect } from '../../types';

export type TransformHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'rotate-top-left'
  | 'rotate-top-right'
  | 'rotate-bottom-right'
  | 'rotate-bottom-left';

export type TransformMode = 'free' | 'skew' | 'distort' | 'perspective';

export interface TransformState {
  readonly originalBounds: Rect;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number; // radians
  readonly translateX: number;
  readonly translateY: number;
  readonly skewX: number; // radians
  readonly skewY: number; // radians
  readonly mode: TransformMode;
}

export function createTransformState(bounds: Rect, mode: TransformMode = 'free'): TransformState {
  return {
    originalBounds: bounds,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
    skewX: 0,
    skewY: 0,
    mode,
  };
}

export function getTransformedBounds(state: TransformState): Rect {
  const { originalBounds, scaleX, scaleY, translateX, translateY } = state;
  const cx = originalBounds.x + originalBounds.width / 2 + translateX;
  const cy = originalBounds.y + originalBounds.height / 2 + translateY;
  const w = originalBounds.width * Math.abs(scaleX);
  const h = originalBounds.height * Math.abs(scaleY);
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
  };
}

export {
  getHandlePositions,
  hitTestHandle,
  isScaleHandle,
  isRotateHandle,
  getCursorForHandle,
} from './transform-handles';

export { computeScale, computeRotation } from './transform-compute';

export { computeSkew } from './transform-skew';

export { applyTransformToMask } from './transform-mask';
