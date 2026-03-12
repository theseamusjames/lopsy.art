import type { Point, Rect } from '../../types';

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

export interface TransformState {
  readonly originalBounds: Rect;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number; // radians
  readonly translateX: number;
  readonly translateY: number;
}

export function createTransformState(bounds: Rect): TransformState {
  return {
    originalBounds: bounds,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
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

export function getHandlePositions(
  state: TransformState,
): Record<TransformHandle, Point> {
  const bounds = getTransformedBounds(state);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const hw = bounds.width / 2;
  const hh = bounds.height / 2;
  const rot = state.rotation;

  function rotate(px: number, py: number): Point {
    const dx = px - cx;
    const dy = py - cy;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  // Rotation handles offset outside corners
  const rotOff = 20; // pixels in canvas space (will be adjusted for zoom at render time)

  return {
    'top-left': rotate(cx - hw, cy - hh),
    'top': rotate(cx, cy - hh),
    'top-right': rotate(cx + hw, cy - hh),
    'right': rotate(cx + hw, cy),
    'bottom-right': rotate(cx + hw, cy + hh),
    'bottom': rotate(cx, cy + hh),
    'bottom-left': rotate(cx - hw, cy + hh),
    'left': rotate(cx - hw, cy),
    'rotate-top-left': rotate(cx - hw - rotOff, cy - hh - rotOff),
    'rotate-top-right': rotate(cx + hw + rotOff, cy - hh - rotOff),
    'rotate-bottom-right': rotate(cx + hw + rotOff, cy + hh + rotOff),
    'rotate-bottom-left': rotate(cx - hw - rotOff, cy + hh + rotOff),
  };
}

export function hitTestHandle(
  point: Point,
  state: TransformState,
  handleRadius: number,
): TransformHandle | null {
  const positions = getHandlePositions(state);

  // Check rotation handles first (they're further out and take priority if overlapping)
  const rotateHandles: TransformHandle[] = [
    'rotate-top-left',
    'rotate-top-right',
    'rotate-bottom-right',
    'rotate-bottom-left',
  ];

  for (const handle of rotateHandles) {
    const pos = positions[handle];
    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    if (dx * dx + dy * dy <= handleRadius * handleRadius) {
      return handle;
    }
  }

  // Check scale handles
  const scaleHandles: TransformHandle[] = [
    'top-left',
    'top',
    'top-right',
    'right',
    'bottom-right',
    'bottom',
    'bottom-left',
    'left',
  ];

  for (const handle of scaleHandles) {
    const pos = positions[handle];
    const dx = point.x - pos.x;
    const dy = point.y - pos.y;
    if (dx * dx + dy * dy <= handleRadius * handleRadius) {
      return handle;
    }
  }

  return null;
}

export function isScaleHandle(handle: TransformHandle): boolean {
  return !handle.startsWith('rotate-');
}

export function isRotateHandle(handle: TransformHandle): boolean {
  return handle.startsWith('rotate-');
}

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
  let newTranslateX = state.translateX;
  let newTranslateY = state.translateY;

  const origW = state.originalBounds.width;
  const origH = state.originalBounds.height;

  switch (handle) {
    case 'right':
      newScaleX = state.scaleX + (deltaX / origW);
      break;
    case 'left':
      newScaleX = state.scaleX - (deltaX / origW);
      newTranslateX = state.translateX + deltaX / 2;
      break;
    case 'bottom':
      newScaleY = state.scaleY + (deltaY / origH);
      break;
    case 'top':
      newScaleY = state.scaleY - (deltaY / origH);
      newTranslateY = state.translateY + deltaY / 2;
      break;
    case 'bottom-right':
      newScaleX = state.scaleX + (deltaX / origW);
      newScaleY = state.scaleY + (deltaY / origH);
      break;
    case 'bottom-left':
      newScaleX = state.scaleX - (deltaX / origW);
      newScaleY = state.scaleY + (deltaY / origH);
      newTranslateX = state.translateX + deltaX / 2;
      break;
    case 'top-right':
      newScaleX = state.scaleX + (deltaX / origW);
      newScaleY = state.scaleY - (deltaY / origH);
      newTranslateY = state.translateY + deltaY / 2;
      break;
    case 'top-left':
      newScaleX = state.scaleX - (deltaX / origW);
      newScaleY = state.scaleY - (deltaY / origH);
      newTranslateX = state.translateX + deltaX / 2;
      newTranslateY = state.translateY + deltaY / 2;
      break;
  }

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

export function getCursorForHandle(handle: TransformHandle): string {
  if (isRotateHandle(handle)) return 'crosshair';

  const cursorMap: Record<string, string> = {
    'top-left': 'nwse-resize',
    'top': 'ns-resize',
    'top-right': 'nesw-resize',
    'right': 'ew-resize',
    'bottom-right': 'nwse-resize',
    'bottom': 'ns-resize',
    'bottom-left': 'nesw-resize',
    'left': 'ew-resize',
  };

  return cursorMap[handle] ?? 'default';
}

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
      // Un-rotate relative to center
      const dx = x - cx;
      const dy = y - cy;
      const ux = cx + dx * cos - dy * sin;
      const uy = cy + dx * sin + dy * cos;

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
