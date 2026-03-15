import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';
import { getTransformedBounds } from './transform';

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
