import type { Point } from '../../types';
import type { TransformHandle, TransformState } from './transform';
import { getCornerPositions } from './transform';

/**
 * Applies the same transform chain used by the pixel renderer:
 * translate(-origCenter) → skew → scale → rotate → translate(origCenter + offset)
 */
export function transformPoint(px: number, py: number, state: TransformState): Point {
  const origCx = state.originalBounds.x + state.originalBounds.width / 2;
  const origCy = state.originalBounds.y + state.originalBounds.height / 2;

  // 1. Translate to origin
  let x = px - origCx;
  let y = py - origCy;

  // 2. Skew
  const tanSkewX = Math.tan(state.skewX);
  const tanSkewY = Math.tan(state.skewY);
  const sx = x + y * tanSkewX;
  const sy = x * tanSkewY + y;
  x = sx;
  y = sy;

  // 3. Scale
  x *= state.scaleX;
  y *= state.scaleY;

  // 4. Rotate
  const cos = Math.cos(state.rotation);
  const sin = Math.sin(state.rotation);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  // 5. Translate to final position
  return {
    x: rx + origCx + state.translateX,
    y: ry + origCy + state.translateY,
  };
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function isCornerMode(state: TransformState): boolean {
  return state.mode === 'distort' || state.mode === 'perspective';
}

export function getHandlePositions(
  state: TransformState,
): Record<TransformHandle, Point> {
  if (isCornerMode(state)) {
    // In distort/perspective modes, corners are positioned directly
    const [tl, tr, br, bl] = getCornerPositions(state);
    const rotOff = 20;

    // Direction vectors for rotation handle offsets
    function cornerOffset(corner: Point, adj1: Point, adj2: Point): Point {
      const dx1 = corner.x - adj1.x;
      const dy1 = corner.y - adj1.y;
      const dx2 = corner.x - adj2.x;
      const dy2 = corner.y - adj2.y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const len2 = Math.hypot(dx2, dy2) || 1;
      return {
        x: corner.x + (dx1 / len1 + dx2 / len2) * rotOff,
        y: corner.y + (dy1 / len1 + dy2 / len2) * rotOff,
      };
    }

    return {
      'top-left': tl,
      'top': mid(tl, tr),
      'top-right': tr,
      'right': mid(tr, br),
      'bottom-right': br,
      'bottom': mid(bl, br),
      'bottom-left': bl,
      'left': mid(tl, bl),
      'rotate-top-left': cornerOffset(tl, tr, bl),
      'rotate-top-right': cornerOffset(tr, tl, br),
      'rotate-bottom-right': cornerOffset(br, tr, bl),
      'rotate-bottom-left': cornerOffset(bl, tl, br),
    };
  }

  const ob = state.originalBounds;
  const left = ob.x;
  const right = ob.x + ob.width;
  const top = ob.y;
  const bottom = ob.y + ob.height;
  const midX = ob.x + ob.width / 2;
  const midY = ob.y + ob.height / 2;

  const tl = transformPoint(left, top, state);
  const tr = transformPoint(right, top, state);
  const bl = transformPoint(left, bottom, state);
  const br = transformPoint(right, bottom, state);

  // Edge midpoints
  const topMid = transformPoint(midX, top, state);
  const bottomMid = transformPoint(midX, bottom, state);
  const leftMid = transformPoint(left, midY, state);
  const rightMid = transformPoint(right, midY, state);

  // Rotation handles offset outside corners
  const rotOff = 20;

  return {
    'top-left': tl,
    'top': topMid,
    'top-right': tr,
    'right': rightMid,
    'bottom-right': br,
    'bottom': bottomMid,
    'bottom-left': bl,
    'left': leftMid,
    'rotate-top-left': transformPoint(left - rotOff, top - rotOff, state),
    'rotate-top-right': transformPoint(right + rotOff, top - rotOff, state),
    'rotate-bottom-right': transformPoint(right + rotOff, bottom + rotOff, state),
    'rotate-bottom-left': transformPoint(left - rotOff, bottom + rotOff, state),
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
